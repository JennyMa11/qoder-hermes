"""Full Hermes CLI smoke against the local Qoder fixture.

The fixture always requests terminal for a tool-enabled request. The second
request asserts that Hermes returned the actual tool result through Qoder.
Only synthetic PATs and an isolated HERMES_HOME are used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(PLUGIN / "test"))
from gateway_e2e import FakeQoder, fake_upstream
from install import install


def main():
    FakeQoder.observed_tool_messages = []
    home = Path(tempfile.mkdtemp(prefix="qoder-cn-cli-test-"))
    try:
        install(home / "plugins" / "model-providers" / "qoder-cn")
        env = os.environ.copy()
        env.update({
            "HERMES_HOME": str(home),
            "QODERCN_PERSONAL_ACCESS_TOKEN": "pt-example-only",
            "QODER_CN_TEST_UPSTREAM_URL": "",
        })
        env.pop("QODER_PERSONAL_ACCESS_TOKEN", None)
        # Build an isolated default model selection without changing the
        # user's real provider, models, or persistent credentials.
        (home / "config.yaml").write_text(
            "model:\n  provider: qoder-cn\n  default: demo-model\n",
            encoding="utf-8",
        )
        with fake_upstream() as upstream:
            env["QODER_CN_TEST_UPSTREAM_URL"] = upstream
            command = [
                "hermes", "--ignore-rules", "--provider", "qoder-cn",
                "-m", "demo-model", "-z", "Reply with a short greeting.",
            ]
            result = subprocess.run(
                command, env=env, cwd=PLUGIN, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
            )
            assert result.returncode == 0, result.stderr
            assert "Hermes tool round trip: OK" in result.stdout, result.stdout
            assert FakeQoder.observed_tool_messages, result.stderr
            assert any(
                "hermes-tool-ok" in json.dumps(message)
                for message in FakeQoder.observed_tool_messages
            ), FakeQoder.observed_tool_messages
            FakeQoder.observed_tool_messages = []

            result = subprocess.run(
                command + [
                    "-t", "terminal",
                ],
                env=env, cwd=PLUGIN, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
            )
            assert result.returncode == 0, result.stderr
            assert "Hermes tool round trip: OK" in result.stdout, result.stdout
            assert FakeQoder.observed_tool_messages, result.stderr
            assert any(
                "hermes-tool-ok" in json.dumps(message)
                for message in FakeQoder.observed_tool_messages
            ), FakeQoder.observed_tool_messages
        print("PASS: real Hermes CLI streaming and tool round trip")
    finally:
        shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    main()
