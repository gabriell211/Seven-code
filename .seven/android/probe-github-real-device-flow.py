#!/usr/bin/env python3
"""Unprivileged LIVE GitHub OAuth device-flow protocol probe.

This creates a throwaway pending GitHub device code but NEVER authorizes it,
uses OAuth tokens, or claims an authenticated user or Copilot Agent success.
No device_code or user_code is written to the Actions output/log.
"""
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request


def post(path, params):
    assert path in ("/login/device/code", "/login/oauth/access_token")
    req = urllib.request.Request(
        "https://github.com" + path,
        data=urllib.parse.urlencode(params).encode(),
        headers={"Accept": "application/json",
                 "User-Agent": "SevenCode-Android-OAuth-Protocol-Probe"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as response:
        if response.status != 200:
            raise RuntimeError("GitHub OAuth response was not HTTP 200")
        raw = response.read(16384)
    return json.loads(raw)


def main():
    source = pathlib.Path("extensions/github-authentication/src/config.ts").read_text()
    match = re.search(r"gitHubClientId:\s*'([A-Za-z0-9]{16,64})'", source)
    if not match:
        raise RuntimeError("GitHub OAuth public client ID is missing")
    client_id = match.group(1)
    first = post("/login/device/code", {
        "client_id": client_id, "scope": "read:user user:email"
    })
    if first.get("error"):
        # Only error codes, NEVER device_code/user_code/access_token.
        raise RuntimeError("Official GitHub Device Flow unavailable: " +
                           str(first["error"])[:70])
    if first.get("verification_uri") != "https://github.com/login/device":
        raise RuntimeError("Unexpected OAuth verification origin")
    code = first.get("device_code")
    user_code = first.get("user_code")
    if not isinstance(code, str) or len(code) < 20:
        raise RuntimeError("GitHub did not issue a device code")
    if not isinstance(user_code, str) or len(user_code) < 6:
        raise RuntimeError("GitHub did not issue a public display code")
    interval = int(first.get("interval", 5))
    expires = int(first.get("expires_in", 0))
    if not (1 <= interval <= 60 and 120 <= expires <= 1800):
        raise RuntimeError("Invalid GitHub Device Flow interval/lifetime")
    print("LIVE GitHub.com device/code: 200, valid one-time challenge (secret values redacted)")
    time.sleep(interval + 1)
    second = post("/login/oauth/access_token", {
        "client_id": client_id,
        "device_code": code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    })
    if second.get("access_token"):
        raise RuntimeError("Unexpected OAuth token issued without user approval")
    if second.get("error") not in ("authorization_pending", "slow_down"):
        raise RuntimeError("Official GitHub pending authorization rejected: " +
                           str(second.get("error", "missing-error"))[:70])
    print("LIVE GitHub.com access_token endpoint: pending authorization confirmed")
    print("PASS: OAuth endpoints and the configured client work; user approval NOT tested")


if __name__ == "__main__":
    main()
