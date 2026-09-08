#!/usr/bin/env python3
"""
verify_github_app.py — verify a GitHub App installation token flow.

Run this once after creating a new GitHub App on a repo. It exchanges
the App's private key + App ID + installation ID for a short-lived
installation access token, then makes one harmless read-only API call
to confirm the wiring works end-to-end.

Inputs (read from `~/.hermes/.env`, values must be uncommented):
  GITHUB_APP_ID
  GITHUB_APP_PRIVATE_KEY_PATH
  GITHUB_APP_INSTALLATION_ID

Output:
  - OK / FAIL line per step
  - the App's expires_at for the install token (printed, not the token itself)
  - the response status of the harmless read

The script NEVER prints the JWT or the installation token. Both live
only in process-local variables; no /tmp files; no shell history.
Invoke directly with `python3 verify_github_app.py`.

Prereqs: python3 standard library only (no `pip install`).

# Why this script exists
This project's GitHub Issues tracker is on `awykoff/give-to-get` and is
the canonical record for bugs (per the 2026-09-08 bug-tracker decision).
The `give-to-get-bot` GitHub App is the identity that should post under
that tracker's umbrella — distinct from Aaron's personal account, so
the audit trail is honest. Before relying on the App, this verification
proves the wiring works end to end.

# Credential hygiene
Per the project's credential-handling rules: do NOT echo tokens, do NOT
put them in shell argv (process listing + history), do NOT write them
to /tmp files. Read the env values into Python and let them live as
local variables; the script only prints success/failure and metadata.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

ENV_PATH = os.path.expanduser("~/.hermes/.env")


def read_env_value(key):
    """Read `key=...` from ~/.hermes/.env. Skips lines starting with '#'.
    If only a commented stub is found, uses it (with a printed NOTE) so
    the script is forgiving during initial setup; the canonical path
    is for the line to be uncommented.
    """
    live_val = None
    commented_val = None
    with open(ENV_PATH) as f:
        for raw in f:
            line = raw.rstrip("\n")
            stripped = line.lstrip()
            if stripped.startswith("#"):
                content = stripped.lstrip("#").strip()
                if content.startswith(f"{key}="):
                    commented_val = content.split("=", 1)[1]
                continue
            if line.startswith(f"{key}="):
                live_val = line.split("=", 1)[1]
    if live_val:
        return live_val
    if commented_val:
        print(
            f"NOTE: {key} only present as commented stub; using stub value",
            file=sys.stderr,
        )
        return commented_val
    raise SystemExit(f"FATAL: {key} not found in {ENV_PATH}")


APP_ID = read_env_value("GITHUB_APP_ID")
PEM_PATH = read_env_value("GITHUB_APP_PRIVATE_KEY_PATH")
INSTALLATION_ID = read_env_value("GITHUB_APP_INSTALLATION_ID")

if not os.path.isfile(PEM_PATH):
    raise SystemExit(f"FATAL: PEM not found at {PEM_PATH}")

# --- Step 1: build JWT signed with the App's private key ---
now = int(time.time())
jwt_header = {"alg": "RS256", "typ": "JWT"}
jwt_payload = {"iat": now - 60, "exp": now + 9 * 60, "iss": APP_ID}


def b64url(data):
    import base64
    if isinstance(data, dict):
        data = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


header_b64 = b64url(jwt_header)
payload_b64 = b64url(jwt_payload)
signing_input = f"{header_b64}.{payload_b64}".encode()

# Sign via openssl subprocess so the private key never lives in
# Python memory longer than necessary.
sig_proc = subprocess.run(
    ["openssl", "dgst", "-sha256", "-sign", PEM_PATH],
    input=signing_input,
    capture_output=True,
    check=True,
)
import base64
sig_b64 = base64.urlsafe_b64encode(sig_proc.stdout).rstrip(b"=").decode()
jwt_token = f"{signing_input.decode()}.{sig_b64}"

# --- Step 2: exchange JWT for installation access token ---
req = urllib.request.Request(
    f"https://api.github.com/app/installations/{INSTALLATION_ID}/access_tokens",
    method="POST",
    headers={
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "give-to-get-bot-verification",
    },
)
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        token_body = json.loads(resp.read())
except urllib.error.HTTPError as e:
    body = e.read().decode(errors="replace")
    print(f"FAIL: token exchange returned HTTP {e.code}")
    print(f"  body[:200]: {body[:200]}")
    sys.exit(1)

install_token = token_body.get("token")
expires_at = token_body.get("expires_at")
if not install_token:
    print(f"FAIL: token exchange returned no 'token' field")
    print(f"  body: {token_body}")
    sys.exit(1)

print(f"OK: installation token obtained, expires_at={expires_at}")

# --- Step 3: harmless read against issues/4 ---
# Use the installation token. Don't print it.
req2 = urllib.request.Request(
    "https://api.github.com/repos/awykoff/give-to-get/issues/4",
    headers={
        "Authorization": f"Bearer {install_token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "give-to-get-bot-verification",
    },
)
try:
    with urllib.request.urlopen(req2, timeout=15) as resp2:
        issue = json.loads(resp2.read())
except urllib.error.HTTPError as e:
    body = e.read().decode(errors="replace")
    print(f"FAIL: read issues/4 returned HTTP {e.code}")
    print(f"  body[:300]: {body[:300]}")
    sys.exit(1)

title = issue.get("title", "(no title)")
state = issue.get("state", "(no state)")
print(f"OK: GET issues/4 succeeded")
print(f"  title : {title}")
print(f"  state : {state}")
print(f"  app_id={APP_ID} installation_id={INSTALLATION_ID}")
print(
    f"  -> App is wired correctly. Use the installation token (NOT the "
    f"PAT) for future Issues work. Sign with footer "
    f"'— Ananda (Hermes, local dev agent)'."
)
