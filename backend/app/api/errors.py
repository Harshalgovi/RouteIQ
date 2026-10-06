"""
Shared API error translation.

Converts the provider-agnostic error taxonomy into HTTPException with an
operator-friendly message. Raw provider payloads, URLs, and stack traces are
never returned to clients.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, status

from app.services.providers.errors import (
    InvalidCoordinatesError,
    InvalidLocationError,
    ProviderAuthenticationError,
    ProviderBadResponseError,
    ProviderConfigurationError,
    ProviderError,
    ProviderNotFoundError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)

logger = logging.getLogger("routeiq.api.errors")

#: Log provider internals server-side; return these to the client.
_CLIENT_MESSAGE_OVERRIDES = {
    ProviderConfigurationError: (
        "Map services are not configured on this server. Please contact an administrator."
    ),
}


def provider_error_to_http(exc: BaseException) -> HTTPException:
    """Map any exception onto a safe HTTPException."""
    if isinstance(exc, HTTPException):
        return exc

    if isinstance(exc, ProviderError):
        logger.warning(
            "[providers] %s (%s): %s",
            type(exc).__name__,
            getattr(exc, "provider", None),
            exc.message,
        )
        override = _CLIENT_MESSAGE_OVERRIDES.get(type(exc))
        detail = override or exc.message
        headers = (
            {"Retry-After": "5"} if isinstance(exc, ProviderRateLimitError) else None
        )
        return HTTPException(status_code=exc.http_status, detail=detail, headers=headers)

    # A few non-provider failures still declare their own HTTP contract (for
    # example the OR-Tools solver being unavailable in this deployment). Honour
    # it rather than flattening them all to a generic 502.
    http_status = getattr(exc, "http_status", None)
    if isinstance(http_status, int):
        user_message = getattr(exc, "user_message", None) or str(exc)
        logger.warning("[api] %s: %s", type(exc).__name__, user_message)
        return HTTPException(status_code=http_status, detail=user_message)

    # Any other failure (bug, unexpected payload shape, ...).
    logger.exception("Unhandled error while contacting a map service provider")
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The map service could not complete the request. Please try again.",
    )


__all__ = [
    "InvalidCoordinatesError",
    "InvalidLocationError",
    "ProviderAuthenticationError",
    "ProviderBadResponseError",
    "ProviderConfigurationError",
    "ProviderNotFoundError",
    "ProviderRateLimitError",
    "ProviderTimeoutError",
    "ProviderUnavailableError",
    "provider_error_to_http",
]
