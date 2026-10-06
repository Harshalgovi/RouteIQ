"""
Minimal TTL + LRU cache used to avoid duplicate geocoding / routing calls.

Deliberately simple: no Redis, no persistence, no background invalidation.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    def __init__(self, max_entries: int = 1024, ttl_seconds: int = 900) -> None:
        self.max_entries = max(1, max_entries)
        self.ttl_seconds = max(0, ttl_seconds)
        self._store: "OrderedDict[str, tuple[float, T]]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[T]:
        if self.ttl_seconds == 0:
            return None
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= now:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return value

    def has(self, key: str) -> bool:
        """
        True when a live entry exists — even when the cached value is ``None``.

        Lets callers cache negative results (provider returned no match) without
        re-querying the provider on every request.
        """
        if self.ttl_seconds == 0:
            return False
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return False
            expires_at, _value = entry
            if expires_at <= now:
                self._store.pop(key, None)
                return False
            return True

    def set(self, key: str, value: T) -> None:
        if self.ttl_seconds == 0:
            return
        with self._lock:
            self._store[key] = (time.monotonic() + self.ttl_seconds, value)
            self._store.move_to_end(key)
            while len(self._store) > self.max_entries:
                self._store.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:  # pragma: no cover - diagnostics only
        with self._lock:
            return len(self._store)
