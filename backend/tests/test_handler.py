import hashlib
import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import handler


def stored_user(pin: str, user_id: str, groups: list) -> dict:
    salt = b"archive-test-salt"
    pin_hash = hashlib.scrypt(pin.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return {
        "user_id": user_id,
        "name": user_id,
        "groups": groups,
        "pin_salt": salt.hex(),
        "pin_hash": pin_hash.hex(),
    }


DOCTOR = ("DOC-001", "3333", ["Doctors", "Everyone"])
CLERK = ("CLK-001", "1111", ["Administration", "Everyone"])
LAB = ("LAB-001", "4444", ["Laboratory", "Everyone"])
RECORDS = ("REC-001", "5555", ["Records", "Everyone"])


class FakeTable:
    def __init__(self, item=None):
        self.item = dict(item) if item else None
        self.items: list = []
        self.last_query: dict = {}

    def get_item(self, **kwargs):
        if self.item is not None:
            return {"Item": dict(self.item)}
        key = kwargs.get("Key", {})
        for stored in self.items:
            if all(stored.get(k) == v for k, v in key.items()):
                return {"Item": dict(stored)}
        return {}

    def put_item(self, **kwargs):
        self.items.append(kwargs["Item"])

    def query(self, **kwargs):
        self.last_query = kwargs
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
        "users_table": users or FakeTable(),
        "sessions_table": sessions or FakeTable(),
        "audit_table": audit or FakeTable(),
        "bedrock": bedrock or FakeBedrock({"output": {"text": ""}, "citations": []}),
        "s3": s3 or FakeS3(),
    }


def bedrock_citing(doc_id: str, key: str, text: str = "Answer from the archive.") -> dict:
    return {
        "output": {"text": text},
        "citations": [
            {
                "retrievedReferences": [
                    {
                        "content": {"text": "Snippet from the document."},
                        "location": {"s3Location": {"uri": f"s3://clinic-test/{key}"}},
                        "metadata": {"doc_id": doc_id},
                    }
                ]
            }
        ],
    }


POLICY = bedrock_citing("HCC-POL-001", "archive/Clinic_Policies/HCC-POL-001_Clinic_Confidentiality_Policy.txt")
CONSULTATION = bedrock_citing(
    "HCC-CR-2026-0126",
    "archive/Medical_Consultations/HCC-CR-2026-0126_Consultation_Record_Maria_Nangolo_2026_10_05.txt",
)

CONFIG = {
    "knowledge_base_id": "KB12345678",
    "generation_model_arn": "arn:aws:bedrock:eu-central-1::foundation-model/test",
    "archive_bucket": "clinic-test",
}


def request_filter(bedrock: FakeBedrock) -> dict:
    return bedrock.request["retrieveAndGenerateConfiguration"]["knowledgeBaseConfiguration"][
        "retrievalConfiguration"
    ]["vectorSearchConfiguration"]["filter"]


class CatalogTests(unittest.TestCase):
    def test_catalog_has_all_hopewell_documents(self):
        self.assertEqual(len(handler.DOCUMENTS), 59)

    def test_clerk_cannot_see_consultation_records(self):
        docs = handler.accessible_documents({"groups": CLERK[2]})
        types = {d["type"] for d in docs}
        self.assertIn("Appointment Register", types)
        self.assertNotIn("Consultation Record", types)
        self.assertNotIn("Medication Record", types)

    def test_lab_sees_lab_reports_but_not_medication(self):
        types = {d["type"] for d in handler.accessible_documents({"groups": LAB[2]})}
        self.assertIn("Laboratory Report", types)
        self.assertNotIn("Medication Record", types)

    def test_records_sees_everything(self):
        self.assertEqual(len(handler.accessible_documents({"groups": RECORDS[2]})), 59)

    def test_public_sees_only_everyone_documents(self):
        docs = handler.accessible_documents(handler.PUBLIC_PRINCIPAL)
        self.assertEqual({tuple(d["groups"]) for d in docs}, {("Everyone",)})


class AccessFilterTests(unittest.TestCase):
    def test_filter_ors_every_group_flag(self):
        f = handler.access_filter({"groups": ["Doctors", "Everyone"]})
        self.assertEqual(
            f,
            {
                "orAll": [
                    {"equals": {"key": "group_doctors", "value": "yes"}},
                    {"equals": {"key": "group_everyone", "value": "yes"}},
                ]
            },
        )

    def test_single_group_uses_plain_equals(self):
        f = handler.access_filter(handler.PUBLIC_PRINCIPAL)
        self.assertEqual(f, {"equals": {"key": "group_everyone", "value": "yes"}})

    def test_summary_adds_document_id(self):
        f = handler.access_filter({"groups": ["Doctors", "Everyone"]}, doc_id="HCC-CR-2026-0126")
        self.assertEqual(f["andAll"][1], {"equals": {"key": "doc_id", "value": "HCC-CR-2026-0126"}})

    def test_invalid_document_id_rejected(self):
        with self.assertRaises(handler.ArchiveError):
            handler.access_filter({"groups": ["Doctors"]}, doc_id="../etc/passwd")

    def test_principal_without_groups_rejected(self):
        with self.assertRaises(handler.ArchiveError):
            handler.access_filter({"groups": []})


class AuthTests(unittest.TestCase):
    def test_public_fallback_when_pin_empty_and_allow_public(self):
        p = handler.authenticate("", "", FakeTable(), allow_public=True)
        self.assertEqual(p["role"], "public")
        self.assertEqual(p["groups"], ["Everyone"])

    def test_groups_loaded_and_everyone_added(self):
        users = FakeTable(stored_user("3333", "DOC-001", ["Doctors"]))
        p = handler.authenticate("DOC-001", "3333", users)
        self.assertEqual(p["groups"], ["Doctors", "Everyone"])
        self.assertEqual(p["role"], "doctors")

    def test_account_without_staff_group_rejected(self):
        users = FakeTable(stored_user("3333", "X-1", ["Everyone"]))
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.authenticate("X-1", "3333", users)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_invalid_pin_rejected(self):
        users = FakeTable(stored_user("3333", "DOC-001", DOCTOR[2]))
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.authenticate("DOC-001", "9999", users)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(users.item["failed_attempts"], 1)

    def test_lockout_after_max_failed_attempts(self):
        users = FakeTable(stored_user("3333", "DOC-001", DOCTOR[2]))
        for _ in range(handler.MAX_FAILED_ATTEMPTS):
            with self.assertRaises(handler.ArchiveError):
                handler.authenticate("DOC-001", "9999", users)
        self.assertGreater(users.item.get("locked_until", 0), 0)
        with self.assertRaises(handler.ArchiveError):
            handler.authenticate("DOC-001", "3333", users)


class DispatchTests(unittest.TestCase):
    def _login(self, user: tuple) -> tuple[str, dict, dict]:
        user_id, pin, groups = user
        users = FakeTable(stored_user(pin, user_id, groups))
        sessions = FakeTable()
        clients = make_clients(users=users, sessions=sessions)
        status, body = handler.dispatch(
            {"action": "verify", "user_id": user_id, "pin": pin, "channel": "web"}, clients, CONFIG
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["authenticated"])
        return body["token"], clients, body

    def _ask(self, token, clients, bedrock, query="Question?", **extra):
        clients["bedrock"] = bedrock
        body = {"action": "ask", "channel": "web", "query": query, **extra}
        if "doc_id" in extra:
            body["action"] = "summary"
        return handler.dispatch(body, clients, CONFIG, auth_header=f"Bearer {token}")

    def test_verify_returns_groups_and_scope(self):
        _, _, body = self._login(DOCTOR)
        self.assertEqual(body["groups"], ["Doctors", "Everyone"])
        self.assertIn("Consultation Record", body["scope"])

    def test_documents_lists_only_accessible(self):
        token, clients, _ = self._login(CLERK)
        status, body = handler.dispatch({"action": "documents"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(status, 200)
        types = {d["type"] for d in body["documents"]}
        self.assertNotIn("Consultation Record", types)
        self.assertNotIn("groups", body["documents"][0])

    def test_doctor_ask_uses_group_filter_and_signs_source(self):
        token, clients, _ = self._login(DOCTOR)
        bedrock, s3 = FakeBedrock(CONSULTATION), FakeS3()
        clients["s3"] = s3
        status, body = self._ask(token, clients, bedrock)
        self.assertEqual(status, 200)
        self.assertFalse(body["is_unknown"])
        self.assertEqual(body["sources"][0]["title"], "Consultation Record Maria Nangolo 2026-10-05")
        self.assertEqual(body["sources"][0]["url"], "https://archive.example/signed-source")
        self.assertIn("group_doctors", json.dumps(request_filter(bedrock)))

    def test_prompt_contains_todays_date(self):
        token, clients, _ = self._login(DOCTOR)
        bedrock = FakeBedrock(POLICY)
        self._ask(token, clients, bedrock)
        prompt = bedrock.request["retrieveAndGenerateConfiguration"]["knowledgeBaseConfiguration"][
            "generationConfiguration"
        ]["promptTemplate"]["textPromptTemplate"]
        self.assertIn(time.strftime("%Y"), prompt)
        self.assertNotIn("{today}", prompt)
        self.assertIn("$search_results$", prompt)

    def test_answer_citing_forbidden_document_is_withheld(self):
        # Even if retrieval somehow returned a consultation record, a clerk gets no answer.
        token, clients, _ = self._login(CLERK)
        status, body = self._ask(token, clients, FakeBedrock(CONSULTATION))
        self.assertEqual(status, 200)
        self.assertTrue(body["is_unknown"])
        self.assertEqual(body["sources"], [])

    def test_public_ask_uses_everyone_filter(self):
        bedrock = FakeBedrock(POLICY)
        status, body = handler.dispatch(
            {"action": "ask", "channel": "web", "query": "Confidentiality?"},
            make_clients(bedrock=bedrock), CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        self.assertEqual(request_filter(bedrock), {"equals": {"key": "group_everyone", "value": "yes"}})

    def test_expired_token_rejected(self):
        token, clients, _ = self._login(DOCTOR)
        clients["sessions_table"].item = {
            "token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "user_id": "DOC-001",
            "expires_at": int(time.time()) - 1,
        }
        with self.assertRaises(handler.ArchiveError) as ctx:
            self._ask(token, clients, FakeBedrock(POLICY))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_logs_require_sign_in(self):
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "logs"}, make_clients(), CONFIG, auth_header="")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_staff_logs_are_own_records_logs_are_all(self):
        token, clients, _ = self._login(DOCTOR)
        handler.dispatch({"action": "logs"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertNotIn("IndexName", clients["audit_table"].last_query)
        token, clients, _ = self._login(RECORDS)
        handler.dispatch({"action": "logs"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(clients["audit_table"].last_query["IndexName"], "ByTimestamp")

    def test_bedrock_no_citations_returns_unknown(self):
        result = handler.query_knowledge_base(
            "What is the answer?", handler.PUBLIC_PRINCIPAL, "",
            FakeBedrock({"output": {"text": "Possibly true."}, "citations": []}), FakeS3(),
            CONFIG["knowledge_base_id"], CONFIG["generation_model_arn"], CONFIG["archive_bucket"],
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
        users = FakeTable(stored_user("3333", "DOC-001", DOCTOR[2]))
        audit = FakeTable()
        clients = make_clients(users=users, audit=audit, bedrock=FakeBedrock(POLICY))
        status, body = handler.dispatch(
            {
                "action": "ussd", "channel": "ussd", "query": "",
                "ussd_session_id": "session-1",
                "ussd_text": "DOC-001*3333*3*What is the confidentiality rule?",
            },
            clients, CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["next_ussd_screen"].startswith("END"))
        self.assertEqual(audit.items[0]["question"], "What is the confidentiality rule?")
        self.assertNotIn("3333", json.dumps(audit.items[0]))

    def test_unknown_action_returns_400(self):
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "explode"}, make_clients(), CONFIG)
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
