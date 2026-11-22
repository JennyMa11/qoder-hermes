"""Exercise the actual installed Hermes profile, pool, and OpenAI client.

Run with Hermes' bootstrapped Python, not an arbitrary system Python.
All network traffic is the local fake Qoder upstream in gateway_e2e.
"""
import os
from pathlib import Path
import sys
from unittest.mock import patch

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "test"))
from gateway_e2e import fake_upstream

from agent.credential_pool import PooledCredential
from hermes_cli.auth import resolve_api_key_provider_credentials
from hermes_cli.runtime_provider import choose_pool_key, _resolve_runtime_from_pool_entry
from providers import get_provider_profile


class Pool:
    def __init__(self, entries):
        self._entries = entries
        self.index = 0

    def has_credentials(self):
        return bool(self._entries)

    def select(self, **_kwargs):
        selected = self._entries[self.index]
        self.index = (self.index + 1) % len(self._entries)
        return selected

    def choose(self, **kwargs):
        return self.select(**kwargs)

    def peek(self, **_kwargs):
        return self._entries[self.index]


def entry(pat, label):
    return PooledCredential(
        provider="qoder-cn", id=label, label=label, auth_type="api_key",
        priority=0, source="manual",
        access_token=pat, base_url="qoder-cn://local/v1",
    )


def main():
    with fake_upstream() as upstream, patch.dict(
        os.environ, {"QODER_CN_TEST_UPSTREAM_URL": upstream},
    ):
        profile = get_provider_profile("qoder-cn")
        assert profile is not None
        os.environ.pop("QODERCN_PERSONAL_ACCESS_TOKEN", None)
        os.environ["QODERCN_PERSONAL_ACCESS_TOKEN"] = "pt-example-only"
        credentials = resolve_api_key_provider_credentials("qoder-cn")
        assert credentials["api_key"] == "pt-example-only"
        assert credentials["base_url"] == "qoder-cn://local/v1"
        client = profile.create_client(**credentials)
        response = client.chat.completions.create(
            model="demo-model", messages=[{"role": "user", "content": "hello"}], stream=True,
        )
        text = "".join(
            choice.delta.content or "" for chunk in response for choice in chunk.choices
        )
        assert text == "Hello from Qoder", text
        models = profile.fetch_models(api_key="pt-example-only")
        assert models and "demo-model" in models

        first, second = entry("pt-example-only", "first"), entry("pt-example-two", "second")
        picked = choose_pool_key(Pool([first, second]), "qoder-cn", mode="choose")
        assert picked is not None
        assert picked.api_key != "pt-example-only"
        assert first.base_url.startswith("http://127.0.0.1:")
        runtime = _resolve_runtime_from_pool_entry(
            provider="qoder-cn", entry=first, requested_provider="qoder-cn",
            model_cfg={"provider": "qoder-cn", "default": "demo-model"},
        )
        assert runtime["api_key"] == picked.api_key
        assert runtime["base_url"] == first.base_url
        assert runtime["api_key"] != "pt-example-only"
        pooled_client = profile.create_client(**runtime)
        tool_response = pooled_client.chat.completions.create(
            model="demo-model", messages=[{"role": "user", "content": "weather"}],
            tools=[{"type": "function", "function": {
                "name": "get_weather", "description": "Read weather",
                "parameters": {"type": "object", "properties": {}}},
            }], stream=True,
        )
        calls = [
            call for chunk in tool_response for choice in chunk.choices
            for call in (choice.delta.tool_calls or [])
        ]
        assert calls[0].function.name == "get_weather"
        assert calls[0].function.arguments == '{"city":"Paris"}'

        # A rotation reuses the second PAT's already-prepared local endpoint.
        # This specifically covers client_lifecycle._swap_credential, which
        # does not invoke prepare_pool_entry a second time.
        pool = Pool([first, second])
        choose_pool_key(pool, "qoder-cn", mode="select")
        second_pick = choose_pool_key(pool, "qoder-cn", mode="select")
        assert second_pick.entry is second
        assert second.access_token == second_pick.api_key
        assert second.base_url != first.base_url
        second_runtime = _resolve_runtime_from_pool_entry(
            provider="qoder-cn", entry=second, requested_provider="qoder-cn",
            model_cfg={"provider": "qoder-cn", "default": "demo-model"},
        )
        second_client = profile.create_client(**second_runtime)
        second_stream = second_client.chat.completions.create(
            model="demo-model", messages=[{"role": "user", "content": "hello"}], stream=True,
        )
        assert "Hello from Qoder" == "".join(
            choice.delta.content or "" for chunk in second_stream for choice in chunk.choices
        )
        print("PASS: real Hermes profile, single PAT, pool conversion, rotation, streaming, tools")


if __name__ == "__main__":
    main()
