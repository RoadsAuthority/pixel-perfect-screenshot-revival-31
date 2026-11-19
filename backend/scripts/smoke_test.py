"""Run the demo checks (clinic-documents/TEST_QUESTIONS.md) against the live API.

Usage:  python backend/scripts/smoke_test.py https://<your-service>.onrender.com

Standard library only. Uses the fictional demo accounts.
"""

import json
import sys
import urllib.error
import urllib.request

ACCOUNTS = {
    "PAT-001": "1111",  # Maria Nangolo, patient
    "PAT-002": "2222",  # Johannes Haufiku, patient
    "PAT-003": "3333",  # Loide Iipinge, parent of Ndapandula
    "CLK-001": "4444",  # Selma Amutenya, clerk
    "NUR-001": "5555",  # Sister Ndapewa Haufiku, nurse
    "DOC-001": "6666",  # Dr Anna-Marie van Wyk, doctor
}

# (user or None for public, question, expected)
CHECKS = [
    ("CLK-001", "Which contracts or leases expire next year?", "Lease 2027-01-31; oxygen contract 2027-06-30"),
    ("PAT-001", "What allergies do I have?", "Penicillin"),
    ("PAT-002", "What are Maria Nangolo's allergies?", "I don't know (not his record)"),
    ("CLK-001", "What are Maria Nangolo's allergies?", "I don't know (clerk cannot see patient records)"),
    ("NUR-001", "What are Maria Nangolo's allergies?", "Penicillin"),
    ("PAT-002", "What was my HbA1c result?", "8.1 %, HIGH"),
    ("PAT-003", "When is my child's next vaccine due?", "MR1 on/after 2026-12-10"),
    (None, "When is the next vaccination outreach clinic?", "3 December 2026, Okahandja Park"),
    (None, "What should I do if a baby is choking?", "5 back blows, 5 chest thrusts"),
    ("PAT-001", "What is my blood group?", "Not tested / I don't know"),
    (None, "What is the price of a COVID vaccine?", "I don't know"),
]


def call(url: str, body: dict, token: str = "") -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read() or b"{}")
        except json.JSONDecodeError:
            return err.code, {}


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    url = sys.argv[1].rstrip("/")
    if not url.endswith("/archive"):
        url += "/archive"
        print(f"Using {url}")

    status, _ = call(url, {"action": "verify", "user_id": "PAT-001", "pin": "0000", "channel": "web"})
    print(("ok  " if status == 401 else "FAIL") + f" wrong PIN rejected (HTTP {status})")

    tokens = {}
    for user_id, pin in ACCOUNTS.items():
        status, data = call(url, {"action": "verify", "user_id": user_id, "pin": pin, "channel": "web"})
        if status != 200 or not data.get("token"):
            print(f"FAIL verify {user_id}: HTTP {status} {data}")
            continue
        tokens[user_id] = data["token"]
        _, docs = call(url, {"action": "documents"}, data["token"])
        print(f"ok   verify {user_id} groups={data['groups']} documents={len(docs.get('documents', []))}")

    for user_id, question, expected in CHECKS:
        if user_id and user_id not in tokens:
            continue
        status, data = call(url, {"action": "ask", "channel": "web", "query": question}, tokens.get(user_id, ""))
        who = user_id or "PUBLIC"
        if status != 200:
            print(f"\nFAIL [{who}] {question}: HTTP {status} {data}")
            continue
        refs = ", ".join(s.get("reference", "?") for s in data.get("sources", []))
        print(f"\n[{who}] {question}\n  expected: {expected}\n  unknown={data.get('is_unknown')} sources=[{refs}]")
        print("  " + data.get("answer", "").replace("\n", "\n  "))

    if "CLK-001" in tokens:
        status, data = call(url, {"action": "logs"}, tokens["CLK-001"])
        print(f"\n{'ok  ' if status == 200 else 'FAIL'} audit log for CLK-001 (all users): {len(data.get('logs', []))} entries")


if __name__ == "__main__":
    main()
