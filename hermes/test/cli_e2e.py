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

            # `hermes usage` reaches the plugin through a different path than a
            # turn: agent.account_usage is mid-import when it asks for this
            # profile, so a module-level `from agent.account_usage import ...`
            # in the plugin breaks *only* this command. Keep the assertion here.
            usage_result = subprocess.run(
                ["hermes", "usage", "--provider", "qoder-cn", "--json"],
                env=env, cwd=PLUGIN, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
            )
            assert usage_result.returncode == 0, usage_result.stderr
            document = json.loads(usage_result.stdout)
            assert document["provider"] == "qoder-cn", document
            assert document["source"] == "qoder_usage_api", document
            assert document["plan"] == "personal_standard", document
            assert [window["label"] for window in document["windows"]] == [
                "Base quota", "Add-on credits",
            ], document
            assert document["windows"][0]["detail"] == "750 of 1000 credits left", document
            assert "Credits remaining: 950" in document["details"], document
            assert "Plan expires: 2100-01-01" in document["details"], document

            text_result = subprocess.run(
                ["hermes", "usage", "--provider", "qoder-cn"],
                env=env, cwd=PLUGIN, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
            )
            assert text_result.returncode == 0, text_result.stderr
            assert "Base quota: 75% remaining (25% used)" in text_result.stdout, text_result.stdout
            assert "Credits remaining: 950" in text_result.stdout, text_result.stdout
        print("PASS: real Hermes CLI streaming and tool round trip")
        print("PASS: real Hermes CLI usage reads Qoder credits through the gateway")
    finally:
        shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    main()
