"""Qoder credit balance for Hermes `/usage`.

Hermes asks a provider profile for an ``AccountUsageSnapshot``; this module turns
the gateway's ``GET /v1/usage`` payload (Qoder's ``qoderUsage`` shape) into one.

Two rules come from the Qoder side and are easy to get wrong:

* ``expiresAt`` on ``qoderUsage`` is the **plan / trial** expiry, not a credit
  expiry — the quota buckets carry no expiry at all. It is therefore a detail
  line, never a window, so nobody reads "plan ends" as "credits end".
* Dedicated resource packages are a separate pool that only pays for specific
  models. They are not summed into the balance here (Qoder CN does not send them
  at all); adding them would show a number the user cannot spend.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from typing import Any, Mapping
import urllib.request

SOURCE = "qoder_usage_api"
TITLE = "Qoder credits"

# (payload key, label, size key) — `userQuota`/`addOnQuota` are sized by `total`,
# the organization package by `cap`.
_BUCKETS = (
    ("userQuota", "Base quota", "total"),
    ("addOnQuota", "Add-on credits", "total"),
    ("orgResourcePackage", "Organization quota", "cap"),
)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _format_credits(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:.2f}"


def snapshot_from_payload(payload: Mapping[str, Any], *, provider: str) -> AccountUsageSnapshot | None:
    """Build a snapshot from one `qoderUsage` object, or None if it carries nothing."""
    # Imported here, not at module scope: this plugin loads *from inside*
    # `agent.account_usage.fetch_account_usage` → `get_provider_profile`, so a
    # module-level import of that very module raises "partially initialized
    # module" and Hermes' plugin boundary swallows it into a missing profile.
    from agent.account_usage import AccountUsageSnapshot, AccountUsageWindow

    if not isinstance(payload, Mapping):
        return None

    windows: list[AccountUsageWindow] = []
    details: list[str] = []
    remaining_total = 0.0
    counted = 0

    for key, label, size_key in _BUCKETS:
        bucket = payload.get(key)
        if not isinstance(bucket, Mapping):
            continue
        size = _number(bucket.get(size_key))
        if size is None or size <= 0:
            continue
        used = _number(bucket.get("used"))
        # `remaining` is absent on some upstream shapes; deriving it from used is
        # the same arithmetic the DSH card does, and keeps 0 meaning "spent".
        remaining = _number(bucket.get("remaining"))
        if remaining is None:
            remaining = max(size - (used or 0.0), 0.0)
        remaining_total += remaining
        counted += 1
        windows.append(AccountUsageWindow(
            label=label,
            used_percent=None if used is None else max(0.0, min(100.0, used / size * 100.0)),
            detail=f"{_format_credits(remaining)} of {_format_credits(size)} credits left",
        ))

    if counted == 0:
        return AccountUsageSnapshot(
            provider=provider,
            source=SOURCE,
            fetched_at=datetime.now(timezone.utc),
            title=TITLE,
            unavailable_reason="Qoder returned no credit balance for this account",
        )

    details.append(f"Credits remaining: {_format_credits(remaining_total)}")

    expires_at = _number(payload.get("expiresAt"))
    if expires_at is not None and expires_at > 0:
        # Milliseconds, and it is the *plan* expiry. Spelling that out keeps it
        # from being read as "my credits vanish on this date".
        plan_ends = datetime.fromtimestamp(expires_at / 1000.0, tz=timezone.utc)
        details.append(f"Plan expires: {plan_ends:%Y-%m-%d}")

    if payload.get("isQuotaExceeded") is True:
        details.append("Quota exhausted: yes")

    user_type = payload.get("userType")
    plan = user_type.strip() if isinstance(user_type, str) and user_type.strip() else None

    return AccountUsageSnapshot(
        provider=provider,
        source=SOURCE,
        fetched_at=datetime.now(timezone.utc),
        title=TITLE,
        plan=plan,
        windows=tuple(windows),
        details=tuple(details),
    )


def _resolve_credential(provider: str) -> str | None:
    """Find the PAT/secret when Hermes hands the hook no key.

    `hermes usage` calls the hook with ``api_key=None`` (it resolves the
    credential itself only for built-in fetchers), so a hook that needs a
    credential must run Hermes' own ladder — same order a session without a live
    agent uses: env → singleton store → credential pool.
    """
    from hermes_cli.runtime_provider import resolve_runtime_provider

    try:
        runtime = resolve_runtime_provider(requested=provider)
    except Exception:
        return None
    key = str(runtime.get("api_key") or "").strip()
    return key or None


def _looks_like_pat(token: str) -> bool:
    """Whether *token* is a Qoder Personal Access Token rather than a shim secret.

    Hermes passes ``/usage`` the credential the session runs on. For this provider
    that is the **loopback shim secret** (``prepare_pool_entry`` swapped it in), not
    the PAT: starting a gateway from it would send a local secret to Qoder's token
    exchange and 401. PATs are documented as ``pt-…``; a shim secret is 32 random
    bytes in base64url, so the prefix tells them apart.
    """
    return token.startswith("pt-")


def fetch_account_usage(manager: Any, api_key: str | None, *, base_url: str | None = None,
                        provider: str = "qoder-cn", timeout: float = 8.0) -> AccountUsageSnapshot | None:
    """Ask this PAT's loopback gateway for the balance it holds.

    The gateway owns the PAT and the PAT→jobToken exchange, so this never talks
    to Qoder directly and never sees the credential itself.

    Three callers hand this hook different things, and each needs its own answer:

    * ``hermes usage --provider qoder-cn`` passes ``api_key=None`` — the credential
      is resolved here through Hermes' own ladder.
    * A live session's ``/usage`` passes whatever its route carries, which for this
      provider is the running gateway's **secret** (``prepare_pool_entry`` replaced
      the PAT in place). That secret names a gateway that already exists, so reuse
      it instead of treating it as a PAT.
    * With a pool, that secret belongs to a gateway this module may no longer hold
      (a plugin reload rebuilds it), and the ladder would resolve *some* PAT — not
      necessarily the session's account. Its ``base_url`` names the right gateway,
      so match on that before falling back to any credential.
    """
    token = (api_key or "").strip()
    gateway = manager.find(token) if token else None
    if gateway is None:
        gateway = manager.find_by_base_url(base_url)
    if gateway is None:
        key = token if _looks_like_pat(token) else None
        key = key or _resolve_credential(provider)
        if not key:
            return None
        gateway = manager.get(key)
    request = urllib.request.Request(
        f"{gateway.base_url}/usage",
        headers={"authorization": f"Bearer {gateway.api_key}", "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode())
    except Exception:
        # The hook's contract is fail-open: an unreachable gateway means "no
        # snapshot this time", not a broken provider.
        return None
    data = body.get("data") if isinstance(body, Mapping) else None
    return snapshot_from_payload(data, provider=provider) if isinstance(data, Mapping) else None