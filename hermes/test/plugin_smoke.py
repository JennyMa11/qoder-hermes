"""Offline smoke for the installed profile through Hermes' real registry."""
import os
import sys
from pathlib import Path
from unittest.mock import patch

import hermes_bootstrap
from providers import get_provider_profile
from hermes_cli.auth import PROVIDER_REGISTRY, resolve_api_key_provider_credentials


def main():
    profile = get_provider_profile("qoder-cn")
    assert profile is not None
    assert profile.name == "qoder-cn"
    assert profile.supports_streaming
    assert PROVIDER_REGISTRY["qoder-cn"].auth_type == "api_key"

    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("QODERCN_PERSONAL_ACCESS_TOKEN", None)
        result = resolve_api_key_provider_credentials("qoder-cn")
        assert not result["api_key"]
        assert result["base_url"] == "qoder-cn://local/v1"
        print("PASS: discovered qoder-cn; unconfigured auth is safe")

    with patch.dict(os.environ, {"QODERCN_PERSONAL_ACCESS_TOKEN": "pt-example-only"}):
        result = resolve_api_key_provider_credentials("qoder-cn")
        assert result["api_key"] == "pt-example-only"
        assert result["source"] == "QODERCN_PERSONAL_ACCESS_TOKEN"
        assert result["base_url"] == "qoder-cn://local/v1"
        print("PASS: PAT auth resolves without leaking it into the base URL")


if __name__ == "__main__":
    main()
