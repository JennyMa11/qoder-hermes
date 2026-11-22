"""Per-PAT loopback gateways for the Hermes Qoder CN provider.

The PAT is written to a short-lived pipe, not placed in argv, the environment,
Hermes configuration, or logs. Each gateway returns a random local API key.
"""
from __future__ import annotations

import atexit
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
from typing import Any

_PLACEHOLDER = "qoder-cn://local/v1"


class Gateway:
    def __init__(self, pat: str, plugin_dir: Path, timeout: float = 30.0):
        executable = os.environ.get("QODER_CN_NODE", "node")
        script = Path(os.environ.get("QODER_CN_GATEWAY", plugin_dir / "gateway.mjs"))
        self._process = subprocess.Popen(
            [executable, str(script)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            # Do not pass the PAT in either argv or env.
            env={key: value for key, value in os.environ.items()
                 if key not in ("QODERCN_PERSONAL_ACCESS_TOKEN", "QODER_PERSONAL_ACCESS_TOKEN")},
        )
        try:
            assert self._process.stdin is not None
            self._process.stdin.write(pat + "\n")
            self._process.stdin.flush()
            ready = self._wait_ready(timeout)
        except BaseException:
            self.close()
            raise
        self.base_url = ready["base_url"]
        self.api_key = ready["api_key"]
        self.models_url = ready["models_url"]
        self._pat_digest = hashlib.sha256(pat.encode()).hexdigest()
        self._lock = threading.Lock()

    def _wait_ready(self, timeout: float) -> dict[str, str]:
        """Read stdout without letting a broken child block provider discovery."""
        import queue
        lines: queue.Queue[str] = queue.Queue(maxsize=1)
        assert self._process.stdout is not None
        reader = threading.Thread(target=lambda: lines.put(self._process.stdout.readline()), daemon=True)
        reader.start()
        try:
            line = lines.get(timeout=timeout)
        except queue.Empty as exc:
            raise RuntimeError("Qoder CN gateway did not become ready in time") from exc
        if not line:
            detail = ""
            if self._process.stderr is not None:
                detail = self._process.stderr.read().strip()
            raise RuntimeError(detail or "Qoder CN gateway exited before becoming ready")
        try:
            result = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Qoder CN gateway returned an invalid readiness response") from exc
        if not all(isinstance(result.get(key), str) for key in ("base_url", "api_key", "models_url")):
            raise RuntimeError("Qoder CN gateway readiness response is incomplete")
        return result

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


class GatewayManager:
    """Cache gateways by a digest; never retain PATs as dictionary keys."""

    def __init__(self, plugin_dir: Path):
        self._plugin_dir = plugin_dir
        self._gateways: dict[str, Gateway] = {}
        self._lock = threading.Lock()
        atexit.register(self.close)

    def get(self, pat: str) -> Gateway:
        if not isinstance(pat, str) or not pat.strip():
            raise ValueError("Qoder CN requires a Personal Access Token")
        # prepare_pool_entry returns the shim secret, then Hermes passes that
        # same runtime credential back to create_client. Do not mistake it for
        # a new PAT (which would leak the secret to Qoder's PAT exchange).
        with self._lock:
            for current in self._gateways.values():
                if current._process.poll() is None and current.api_key == pat:
                    return current
            digest = hashlib.sha256(pat.encode()).hexdigest()
            current = self._gateways.get(digest)
            if current is not None and current._process.poll() is None:
                return current
            # Hold the lock while starting: concurrent pool/auth probes must not
            # spawn two processes for the same PAT.
            current = Gateway(pat, self._plugin_dir)
            self._gateways[digest] = current
            return current

    def close(self) -> None:
        with self._lock:
            gateways = list(self._gateways.values())
            self._gateways.clear()
        for gateway in gateways:
            gateway.close()


def create_client(manager: GatewayManager, **kwargs: Any) -> Any:
    """Construct an ordinary OpenAI client bound to this PAT's local gateway."""
    from openai import OpenAI

    gateway = manager.get(kwargs.get("api_key", ""))
    accepted = {
        key: value for key, value in kwargs.items()
        if key in ("timeout", "max_retries", "default_headers", "http_client")
    }
    accepted.setdefault("max_retries", 0)
    return OpenAI(
        api_key=gateway.api_key,
        base_url=gateway.base_url,
        **accepted,
    )


def prepare_pool_entry(manager: GatewayManager, entry: Any, pat: str) -> str:
    """Translate a pool PAT in place so later in-process rotations stay safe."""
    gateway = manager.get(pat)
    entry.access_token = gateway.api_key
    entry.base_url = gateway.base_url
    return gateway.api_key
