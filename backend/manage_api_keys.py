"""CLI for managing GASMAN public API keys.

Run inside the backend container (needs DATABASE_URL set):
    python manage_api_keys.py create "some-partner-project"
    python manage_api_keys.py list
    python manage_api_keys.py revoke "some-partner-project"

The raw key is only ever shown once, at creation time — only its SHA-256
hash is stored, so there's no admin HTTP endpoint that could leak or be
brute-forced into minting keys.
"""

import hashlib
import secrets
import sys

import database


def create(label: str) -> None:
    raw_key = "gm_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    database.insert_api_key(key_hash, label)
    print(f"Created API key for '{label}':\n")
    print(f"  {raw_key}\n")
    print("Save this now — it will not be shown again.")
    print("Use it as: Authorization: Bearer <key>")


def list_keys() -> None:
    keys = database.list_api_keys()
    if not keys:
        print("No API keys yet.")
        return
    for k in keys:
        status = "revoked" if k["revoked"] else "active"
        print(f"{k['label']:30} {status:8} requests={k['request_count']:<6} "
              f"created={k['created_at']} last_used={k['last_used_at']}")


def revoke(label: str) -> None:
    count = database.revoke_api_key(label)
    print(f"Revoked {count} key(s) labeled '{label}'." if count else f"No key found with label '{label}'.")


if __name__ == "__main__":
    database.init_db()
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "create" and len(sys.argv) == 3:
        create(sys.argv[2])
    elif cmd == "list":
        list_keys()
    elif cmd == "revoke" and len(sys.argv) == 3:
        revoke(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
