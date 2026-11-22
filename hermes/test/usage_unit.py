"""Unit tests for the Qoder balance → AccountUsageSnapshot mapping.

Runs without Hermes: ``agent.account_usage`` is stubbed in ``sys.modules``
before ``usage`` is imported, which also proves the module has no module-level
dependency on it (the circular-import trap that broke ``hermes usage``).

    python3 hermes/test/usage_unit.py
"""
from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN))


@dataclass(frozen=True)
class AccountUsageWindow:
    label: str
    used_percent: float | None = None
    reset_at: datetime | None = None
    detail: str | None = None
    scope: str = "account"


@dataclass(frozen=True)
class AccountUsageSnapshot:
    provider: str
    source: str
    fetched_at: datetime
    title: str = "Account limits"
    plan: str | None = None
    windows: tuple = field(default_factory=tuple)
    details: tuple = field(default_factory=tuple)
    unavailable_reason: str | None = None


stub = types.ModuleType("agent.account_usage")
stub.AccountUsageWindow = AccountUsageWindow
stub.AccountUsageSnapshot = AccountUsageSnapshot
package = types.ModuleType("agent")
package.__path__ = []
sys.modules.setdefault("agent", package)
sys.modules["agent.account_usage"] = stub

import usage  # noqa: E402  (import order is the point of this file)


def test_two_buckets():
    snapshot = usage.snapshot_from_payload(
        {
            "userType": "personal_standard",
            "expiresAt": 4102444800000,
            "userQuota": {"total": 1000, "used": 250, "remaining": 750},
            "addOnQuota": {"total": 200, "used": 0, "remaining": 200},
            "isQuotaExceeded": False,
        },
        provider="qoder-cn",
    )
    assert snapshot.provider == "qoder-cn"
    assert snapshot.source == "qoder_usage_api"
    assert snapshot.title == "Qoder credits"
    assert snapshot.plan == "personal_standard"
    assert [window.label for window in snapshot.windows] == ["Base quota", "Add-on credits"]
    assert snapshot.windows[0].used_percent == 25.0
    assert snapshot.windows[0].detail == "750 of 1000 credits left"
    assert "Credits remaining: 950" in snapshot.details
    # expiresAt is the plan expiry, never a credit expiry.
    assert "Plan expires: 2100-01-01" in snapshot.details
    assert all(window.reset_at is None for window in snapshot.windows)
    assert snapshot.unavailable_reason is None


def test_organization_quota_is_sized_by_cap():
    snapshot = usage.snapshot_from_payload(
        {"orgResourcePackage": {"cap": 400, "used": 100, "remaining": 300, "available": True}},
        provider="qoder-cn",
    )
    assert [window.label for window in snapshot.windows] == ["Organization quota"]
    assert snapshot.windows[0].used_percent == 25.0
    assert snapshot.windows[0].detail == "300 of 400 credits left"
    assert "Credits remaining: 300" in snapshot.details


def test_missing_remaining_is_derived_from_used():
    snapshot = usage.snapshot_from_payload(
        {"userQuota": {"total": 100, "used": 40}},
        provider="qoder-cn",
    )
    assert snapshot.windows[0].used_percent == 40.0
    assert snapshot.windows[0].detail == "60 of 100 credits left"
    assert "Credits remaining: 60" in snapshot.details


def test_empty_payload_reports_unavailable():
    snapshot = usage.snapshot_from_payload({}, provider="qoder-cn")
    assert snapshot.windows == ()
    assert snapshot.unavailable_reason


def test_zero_sized_bucket_is_skipped():
    snapshot = usage.snapshot_from_payload(
        {"userQuota": {"total": 0, "used": 0}, "addOnQuota": {"total": 50, "used": 50}},
        provider="qoder-cn",
    )
    assert [window.label for window in snapshot.windows] == ["Add-on credits"]
    assert snapshot.windows[0].used_percent == 100.0
    assert "Credits remaining: 0" in snapshot.details


def test_quota_exhausted_and_fractional_credits():
    snapshot = usage.snapshot_from_payload(
        {"userQuota": {"total": 1000, "used": 1000, "remaining": 0},
         "addOnQuota": {"total": 10.5, "used": 0.5, "remaining": 10},
         "isQuotaExceeded": True},
        provider="qoder-cn",
    )
    assert "Quota exhausted: yes" in snapshot.details
    assert "Credits remaining: 10" in snapshot.details
    assert snapshot.windows[1].detail == "10 of 10.50 credits left"


def test_boolean_and_string_sizes_are_ignored():
    # bool is an int subclass in Python; True must not become a 1-credit quota.
    snapshot = usage.snapshot_from_payload(
        {"userQuota": {"total": True, "used": 1}, "addOnQuota": {"total": "100", "used": 0}},
        provider="qoder-cn",
    )
    assert snapshot.unavailable_reason


class _Gateway:
    def __init__(self, pat: str, secret: str, port: int = 1):
        self.pat = pat
        self.api_key = secret
        self.base_url = f"http://127.0.0.1:{port}/v1"


class _Manager:
    """Stands in for GatewayManager: records every credential it was asked to own."""

    def __init__(self, live=()):
        self.live = list(live)
        self.started: list[str] = []

    def find(self, token):
        return next((gateway for gateway in self.live if gateway.api_key == token), None)

    def find_by_base_url(self, base_url):
        wanted = (base_url or "").strip().rstrip("/")
        if not wanted:
            return None
        return next((gateway for gateway in self.live if gateway.base_url.rstrip("/") == wanted), None)

    def get(self, pat):
        self.started.append(pat)
        gateway = _Gateway(pat, f"secret-for-{pat}", port=2)
        self.live.append(gateway)
        return gateway


def _capture_fetch(monkeypatch_calls):
    """Patch urlopen to answer /usage with one balance and record the caller's secret."""
    real = usage.urllib.request.urlopen

    class _Response:
        def __init__(self, body):
            self._body = body

        def read(self):
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(request, timeout=None):
        monkeypatch_calls.append(request)
        body = b'{"object":"usage","data":{"userQuota":{"total":10,"used":4,"remaining":6}}}'
        return _Response(body)

    usage.urllib.request.urlopen = fake_urlopen
    return real


def test_session_secret_reuses_the_running_gateway():
    # A live session's /usage hands over the loopback secret, not the PAT.
    gateway = _Gateway("pt-example-only", "shim-secret")
    manager = _Manager(live=[gateway])
    calls = []
    real = _capture_fetch(calls)
    resolved = []
    real_resolve = usage._resolve_credential
    usage._resolve_credential = lambda provider: resolved.append(provider) or "pt-example-only"
    try:
        snapshot = usage.fetch_account_usage(manager, "shim-secret")
    finally:
        usage.urllib.request.urlopen = real
        usage._resolve_credential = real_resolve
    assert snapshot is not None
    assert snapshot.windows[0].detail == "6 of 10 credits left"
    assert manager.started == []  # never spawn a gateway from a local secret
    assert resolved == []  # and no need to resolve a PAT when one is already live
    assert calls[0].full_url == "http://127.0.0.1:1/v1/usage"


def test_stale_secret_falls_back_to_the_real_pat():
    # After a plugin reload the running gateway belongs to the previous module, so
    # this manager cannot find it by secret OR by base URL. Treating the secret as
    # a PAT would 401 at Qoder.
    manager = _Manager()
    calls = []
    real = _capture_fetch(calls)
    real_resolve = usage._resolve_credential
    usage._resolve_credential = lambda provider: "pt-example-only"
    try:
        snapshot = usage.fetch_account_usage(manager, "stale-shim-secret")
    finally:
        usage.urllib.request.urlopen = real
        usage._resolve_credential = real_resolve
    assert snapshot is not None
    assert manager.started == ["pt-example-only"]


def test_base_url_picks_the_pooled_account_the_session_runs_on():
    # Two accounts in the pool; the session runs on the second. Its secret belongs to
    # a gateway this module no longer holds, and the ladder would resolve the FIRST
    # PAT — the wrong account's balance. The route's base_url must win.
    first = _Gateway("pt-example-only", "secret-one", port=11)
    second = _Gateway("pt-example-other", "secret-two", port=12)
    manager = _Manager(live=[first, second])
    calls = []
    real = _capture_fetch(calls)
    real_resolve = usage._resolve_credential
    usage._resolve_credential = lambda provider: "pt-example-only"
    try:
        snapshot = usage.fetch_account_usage(
            manager, "secret-two-rotated", base_url="http://127.0.0.1:12/v1")
    finally:
        usage.urllib.request.urlopen = real
        usage._resolve_credential = real_resolve
    assert snapshot is not None
    assert manager.started == []
    assert calls[0].full_url == "http://127.0.0.1:12/v1/usage"


def test_unknown_base_url_still_resolves_a_credential():
    manager = _Manager()
    calls = []
    real = _capture_fetch(calls)
    real_resolve = usage._resolve_credential
    usage._resolve_credential = lambda provider: "pt-example-only"
    try:
        snapshot = usage.fetch_account_usage(
            manager, "stale-shim-secret", base_url="qoder-cn://local/v1")
    finally:
        usage.urllib.request.urlopen = real
        usage._resolve_credential = real_resolve
    assert snapshot is not None
    assert manager.started == ["pt-example-only"]


def test_pat_from_a_pool_entry_starts_its_own_gateway():
    manager = _Manager()
    calls = []
    real = _capture_fetch(calls)
    real_resolve = usage._resolve_credential
    usage._resolve_credential = lambda provider: (_ for _ in ()).throw(AssertionError("must not resolve"))
    try:
        snapshot = usage.fetch_account_usage(manager, "pt-example-only")
    finally:
        usage.urllib.request.urlopen = real
        usage._resolve_credential = real_resolve
    assert snapshot is not None
    assert manager.started == ["pt-example-only"]


def test_no_credential_anywhere_returns_none():
    manager = _Manager()
    real_resolve = usage._resolve_credential
    usage._resolve_credential = lambda provider: None
    try:
        assert usage.fetch_account_usage(manager, None) is None
        assert usage.fetch_account_usage(manager, "shim-secret") is None
    finally:
        usage._resolve_credential = real_resolve
    assert manager.started == []


def main():
    failures = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        try:
            function()
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
        else:
            print(f"ok {name}")
    if failures:
        raise SystemExit(f"{failures} usage test(s) failed")
    print("PASS: credit mapping")


if __name__ == "__main__":
    main()