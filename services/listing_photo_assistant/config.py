"""Backward-compatible configuration import surface.

New code should import settings from :mod:`.settings`.  The alias remains so
the existing Agent and package callers continue to use the same class while
the process adopts the immutable shared settings object.
"""

from .settings import BackendSettings, ProviderMode, SettingsError

ConfigurationError = SettingsError

__all__ = ["BackendSettings", "ConfigurationError", "ProviderMode", "SettingsError"]
