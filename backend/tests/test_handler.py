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


class FakeAgentRuntime:
    """Knowledge Base retrieve()."""

    def __init__(self, results=None):
        self.results = results or []
        self.request = None

    def retrieve(self, **request):
        self.request = request
        return {"retrievalResults": self.results}


class FakeRuntime:
    """bedrock-runtime converse()."""

    def __init__(self, reply=None):
        self.reply = reply if reply is not None else {"known": False, "answer": "", "doc_ids": []}
        self.request = None

    def converse(self, **request):
        self.request = request
        text = self.reply if isinstance(self.reply, str) else json.dumps(self.reply)
        return {"output": {"message": {"content": [{"text": text}]}}}


class FakeS3:
    def __init__(self):
        self.signed: list = []

    def generate_presigned_url(self, _operation, Params, ExpiresIn):
        self.signed.append((Params, ExpiresIn))
        return "https://archive.example/signed-source"


def make_clients(users=None, sessions=None, audit=None, bedrock=None, runtime=None, s3=None):
    return {
        "users_table": users or FakeTable(),
        "sessions_table": sessions or FakeTable(),
        "audit_table": audit or FakeTable(),
        "bedrock": bedrock or FakeAgentRuntime(),
        "bedrock_runtime": runtime or FakeRuntime(),
        "s3": s3 or FakeS3(),
    }


def chunk(doc_id: str, text: str = "Snippet from the document.") -> dict:
    return {"content": {"text": text}, "metadata": {"doc_id": doc_id}}


POLICY_ID = "HCC-POL-001"
CONSULT_ID = "HCC-CR-2026-0126"

CONFIG = {
    "knowledge_base_id": "KB12345678",
    "generation_model_arn": "arn:aws:bedrock:eu-central-1:123:inference-profile/eu.test",
    "archive_bucket": "clinic-test",
}


def request_filter(agent: FakeAgentRuntime) -> dict:
    return agent.request["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]


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

    def _ask(self, token, clients, agent, runtime, query="Question?", doc_id=""):
        clients["bedrock"], clients["bedrock_runtime"] = agent, runtime
        body = {"action": "summary" if doc_id else "ask", "channel": "web", "query": query}
        if doc_id:
            body["doc_id"] = doc_id
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

    def test_doctor_answer_cites_and_signs_source(self):
        token, clients, _ = self._login(DOCTOR)
        s3 = FakeS3()
        clients["s3"] = s3
        agent = FakeAgentRuntime([chunk(CONSULT_ID, "Diagnosis: essential hypertension.")])
        runtime = FakeRuntime({"known": True, "answer": "Essential hypertension.", "doc_ids": [CONSULT_ID]})
        status, body = self._ask(token, clients, agent, runtime)
        self.assertEqual(status, 200)
        self.assertFalse(body["is_unknown"])
        self.assertEqual(body["sources"][0]["title"], "Consultation Record Maria Nangolo 2026-10-05")
        self.assertEqual(body["sources"][0]["url"], "https://archive.example/signed-source")
        self.assertTrue(s3.signed[0][0]["Key"].startswith("archive/Medical_Consultations/"))
        self.assertIn("group_doctors", json.dumps(request_filter(agent)))
        self.assertEqual(runtime.request["modelId"], CONFIG["generation_model_arn"])

    def test_system_prompt_contains_todays_date(self):
        token, clients, _ = self._login(DOCTOR)
        runtime = FakeRuntime({"known": True, "answer": "Policy.", "doc_ids": [POLICY_ID]})
        self._ask(token, clients, FakeAgentRuntime([chunk(POLICY_ID)]), runtime)
        system = runtime.request["system"][0]["text"]
        self.assertIn(time.strftime("%Y-%m-%d", time.gmtime()), system)
        self.assertNotIn("{today}", system)

    def test_forbidden_chunk_never_reaches_the_model(self):
        # Even if retrieval somehow returned a consultation record, a clerk's model call never sees it.
        token, clients, _ = self._login(CLERK)
        runtime = FakeRuntime({"known": True, "answer": "Leaked!", "doc_ids": [CONSULT_ID]})
        status, body = self._ask(token, clients, FakeAgentRuntime([chunk(CONSULT_ID, "SECRET diagnosis")]), runtime)
        self.assertEqual(status, 200)
        self.assertTrue(body["is_unknown"])
        self.assertIsNone(runtime.request)

    def test_model_citing_unretrieved_document_is_ignored(self):
        token, clients, _ = self._login(DOCTOR)
        runtime = FakeRuntime({"known": True, "answer": "Something.", "doc_ids": ["HCC-PRF-1003"]})
        _, body = self._ask(token, clients, FakeAgentRuntime([chunk(POLICY_ID)]), runtime)
        self.assertTrue(body["is_unknown"])

    def test_model_saying_unknown_returns_unknown(self):
        token, clients, _ = self._login(DOCTOR)
        _, body = self._ask(token, clients, FakeAgentRuntime([chunk(POLICY_ID)]), FakeRuntime())
        self.assertTrue(body["is_unknown"])
        self.assertEqual(body["sources"], [])

    def test_model_reply_wrapped_in_text_is_parsed(self):
        token, clients, _ = self._login(DOCTOR)
        reply = 'Here you go:\n{"known": true, "answer": "Keep it confidential.", "doc_ids": ["HCC-POL-001"]}'
        _, body = self._ask(token, clients, FakeAgentRuntime([chunk(POLICY_ID)]), FakeRuntime(reply))
        self.assertFalse(body["is_unknown"])
        self.assertEqual(body["answer"], "Keep it confidential.")

    def test_summary_restricts_retrieval_to_document(self):
        token, clients, _ = self._login(DOCTOR)
        agent = FakeAgentRuntime([chunk(CONSULT_ID)])
        runtime = FakeRuntime({"known": True, "answer": "Summary.", "doc_ids": []})
        _, body = self._ask(token, clients, agent, runtime, doc_id=CONSULT_ID)
        self.assertFalse(body["is_unknown"])
        self.assertEqual(body["sources"][0]["doc_id"], CONSULT_ID)
        self.assertIn(CONSULT_ID, json.dumps(request_filter(agent)))

    def test_public_ask_uses_everyone_filter(self):
        agent = FakeAgentRuntime([chunk(POLICY_ID)])
        runtime = FakeRuntime({"known": True, "answer": "Do not discuss patients.", "doc_ids": [POLICY_ID]})
        status, body = handler.dispatch(
            {"action": "ask", "channel": "web", "query": "Confidentiality?"},
            make_clients(bedrock=agent, runtime=runtime), CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["is_unknown"])
        self.assertEqual(request_filter(agent), {"equals": {"key": "group_everyone", "value": "yes"}})

    def test_expired_token_rejected(self):
        token, clients, _ = self._login(DOCTOR)
        clients["sessions_table"].item = {
            "token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "user_id": "DOC-001",
            "expires_at": int(time.time()) - 1,
        }
        with self.assertRaises(handler.ArchiveError) as ctx:
            self._ask(token, clients, FakeAgentRuntime(), FakeRuntime())
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

    def test_ussd_audit_never_contains_pin(self):
        users = FakeTable(stored_user("3333", "DOC-001", DOCTOR[2]))
        audit = FakeTable()
        clients = make_clients(
            users=users, audit=audit, bedrock=FakeAgentRuntime([chunk(POLICY_ID)]),
            runtime=FakeRuntime({"known": True, "answer": "Keep it confidential.", "doc_ids": [POLICY_ID]}),
        )
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
        self.assertEqual(body["reference"], POLICY_ID)
        self.assertEqual(audit.items[0]["question"], "What is the confidentiality rule?")
        self.assertNotIn("3333", json.dumps(audit.items[0]))

    def test_unknown_action_returns_400(self):
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "explode"}, make_clients(), CONFIG)
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
