import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import handler


def stored_user(pin: str, user_id: str, role: str, patient_id: str = "") -> dict:
    salt = b"archive-test-salt"
    pin_hash = hashlib.scrypt(pin.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    user = {
        "user_id": user_id,
        "name": user_id,
        "role": role,
        "pin_salt": salt.hex(),
        "pin_hash": pin_hash.hex(),
    }
    if patient_id:
        user["patient_id"] = patient_id
    return user


class FakeTable:
    def __init__(self, item=None):
        self.item = dict(item) if item else None
        self.items: list = []

    def get_item(self, **kwargs):
        # Check the initial item first (simple single-row tables).
        if self.item is not None:
            return {"Item": dict(self.item)}
        # Fall back to scanning put_item history by matching all key fields.
        key = kwargs.get("Key", {})
        for stored in self.items:
            if all(stored.get(k) == v for k, v in key.items()):
                return {"Item": dict(stored)}
        return {}

    def put_item(self, **kwargs):
        self.items.append(kwargs["Item"])

    def query(self, **_kwargs):
        return {"Items": []}

    def update_item(self, **kwargs):
        expression = kwargs["UpdateExpression"]
        if "failed_attempts = if_not_exists" in expression:
            count = self.item.get("failed_attempts", 0) + 1
            self.item["failed_attempts"] = count
            return {"Attributes": {"failed_attempts": count}}
        if "#locked = :until" in expression:
            self.item["locked_until"] = kwargs["ExpressionAttributeValues"][":until"]
        elif "REMOVE #locked" in expression:
            self.item["failed_attempts"] = 0
            self.item.pop("locked_until", None)
        return {}


class FakeBedrock:
    def __init__(self, result):
        self.result = result
        self.request = None

    def retrieve_and_generate(self, **request):
        self.request = request
        return self.result


class FakeS3:
    def __init__(self):
        self.signed: list = []

    def generate_presigned_url(self, _operation, Params, ExpiresIn):
        self.signed.append((Params, ExpiresIn))
        return "https://archive.example/signed-source"


def make_clients(users=None, sessions=None, audit=None, bedrock=None, s3=None):
    return {
        "users_table":    users    or FakeTable(),
        "sessions_table": sessions or FakeTable(),
        "audit_table":    audit    or FakeTable(),
        "bedrock":        bedrock  or FakeBedrock({"output": {"text": ""}, "citations": []}),
        "s3":             s3       or FakeS3(),
    }


GOOD_BEDROCK = {
    "output": {"text": "The clinic visits on the first Tuesday."},
    "citations": [
        {
            "retrievedReferences": [
                {
                    "content": {"text": "The mobile clinic visits on the first Tuesday."},
                    "location": {"s3Location": {"uri": "s3://clinic-test/archive/schedule.txt"}},
                    "metadata": {"doc_id": "clinic-schedule", "title": "Clinic Schedule"},
                }
            ]
        }
    ],
}

CONFIG = {
    "knowledge_base_id":    "KB12345678",
    "generation_model_arn": "arn:aws:bedrock:eu-north-1::foundation-model/test",
    "archive_bucket":       "clinic-test",
}


class AccessFilterTests(unittest.TestCase):

    def test_patient_filter_allows_public_and_only_own_patient_id(self):
        f = handler.access_filter({"role": "patient", "patient_id": "P042"})
        self.assertEqual(
            f,
            {
                "orAll": [
                    {"equals": {"key": "access_level", "value": "public"}},
                    {
                        "andAll": [
                            {"equals": {"key": "access_level", "value": "patient"}},
                            {"equals": {"key": "patient_id", "value": "P042"}},
                        ]
                    },
                ]
            },
        )

    def test_summary_adds_document_id_to_role_filter(self):
        f = handler.access_filter({"role": "clerk"}, doc_id="oxygen-contract")
        self.assertEqual(f["andAll"][0]["orAll"][1]["equals"]["value"], "staff")
        self.assertEqual(f["andAll"][1], {"equals": {"key": "doc_id", "value": "oxygen-contract"}})

    def test_patient_summary_requires_both_own_scope_and_requested_document(self):
        f = handler.access_filter({"role": "patient", "patient_id": "P042"}, doc_id="report-p099")
        patient_scope = f["andAll"][0]["orAll"][1]["andAll"]
        self.assertEqual(patient_scope[1]["equals"]["value"], "P042")
        self.assertEqual(f["andAll"][1]["equals"]["value"], "report-p099")

    def test_nurse_and_admin_see_all_access_levels(self):
        for role in ("nurse", "admin"):
            f = handler.access_filter({"role": role, "patient_id": ""})
            levels = {c["equals"]["value"] for c in f["orAll"]}
            self.assertEqual(levels, {"public", "staff", "patient"})


class AuthTests(unittest.TestCase):

    def test_public_fallback_when_pin_empty_and_allow_public(self):
        p = handler.authenticate("", "", FakeTable(), allow_public=True)
        self.assertEqual(p["role"], "public")
        self.assertEqual(p["user_id"], "PUBLIC")

    def test_invalid_pin_rejected(self):
        users = FakeTable(stored_user("1111", "P042", "patient", "P042"))
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.authenticate("P042", "9999", users)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(users.item["failed_attempts"], 1)

    def test_lockout_after_max_failed_attempts(self):
        users = FakeTable(stored_user("1111", "P042", "patient", "P042"))
        for _ in range(handler.MAX_FAILED_ATTEMPTS):
            with self.assertRaises(handler.ArchiveError):
                handler.authenticate("P042", "9999", users)
        self.assertGreater(users.item.get("locked_until", 0), 0)
        # Correct PIN also rejected while locked.
        with self.assertRaises(handler.ArchiveError):
            handler.authenticate("P042", "1111", users)


class DispatchTests(unittest.TestCase):

    def _verify_then_token(self, role: str, user_id: str, pin: str, patient_id: str = "") -> tuple[str, dict]:
        """Run verify action and return (token, clients) for follow-up requests."""
        users    = FakeTable(stored_user(pin, user_id, role, patient_id))
        sessions = FakeTable()
        clients  = make_clients(users=users, sessions=sessions)
        status, body = handler.dispatch(
            {"action": "verify", "user_id": user_id, "pin": pin, "channel": "web"},
            clients, CONFIG,
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["authenticated"])
        token = body["token"]
        # sessions table now has one item with token_hash
        self.assertEqual(len(sessions.items), 1)
        return token, clients

    def test_verify_returns_token_name_role_scope(self):
        token, _ = self._verify_then_token("patient", "P042", "1111", "P042")
        self.assertIsInstance(token, str)
        self.assertGreater(len(token), 10)

    def test_public_ask_uses_public_filter(self):
        bedrock = FakeBedrock(GOOD_BEDROCK)
        clients = make_clients(bedrock=bedrock, s3=FakeS3())
        status, body = handler.dispatch(
            {"action": "ask", "channel": "web", "query": "When is the clinic?"},
            clients, CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        vec_filter = bedrock.request["retrieveAndGenerateConfiguration"][
            "knowledgeBaseConfiguration"
        ]["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]
        self.assertEqual(vec_filter, {"equals": {"key": "access_level", "value": "public"}})

    def test_bearer_token_authenticates_subsequent_ask(self):
        token, clients = self._verify_then_token("patient", "P042", "1111", "P042")
        bedrock = FakeBedrock(GOOD_BEDROCK)
        clients["bedrock"] = bedrock
        clients["s3"] = FakeS3()
        status, body = handler.dispatch(
            {"action": "ask", "channel": "web", "query": "What did my report say?"},
            clients, CONFIG, auth_header=f"Bearer {token}",
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["is_unknown"])
        # patient filter must include their patient_id
        vec_filter = bedrock.request["retrieveAndGenerateConfiguration"][
            "knowledgeBaseConfiguration"
        ]["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]
        patient_filter_values = str(vec_filter)
        self.assertIn("P042", patient_filter_values)

    def test_expired_token_rejected(self):
        import time
        token, clients = self._verify_then_token("nurse", "NRS-1", "4444")
        # Manually expire the session.
        clients["sessions_table"].item = {
            "token_hash": __import__("hashlib").sha256(token.encode()).hexdigest(),
            "user_id": "NRS-1",
            "expires_at": int(time.time()) - 1,
        }
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch(
                {"action": "ask", "channel": "web", "query": "Any question"},
                clients, CONFIG, auth_header=f"Bearer {token}",
            )
        self.assertEqual(ctx.exception.status_code, 401)

    def test_logs_rejected_for_patient_role(self):
        token, clients = self._verify_then_token("patient", "P042", "1111", "P042")
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch(
                {"action": "logs", "channel": "web", "query": ""},
                clients, CONFIG, auth_header=f"Bearer {token}",
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_bedrock_no_citations_returns_unknown(self):
        bedrock = FakeBedrock({"output": {"text": "Possibly true."}, "citations": []})
        result = handler.query_knowledge_base(
            "What is the answer?",
            {"role": "public"},
            "", bedrock, FakeS3(),
            CONFIG["knowledge_base_id"],
            CONFIG["generation_model_arn"],
            CONFIG["archive_bucket"],
        )
        self.assertTrue(result["is_unknown"])
        self.assertEqual(result["sources"], [])

    def test_source_url_not_signed_for_wrong_bucket(self):
        s3 = FakeS3()
        src = handler._source_from_reference(
            {
                "location": {"s3Location": {"uri": "s3://other-bucket/archive/file.txt"}},
                "content": {"text": "text"},
                "metadata": {"doc_id": "x"},
            },
            s3, "clinic-test",
        )
        self.assertNotIn("url", src)
        self.assertEqual(s3.signed, [])

    def test_ussd_audit_never_contains_pin(self):
        users = FakeTable(stored_user("1111", "P042", "patient", "P042"))
        audit = FakeTable()
        bedrock = FakeBedrock(GOOD_BEDROCK)
        clients = make_clients(users=users, sessions=FakeTable(), audit=audit, bedrock=bedrock, s3=FakeS3())
        status, _ = handler.dispatch(
            {
                "action": "ussd",
                "user_id": "P042",
                "channel": "ussd",
                "query": "",
                "ussd_session_id": "session-1",
                "ussd_text": "P042*1111*3*When is my follow-up?",
            },
            clients, CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        self.assertEqual(audit.items[0]["question"], "When is my follow-up?")
        self.assertNotIn("1111", json.dumps(audit.items[0]))

    def test_unknown_action_returns_400(self):
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "explode"}, make_clients(), CONFIG)
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
