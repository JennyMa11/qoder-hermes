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