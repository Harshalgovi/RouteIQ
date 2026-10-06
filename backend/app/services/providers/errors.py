"""
Provider-agnostic error taxonomy.

Every third-party geocoding / routing / tile provider failure is normalised into
one of these errors so that API layers never have to inspect provider-specific
payloads, and never have to leak raw exceptions or stack traces to clients.
"""

from __future__ import annotations


class ProviderError(Exception):
    """Base class for every third-party provider failure."""

    #: Default HTTP status used when this error escapes to the API layer.
    http_status: int = 502
    #: Default operator-facing message. Never contains raw provider payloads.
    default_message: str = "The map service provider could not complete the request."

    def __init__(self, message: str | None = None, *, provider: str | None = None) -> None:
        self.provider = provider
        self.message = message or self.default_message
        super().__init__(self.message)

    @property
    def user_message(self) -> str:
        return self.message


class ProviderUnavailableError(ProviderError):
    http_status = 502
    default_message = (
        "The map service provider is unreachable right now. Please try again in a moment."
    )


class ProviderTimeoutError(ProviderError):
    http_status = 504
    default_message = (
        "The map service provider took too long to respond. Please try again."
    )


class ProviderRateLimitError(ProviderError):
    http_status = 429
    default_message = (
        "Too many map service requests were sent too quickly. Please wait a moment and try again."
    )


class ProviderAuthenticationError(ProviderError):
    http_status = 502
    default_message = "The configured map service provider rejected the server credentials."


class ProviderBadResponseError(ProviderError):
    http_status = 502
    default_message = "The map service provider returned an unexpected response."


class ProviderNotFoundError(ProviderError):
    """Provider is healthy but could not resolve the requested location/route."""

    http_status = 404
    default_message = "No map result was found for the supplied location."


class ProviderConfigurationError(ProviderError):
    """A provider id or credential is missing / unknown on the server."""

    http_status = 500
    default_message = "The requested map service provider is not configured on this server."


class InvalidCoordinatesError(ProviderError):
    """Caller supplied coordinates outside valid latitude/longitude bounds."""

    http_status = 422
    default_message = (
        "The supplied coordinates are invalid. Latitude must be between -90 and 90 "
        "and longitude between -180 and 180."
    )


class InvalidLocationError(ProviderError):
    """Neither usable coordinates nor a usable address were supplied."""

    http_status = 422
    default_message = (
        "Provide either coordinates (latitude/longitude) or a street address for each location."
    )
