"""Run the Hopewell demo checks (hopewell-clinic-documents/TEST_QUESTIONS.md) against the live API.

Usage:  python backend/scripts/smoke_test.py https://<your-service>.onrender.com/archive

Standard library only. Uses the fictional demo staff accounts.
"""

import json
import sys
import urllib.error
import urllib.request

ACCOUNTS = {
    "CLK-001": "1111",  # Selma Amutenya, Administration
    "NUR-001": "2222",  # Sister Ndapewa Haufiku, Nursing
    "DOC-001": "3333",  # Dr Anna-Marie van Wyk, Doctors
    "LAB-001": "4444",  # Elias Shilongo, Laboratory
    "REC-001": "5555",  # Beata Nakale, Records
}

# (user, question, expectation shown next to the answer)
CHECKS = [
    ("DOC-001", "Which patients are allergic to penicillin?", "Maria Nangolo only"),
    ("DOC-001", "Who has appointments on 2026-11-24?", "Lydia 09:00, Joseph 10:30, Daniel 11:00"),
    ("DOC-001", "What was Daniel Ipinge's haemoglobin and was it flagged?", "8.9 g/dL, LOW"),
    ("DOC-001", "What is Maria Nangolo's HIV status?", "I don't know"),
    ("CLK-001", "What is Maria Nangolo's diagnosis?", "I don't know (no access)"),
    ("DOC-001", "What is Maria Nangolo's diagnosis?", "Essential hypertension"),
    ("CLK-001", "When is Joseph Mbumba's next appointment?", "2026-11-24 10:30 with DOC-001"),
    ("LAB-001", "What medication is Tobias Hamutenya on?", "I don't know (no access)"),
    ("LAB-001", "What was Tobias Hamutenya's HbA1c?", "8.1%, HIGH"),
    (None, "What is the clinic's confidentiality rule on discussing patients?", "HCC-POL-001 (public)"),
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
    url = sys.argv[1]

    status, _ = call(url, {"action": "verify", "user_id": "DOC-001", "pin": "0000", "channel": "web"})
    print(("ok  " if status == 401 else "FAIL") + f" wrong PIN rejected (HTTP {status})")

    tokens = {}
    for user_id, pin in ACCOUNTS.items():
        status, data = call(url, {"action": "verify", "user_id": user_id, "pin": pin, "channel": "web"})
        if status != 200 or not data.get("token"):
            raise SystemExit(f"FAIL verify {user_id}: HTTP {status} {data}")
        tokens[user_id] = data["token"]
        _, docs = call(url, {"action": "documents"}, data["token"])
        print(f"ok   verify {user_id} groups={data['groups']} documents={len(docs.get('documents', []))}")

    for user_id, question, expected in CHECKS:
        status, data = call(url, {"action": "ask", "channel": "web", "query": question}, tokens.get(user_id, ""))
        who = user_id or "PUBLIC"
        if status != 200:
            print(f"\nFAIL [{who}] {question}: HTTP {status} {data}")
            continue
        refs = ", ".join(s.get("reference", "?") for s in data.get("sources", []))
        print(f"\n[{who}] {question}\n  expected: {expected}\n  unknown={data.get('is_unknown')} sources=[{refs}]")
        print("  " + data.get("answer", "").replace("\n", "\n  "))

    status, data = call(url, {"action": "logs"}, tokens["REC-001"])
    print(f"\n{'ok  ' if status == 200 else 'FAIL'} audit log for REC-001 (all users): {len(data.get('logs', []))} entries")


if __name__ == "__main__":
    main()
