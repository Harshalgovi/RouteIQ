"""
Shared, provider-agnostic HTTP client used by geocoding and routing services.

Responsibilities kept here (and nowhere else):
  * enforcing a per-request timeout
  * normalising transport / status failures into Provider* errors
  * a small token-bucket style throttle so public demo endpoints are not hammered
  * never exposing raw httpx exceptions upward
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Mapping, Optional

import httpx

from app.services.providers.errors import (
    ProviderAuthenticationError,
    ProviderBadResponseError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)

logger = logging.getLogger("routeiq.providers.http")


class RateLimiter:
    """
    Serialises outbound requests so that at most one request starts every
    `min_interval` seconds. Used to respect Nominatim's 1 request/second policy.
    """

    def __init__(self, min_interval_seconds: float) -> None:
        self.min_interval = max(0.0, min_interval_seconds)
        self._lock = asyncio.Lock()
        self._last_started: float = 0.0

    async def acquire(self) -> None:
        if self.min_interval <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            wait_for = self._last_started + self.min_interval - now
            if wait_for > 0:
                await asyncio.sleep(wait_for)
            self._last_started = time.monotonic()


class ProviderHttpClient:
    """
    Thin async wrapper around httpx that all outbound provider calls go through.
    """

    def __init__(
        self,
        *,
        provider: str,
        timeout_seconds: float,
        min_interval_seconds: float = 0.0,
        user_agent: Optional[str] = None,
    ) -> None:
        self.provider = provider
        self.timeout_seconds = timeout_seconds
        self.user_agent = user_agent
        self._limiter = RateLimiter(min_interval_seconds)

    def _headers(self, extra: Optional[Mapping[str, str]] = None) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": self.user_agent or "RouteIQ/1.0",
        }
        if extra:
            headers.update({k: v for k, v in extra.items() if v})
        return headers

    async def get_json(
        self,
        url: str,
        params: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        accepted_statuses: Optional[set[int]] = None,
    ) -> Any:
        """
        GET `url` and return decoded JSON, or raise a normalised ProviderError.

        ``accepted_statuses`` lets a provider handle its own application-level
        error codes (e.g. OSRM answers HTTP 400 with a descriptive JSON body).
        """
        await self._limiter.acquire()

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout_seconds),
                follow_redirects=True,
            ) as client:
                response = await client.get(url, params=params, headers=self._headers(headers))
        except httpx.TimeoutException as exc:
            logger.warning("[%s] request timed out: %s", self.provider, type(exc).__name__)
            raise ProviderTimeoutError(provider=self.provider) from exc
        except httpx.HTTPError as exc:
            logger.warning("[%s] transport failure: %s", self.provider, type(exc).__name__)
            raise ProviderUnavailableError(provider=self.provider) from exc
        except (ValueError, TypeError) as exc:
            # Malformed URL / params — a server configuration problem.
            logger.warning("[%s] invalid request configuration", self.provider)
            raise ProviderBadResponseError(provider=self.provider) from exc

        if response.status_code == 429:
            raise ProviderRateLimitError(provider=self.provider)
        if response.status_code in (401, 403):
            raise ProviderAuthenticationError(provider=self.provider)

        ok = accepted_statuses if accepted_statuses is not None else set(range(200, 300))
        if response.status_code not in ok:
            logger.warning(
                "[%s] provider responded with HTTP %s", self.provider, response.status_code
            )
            raise ProviderBadResponseError(provider=self.provider)

        try:
            return response.json()
        except ValueError as exc:
            logger.warning("[%s] provider returned non-JSON body", self.provider)
            raise ProviderBadResponseError(provider=self.provider) from exc
