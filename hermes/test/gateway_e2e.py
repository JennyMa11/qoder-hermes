"""Controlled upstream -> real gateway -> OpenAI streaming client test."""
from contextlib import contextmanager
import json
import os
import subprocess
from pathlib import Path
import sys
import threading
import urllib.error
import urllib.request
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime import GatewayManager

def cosy_decode(body):
    # Decode only this controlled fixture's cosy transport body; chat payloads
    # are not plain JSON on the Qoder wire.
    script = "import {cosyDecode} from './core/cosy.ts';let b='';process.stdin.on('data',c=>b+=c).on('end',()=>process.stdout.write(new TextDecoder().decode(cosyDecode(b.trim()))))"
    return subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=Path(__file__).resolve().parents[2], input=body, text=True)


class FakeQoder(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    observed_tool_messages = []

    def log_message(self, *args):
        pass

    def reply(self, value):
        raw = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            self.reply({"ok": True})
        elif "/model/list" in self.path:
            self.reply({"chat": [{
                "key": "demo-model", "display_name": "Demo Model", "enable": True,
                "is_default": True, "is_vl": False, "is_reasoning": True,
                "max_input_tokens": 128000, "max_output_tokens": 4096,
            }]})
        else:
            self.send_error(404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0))).decode()
        if "/api/v1/jobToken/exchange" in self.path:
            self.reply({"token": "sash-token-example"})
            return
        if "/jobToken" in self.path:
            outer = json.loads(cosy_decode(body))
            assert json.loads(outer["payload"])["personalToken"] in ("pt-example-only", "pt-example-other", "pt-example-two")
            self.reply({
                "id": "account-a", "name": "acct-demo", "expireTime": 4102444800000,
                "securityOauthToken": "job-token-example", "refreshToken": "refresh-example",
                "userType": "personal_standard",
            })
            return
        if "/agent_chat_generation" not in self.path:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("connection", "close")
        self.end_headers()

        def event(inner):
            frame = json.dumps({"statusCodeValue": 200, "body": json.dumps(inner)})
            self.wfile.write(f"data: {frame}\n\n".encode())

        decoded = json.loads(cosy_decode(body))
        tools = decoded.get("tools", [])
        messages = decoded.get("messages", [])
        tool_results = [message for message in messages if message.get("role") == "tool"]
        if tool_results:
            # Hermes has sent the tool result back through the real gateway;
            # record it before returning the final user-visible answer.
            self.observed_tool_messages.extend(tool_results)
            event({"choices": [{"delta": {"role": "assistant", "content": "Hermes tool round trip: OK"}}]})
        elif tools:
            terminal_tool = next(
                (tool for tool in tools if tool.get("function", {}).get("name") == "terminal"),
                tools[0],
            )
            name = terminal_tool.get("function", {}).get("name", "get_weather")
            event({"choices": [{"delta": {"role": "assistant", "tool_calls": [{
                "index": 0, "id": "call_demo", "type": "function",
                "function": {
                    "name": name,
                    "arguments": '{"command":"printf hermes-tool-ok"}' if name == "terminal" else '{"city":"Paris"}',
                },
            }]}}]})
        else:
            event({"choices": [{"delta": {"role": "assistant", "content": "Hello "}}]})
            event({"choices": [{"delta": {"content": "from Qoder"}}]})
        event({"usage": {"prompt_tokens": 8, "completion_tokens": 3}})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True


@contextmanager
def fake_upstream():
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeQoder)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True, name="fake-qoder")
    thread.start()
    try:
        yield f"http://127.0.0.1:{upstream.server_port}"
    finally:
        upstream.shutdown()
        upstream.server_close()


def main():
    with fake_upstream() as upstream, patch.dict(
        os.environ, {"QODER_CN_TEST_UPSTREAM_URL": upstream},
    ):
        urllib.request.urlopen(upstream + "/health", timeout=2).close()
        manager = GatewayManager(Path(__file__).resolve().parents[1])
        try:
            gateway = manager.get("pt-example-only")
            assert manager.get("pt-example-only") is gateway
            other = manager.get("pt-example-other")
            assert other.base_url != gateway.base_url
            assert other.api_key != gateway.api_key
            other_process = other._process
            other.close()
            assert other_process.wait(timeout=5) == 0

            def chat(tools=None):
                payload = {
                    "model": "demo-model", "stream": True,
                    "stream_options": {"include_usage": True},
                    "messages": [{"role": "user", "content": "hello"}],
                }
                if tools is not None:
                    payload["tools"] = tools
                request = urllib.request.Request(
                    gateway.base_url + "/chat/completions", data=json.dumps(payload).encode(),
                    headers={"authorization": "Bearer " + gateway.api_key, "content-type": "application/json"},
                )
                try:
                    response = urllib.request.urlopen(request, timeout=5)
                except urllib.error.HTTPError as error:
                    raise AssertionError(error.read().decode()) from error
                with response:
                    assert response.status == 200
                    return response.read().decode()

            text = chat()
            assert '"content":"Hello "' in text, text
            assert '"content":"from Qoder"' in text, text
            assert '"prompt_tokens":8' in text
            assert "data: [DONE]" in text
            tool_text = chat([{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object"}}}])
            assert "get_weather" in tool_text
            assert "call_demo" in tool_text
            assert '\\"city\\":\\"Paris\\"' in tool_text
            assert '"finish_reason":"tool_calls"' in tool_text
            with urllib.request.urlopen(gateway.models_url, timeout=5) as response:
                assert any(model["id"] == "demo-model" for model in json.load(response)["data"])
            request = urllib.request.Request(gateway.base_url + "/chat/completions", data=b"{}", headers={"content-type": "application/json"})
            try:
                urllib.request.urlopen(request, timeout=5)
                raise AssertionError("unauthenticated request accepted")
            except urllib.error.HTTPError as error:
                assert error.code == 401
        finally:
            manager.close()
        print("Hermes gateway E2E: OK")


if __name__ == "__main__":
    main()
