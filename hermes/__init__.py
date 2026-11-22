"""Qoder CN model provider for Hermes Agent.

Install this directory and its built gateway.mjs under
$HERMES_HOME/plugins/model-providers/qoder-cn/. Requires Node.js 22.19+.
"""
from pathlib import Path

from providers import ProviderProfile, register_provider
from .runtime import GatewayManager, _PLACEHOLDER, create_client, prepare_pool_entry
from .usage import fetch_account_usage

_manager = GatewayManager(Path(__file__).resolve().parent)


class QoderCNProfile(ProviderProfile):
    def resolve_api_key_secret(self):
        # Returning None lets Hermes prefer its .env and then its credential
        # pool. Returning an env PAT here would bypass pool selection entirely.
        return None

    def runtime_base_url(self, *, api_key, default, env_url):
        if env_url:
            raise ValueError("QODERCN_BASE_URL is not supported; the provider owns its loopback gateway")
        # A fixed, non-routable marker prevents a random child port from being
        # persisted as a provider endpoint. create_client resolves the marker.
        return _PLACEHOLDER

    def create_client(self, **client_kwargs):
        return create_client(_manager, **client_kwargs)

    def prepare_pool_entry(self, entry, api_key):
        return prepare_pool_entry(_manager, entry, api_key)

    def fetch_models(self, *, api_key=None, base_url=None, timeout=8.0):
        if not api_key:
            return None
        import json
        import urllib.request
        gateway = _manager.get(api_key)
        request = urllib.request.Request(gateway.models_url)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode())
            return [item["id"] for item in payload.get("data", []) if isinstance(item, dict) and item.get("id")]
        except Exception:
            return None

    def fetch_account_usage(self, *, base_url=None, api_key=None):
        """/usage hook: Qoder credits, read through this PAT's loopback gateway.

        The gateway already owns the PAT→jobToken exchange, so this hook never
        talks to Qoder itself — it asks the local shim, which is the only place
        allowed to hold the credential. ``api_key`` is None on some Hermes
        surfaces (``hermes usage`` resolves the credential itself only for its
        built-in fetchers); usage.py then runs Hermes' own resolution ladder.
        """
        return fetch_account_usage(_manager, api_key)


profile = QoderCNProfile(
    name="qoder-cn",
    display_name="Qoder CN (PAT)",
    description="Qoder 国内版：PAT → 本地 OpenAI-compatible 网关",
    signup_url="https://qoder.com/",
    env_vars=("QODERCN_PERSONAL_ACCESS_TOKEN",),
    base_url=_PLACEHOLDER,
    auth_type="api_key",
    supports_streaming=True,
    supports_model_listing=True,
)
register_provider(profile)
