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


DOCTOR = ("DOC-001", "6666", ["Staff", "Clinical", "Everyone"])
CLERK = ("CLK-001", "4444", ["Staff", "Everyone"])
PATIENT1 = ("PAT-001", "1111", ["PAT-001", "Everyone"])
PATIENT2 = ("PAT-002", "2222", ["PAT-002", "Everyone"])


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
        return {"Items": [dict(i) for i in reversed(self.items)]}

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

    def put_object(self, **kwargs):
        self.put = getattr(self, "put", [])
        self.put.append(kwargs)

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


POLICY_ID = "HCC-PUB-004"  # public: choking guide
CONSULT_ID = "PAT-001-PRF"  # Maria Nangolo's patient profile

CONFIG = {
    "knowledge_base_id": "KB12345678",
    "generation_model_arn": "arn:aws:bedrock:eu-central-1:123:inference-profile/eu.test",
    "archive_bucket": "clinic-test",
}


def request_filter(agent: FakeAgentRuntime) -> dict:
    return agent.request["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]


class CatalogTests(unittest.TestCase):
    def test_catalog_has_all_documents(self):
        self.assertGreaterEqual(len(handler.DOCUMENTS), 22)
        self.assertEqual(len({d["doc_id"] for d in handler.DOCUMENTS}), len(handler.DOCUMENTS))

    def test_clerk_sees_operations_but_no_patient_records(self):
        docs = handler.accessible_documents({"groups": CLERK[2]})
        types = {d["type"] for d in docs}
        self.assertIn("Lease", types)
        self.assertFalse(any(d["patient_id"] for d in docs))

    def test_patient_sees_only_own_records(self):
        docs = handler.accessible_documents({"groups": PATIENT1[2]})
        self.assertEqual({d["patient_id"] for d in docs if d["patient_id"]}, {"PAT-001"})
        self.assertNotIn("Lease", {d["type"] for d in docs})

    def test_clinical_staff_see_everything(self):
        self.assertEqual(len(handler.accessible_documents({"groups": DOCTOR[2]})), len(handler.DOCUMENTS))

    def test_public_sees_only_everyone_documents(self):
        docs = handler.accessible_documents(handler.PUBLIC_PRINCIPAL)
        self.assertEqual({tuple(d["groups"]) for d in docs}, {("Everyone",)})


class AccessFilterTests(unittest.TestCase):
    def test_filter_ors_every_group_flag(self):
        f = handler.access_filter({"groups": ["Everyone", "PAT-001"]})
        self.assertEqual(
            f,
            {
                "orAll": [
                    {"equals": {"key": "group_everyone", "value": "yes"}},
                    {"equals": {"key": "group_pat_001", "value": "yes"}},
                ]
            },
        )

    def test_single_group_uses_plain_equals(self):
        f = handler.access_filter(handler.PUBLIC_PRINCIPAL)
        self.assertEqual(f, {"equals": {"key": "group_everyone", "value": "yes"}})

    def test_summary_adds_document_id(self):
        f = handler.access_filter({"groups": ["Clinical", "Everyone"]}, doc_id="PAT-001-PRF")
        self.assertEqual(f["andAll"][1], {"equals": {"key": "doc_id", "value": "PAT-001-PRF"}})

    def test_invalid_document_id_rejected(self):
        with self.assertRaises(handler.ArchiveError):
            handler.access_filter({"groups": ["Clinical"]}, doc_id="../etc/passwd")

    def test_principal_without_groups_rejected(self):
        with self.assertRaises(handler.ArchiveError):
            handler.access_filter({"groups": []})


class AuthTests(unittest.TestCase):
    def test_public_fallback_when_pin_empty_and_allow_public(self):
        p = handler.authenticate("", "", FakeTable(), allow_public=True)
        self.assertEqual(p["role"], "public")
        self.assertEqual(p["groups"], ["Everyone"])

    def test_groups_loaded_and_everyone_added(self):
        users = FakeTable(stored_user("1111", "PAT-001", ["PAT-001"]))
        p = handler.authenticate("PAT-001", "1111", users)
        self.assertEqual(p["groups"], ["PAT-001", "Everyone"])
        self.assertEqual(p["role"], "pat-001")

    def test_account_without_staff_group_rejected(self):
        users = FakeTable(stored_user("3333", "X-1", ["Everyone"]))
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.authenticate("X-1", "3333", users)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_invalid_pin_rejected(self):
        users = FakeTable(stored_user("6666", "DOC-001", DOCTOR[2]))
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.authenticate("DOC-001", "9999", users)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(users.item["failed_attempts"], 1)

    def test_lockout_after_max_failed_attempts(self):
        users = FakeTable(stored_user("6666", "DOC-001", DOCTOR[2]))
        for _ in range(handler.MAX_FAILED_ATTEMPTS):
            with self.assertRaises(handler.ArchiveError):
                handler.authenticate("DOC-001", "9999", users)
        self.assertGreater(users.item.get("locked_until", 0), 0)
        with self.assertRaises(handler.ArchiveError):
            handler.authenticate("DOC-001", "6666", users)


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
        self.assertEqual(body["groups"], ["Clinical", "Everyone", "Staff"])
        self.assertIn("Patient Profile", body["scope"])

    def test_documents_lists_only_accessible(self):
        token, clients, _ = self._login(CLERK)
        status, body = handler.dispatch({"action": "documents"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(status, 200)
        types = {d["type"] for d in body["documents"]}
        self.assertNotIn("Patient Profile", types)
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
        self.assertEqual(body["sources"][0]["title"], "Patient Profile - Maria Nangolo")
        self.assertEqual(body["sources"][0]["url"], "https://archive.example/signed-source")
        self.assertTrue(s3.signed[0][0]["Key"].startswith("archive/Patients/"))
        self.assertIn("group_clinical", json.dumps(request_filter(agent)))
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
        runtime = FakeRuntime({"known": True, "answer": "Something.", "doc_ids": ["PAT-002-PRF"]})
        _, body = self._ask(token, clients, FakeAgentRuntime([chunk(POLICY_ID)]), runtime)
        self.assertTrue(body["is_unknown"])

    def test_model_saying_unknown_returns_unknown(self):
        token, clients, _ = self._login(DOCTOR)
        _, body = self._ask(token, clients, FakeAgentRuntime([chunk(POLICY_ID)]), FakeRuntime())
        self.assertTrue(body["is_unknown"])
        self.assertEqual(body["sources"], [])

    def test_model_reply_wrapped_in_text_is_parsed(self):
        token, clients, _ = self._login(DOCTOR)
        reply = 'Here you go:\n{"known": true, "answer": "Keep it confidential.", "doc_ids": ["HCC-PUB-004"]}'
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
        token, clients, _ = self._login(PATIENT1)
        handler.dispatch({"action": "logs"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertNotIn("IndexName", clients["audit_table"].last_query)
        token, clients, _ = self._login(CLERK)
        handler.dispatch({"action": "logs"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(clients["audit_table"].last_query["IndexName"], "ByTimestamp")

    def test_ussd_audit_never_contains_pin(self):
        users = FakeTable(stored_user("6666", "DOC-001", DOCTOR[2]))
        audit = FakeTable()
        clients = make_clients(
            users=users, audit=audit, bedrock=FakeAgentRuntime([chunk(POLICY_ID)]),
            runtime=FakeRuntime({"known": True, "answer": "Keep it confidential.", "doc_ids": [POLICY_ID]}),
        )
        status, body = handler.dispatch(
            {
                "action": "ussd", "channel": "ussd", "query": "",
                "ussd_session_id": "session-1",
                "ussd_text": "DOC-001*6666*3*What is the confidentiality rule?",
            },
            clients, CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["next_ussd_screen"].startswith("END"))
        self.assertEqual(body["reference"], POLICY_ID)
        self.assertEqual(audit.items[0]["question"], "What is the confidentiality rule?")
        self.assertNotIn("6666", json.dumps(audit.items[0]))

    def test_fallback_identifies_documents_by_s3_location(self):
        # Simulates a Knowledge Base whose metadata was not indexed: the filtered search
        # finds nothing, the unfiltered one returns chunks with only an S3 location.
        class NoMetadataAgent(FakeAgentRuntime):
            def retrieve(self, **request):
                self.request = request
                if "filter" in request["retrievalConfiguration"]["vectorSearchConfiguration"]:
                    return {"retrievalResults": []}
                return {"retrievalResults": [
                    {"content": {"text": "SECRET diagnosis"},
                     "location": {"s3Location": {"uri": "s3://clinic-test/archive/Patients/PAT-001-PRF_Patient_Profile_Maria_Nangolo.txt"}}},
                    {"content": {"text": "Do not discuss patients in public."},
                     "location": {"s3Location": {"uri": "s3://clinic-test/archive/Public/HCC-PUB-004_Emergency_Guide_Choking.txt"}}},
                ]}

        token, clients, _ = self._login(CLERK)
        runtime = FakeRuntime({"known": True, "answer": "Do not discuss patients.", "doc_ids": [POLICY_ID]})
        _, body = self._ask(token, clients, NoMetadataAgent(), runtime)
        self.assertFalse(body["is_unknown"])
        self.assertEqual([s["doc_id"] for s in body["sources"]], [POLICY_ID])
        sent_to_model = runtime.request["messages"][0]["content"][0]["text"]
        self.assertIn("Do not discuss patients", sent_to_model)
        self.assertNotIn("SECRET", sent_to_model)  # clerk may not read patient records

    def test_model_is_told_which_patient_record_is_mine(self):
        token, clients, _ = self._login(PATIENT1)
        runtime = FakeRuntime({"known": True, "answer": "Penicillin.", "doc_ids": [CONSULT_ID]})
        self._ask(token, clients, FakeAgentRuntime([chunk(CONSULT_ID)]), runtime, query="What allergies do I have?")
        sent = runtime.request["messages"][0]["content"][0]["text"]
        self.assertIn("patient record(s) PAT-001", sent)

    def test_short_answer_with_verified_quotes(self):
        token, clients, _ = self._login(PATIENT1)
        runtime = FakeRuntime({
            "known": True,
            "summary": "You are allergic to penicillin.",
            "points": ["It caused a rash and facial swelling in 2019."],
            "citations": [
                {"doc_id": CONSULT_ID, "quote": "Penicillin: rash and swelling of the face (2019)"},
                {"doc_id": CONSULT_ID, "quote": "Allergic to peanuts"},  # invented: not in the record
            ],
        })
        _, body = self._ask(token, clients, FakeAgentRuntime([chunk(CONSULT_ID)]), runtime)
        self.assertFalse(body["is_unknown"])
        self.assertEqual(body["summary"], "You are allergic to penicillin.")
        self.assertEqual(body["points"], ["It caused a rash and facial swelling in 2019."])
        self.assertIn("• It caused a rash", body["answer"])
        self.assertEqual(body["sources"][0]["quotes"], ["Penicillin: rash and swelling of the face (2019)"])

    def test_near_miss_quote_is_mapped_to_the_real_line(self):
        # The model wrote "8.1%" but the record says "8.1 %" in a table row.
        passages = handler.verified_quotes("PAT-002-LAB", ["HbA1c 8.1% HIGH"])
        self.assertEqual(len(passages), 1)
        self.assertTrue(passages[0].startswith("HbA1c") and "8.1 %" in passages[0] and "HIGH" in passages[0])
        self.assertIn(passages[0], handler.DOCS_BY_ID["PAT-002-LAB"]["text"])

    def test_no_quotes_falls_back_to_lines_matching_the_answer(self):
        passages = handler.verified_quotes("PAT-001-PRF", [], "You are allergic to penicillin: it gave you a rash and swelling of the face.")
        self.assertTrue(passages)
        self.assertTrue(any("Penicillin" in p for p in passages))
        for p in passages:
            self.assertIn(p, handler.DOCS_BY_ID["PAT-001-PRF"]["text"])

    def test_invented_quote_is_never_highlighted(self):
        self.assertEqual(handler.verified_quotes("PAT-001-PRF", ["Allergic to peanuts and shellfish"]), [])

    def test_page_furniture_is_never_highlighted(self):
        passages = handler.verified_quotes("PAT-001-PRF", [], "Hopewell Community Clinic fictional demonstration record")
        self.assertEqual(passages, [])

    def test_document_viewer_respects_access(self):
        token, clients, _ = self._login(PATIENT1)
        status, body = handler.dispatch({"action": "document", "doc_id": CONSULT_ID}, clients, CONFIG,
                                        auth_header=f"Bearer {token}")
        self.assertEqual(status, 200)
        self.assertIn("Penicillin", body["text"])
        for other in ("PAT-002-PRF", "HCC-STF-003"):  # another patient's record, staff lease
            with self.assertRaises(handler.ArchiveError) as ctx:
                handler.dispatch({"action": "document", "doc_id": other}, clients, CONFIG,
                                 auth_header=f"Bearer {token}")
            self.assertEqual(ctx.exception.status_code, 404)

    def test_document_list_never_includes_full_text(self):
        token, clients, _ = self._login(DOCTOR)
        _, body = handler.dispatch({"action": "documents"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertNotIn("text", body["documents"][0])

    def test_unregistered_person_can_raise_alert(self):
        audit = FakeTable()
        status, body = handler.dispatch(
            {"action": "alert_create", "name": "Anna", "phone": "081 000 0000",
             "message": "My father collapsed", "lat": -22.56, "lng": 17.08, "accuracy": 25},
            make_clients(audit=audit), CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        item = audit.items[0]
        self.assertEqual(item["record_type"], "ALERT")
        self.assertEqual(item["user_id"], "PUBLIC")
        self.assertEqual(item["name"], "Anna")
        self.assertEqual(item["lat"], "-22.56000")
        self.assertFalse(item["registered"])

    def test_registered_patient_alert_carries_patient_id(self):
        token, clients, _ = self._login(PATIENT1)
        handler.dispatch({"action": "alert_create", "message": "Chest pain", "name": "spoofed"},
                         clients, CONFIG, auth_header=f"Bearer {token}")
        item = clients["audit_table"].items[0]
        self.assertEqual(item["patient_ids"], ["PAT-001"])
        self.assertEqual(item["name"], "PAT-001")  # from the account, not the request
        self.assertTrue(item["registered"])

    def _public_alert(self, extra: dict) -> dict:
        users = FakeTable(stored_user("1111", "PAT-001", ["PAT-001"]))
        audit = FakeTable()
        status, body = handler.dispatch({"action": "alert_create", "message": "Help", **extra},
                                        make_clients(users=users, audit=audit), CONFIG, auth_header="")
        self.assertEqual(status, 200)
        return audit.items[0]

    def test_not_signed_in_without_id_is_unregistered(self):
        item = self._public_alert({"name": "Maria Nangolo"})  # typing a name proves nothing
        self.assertEqual(item["identity"], "unregistered")
        self.assertEqual(item["patient_ids"], [])

    def test_patient_id_with_correct_pin_is_verified(self):
        item = self._public_alert({"patient_id": "pat-001", "pin": "1111"})
        self.assertEqual(item["identity"], "verified_patient")
        self.assertEqual(item["patient_ids"], ["PAT-001"])
        self.assertTrue(item["registered"])

    def test_patient_id_with_wrong_or_no_pin_is_claimed_but_still_sent(self):
        for extra in ({"patient_id": "PAT-001", "pin": "9999"}, {"patient_id": "PAT-001"}):
            item = self._public_alert(extra)
            self.assertEqual(item["identity"], "claimed_patient")
            self.assertEqual(item["claimed_patient_id"], "PAT-001")
            self.assertEqual(item["patient_ids"], [])
            self.assertFalse(item["registered"])

    def test_signed_in_staff_alert_is_labelled_staff(self):
        token, clients, _ = self._login(CLERK)
        handler.dispatch({"action": "alert_create", "message": "Patient fainted in waiting room"},
                         clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(clients["audit_table"].items[0]["identity"], "staff")

    def test_alert_needs_message_or_location(self):
        with self.assertRaises(handler.ArchiveError):
            handler.dispatch({"action": "alert_create"}, make_clients(), CONFIG, auth_header="")

    def test_only_clinical_staff_can_list_and_handle_alerts(self):
        for user in (PATIENT1, CLERK):
            token, clients, _ = self._login(user)
            for action in ("alert_list", "alert_ack"):
                with self.assertRaises(handler.ArchiveError) as ctx:
                    handler.dispatch({"action": action, "alert_id": "x"}, clients, CONFIG, auth_header=f"Bearer {token}")
                self.assertEqual(ctx.exception.status_code, 403)

    def test_nurse_lists_alert_then_marks_it_handled(self):
        token, clients, _ = self._login(DOCTOR)
        handler.dispatch({"action": "alert_create", "message": "Help", "lat": "-22.5", "lng": "17.0"},
                         clients, CONFIG, auth_header="")
        _, body = handler.dispatch({"action": "alert_list"}, clients, CONFIG, auth_header=f"Bearer {token}")
        alert = body["alerts"][0]
        self.assertEqual(alert["status"], "open")
        handler.dispatch({"action": "alert_ack", "alert_id": alert["alert_id"]}, clients, CONFIG,
                         auth_header=f"Bearer {token}")
        _, body = handler.dispatch({"action": "alert_list"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(body["alerts"][0]["status"], "handled")
        self.assertEqual(body["alerts"][0]["handled_by"], "DOC-001")

    def test_alerts_do_not_appear_in_question_history(self):
        token, clients, _ = self._login(PATIENT1)
        handler.dispatch({"action": "alert_create", "message": "Help"}, clients, CONFIG, auth_header=f"Bearer {token}")
        _, body = handler.dispatch({"action": "logs"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(body["logs"], [])

    # ── Key details ──────────────────────────────────────────────────────────
    def test_key_details_keep_only_traceable_facts(self):
        handler._EXTRACT_CACHE.clear()
        token, clients, _ = self._login(CLERK)
        clients["bedrock_runtime"] = FakeRuntime({
            "summary": "Lease for the clinic premises.",
            "details": [
                {"category": "date", "label": "Lease end", "value": "2027-01-31", "quote": "Lease end: 2027-01-31"},
                {"category": "amount", "label": "Monthly rent", "value": "N$ 19 610", "quote": "increasing by 6% on 2026-02-01 to N$ 19 610"},
                {"category": "party", "label": "Landlord", "value": "Made-up Holdings", "quote": "Landlord: Made-up Holdings"},
            ],
        })
        status, body = handler.dispatch({"action": "extract", "doc_id": "HCC-STF-003"}, clients, CONFIG,
                                        auth_header=f"Bearer {token}")
        self.assertEqual(status, 200)
        labels = [d["label"] for d in body["details"]]
        self.assertIn("Lease end", labels)
        self.assertIn("Monthly rent", labels)
        for d in body["details"]:
            self.assertIn(d["quote"], handler.DOCS_BY_ID["HCC-STF-003"]["text"])

    def test_key_details_respect_access(self):
        token, clients, _ = self._login(PATIENT1)
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "extract", "doc_id": "HCC-STF-003"}, clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertEqual(ctx.exception.status_code, 404)

    # ── Photos and OCR ───────────────────────────────────────────────────────
    PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    def test_alert_photo_is_stored_and_assessed(self):
        audit, s3 = FakeTable(), FakeS3()
        runtime = FakeRuntime({"description": "Red blistered burn on the forearm, about palm size.", "urgency": "high",
                               "first_aid_topic": "burns", "for_staff": "Check size and depth.", "photo_clear": True})
        status, body = handler.dispatch(
            {"action": "alert_create", "message": "Hot water burn", "image_base64": self.PNG, "image_type": "image/png"},
            make_clients(audit=audit, runtime=runtime, s3=s3), CONFIG, auth_header="",
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["image_assessment"]["urgency"], "high")
        self.assertEqual(body["image_assessment"]["guide_doc_id"], "HCC-PUB-006")
        self.assertTrue(s3.put[0]["Key"].startswith("alerts/"))
        self.assertIn("image", runtime.request["messages"][0]["content"][0])

    def test_photo_alone_is_enough_to_send_an_alert(self):
        status, _ = handler.dispatch({"action": "alert_create", "image_base64": self.PNG, "image_type": "image/png"},
                                     make_clients(runtime=FakeRuntime({"description": "x", "urgency": "low"})), CONFIG, auth_header="")
        self.assertEqual(status, 200)

    def test_bad_image_type_rejected(self):
        with self.assertRaises(handler.ArchiveError):
            handler.dispatch({"action": "alert_create", "image_base64": self.PNG, "image_type": "application/pdf"},
                             make_clients(), CONFIG, auth_header="")

    def test_ocr_is_staff_only(self):
        token, clients, _ = self._login(PATIENT1)
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "ocr", "image_base64": self.PNG, "image_type": "image/png"}, clients, CONFIG,
                             auth_header=f"Bearer {token}")
        self.assertEqual(ctx.exception.status_code, 403)
        token, clients, _ = self._login(DOCTOR)
        clients["bedrock_runtime"] = FakeRuntime("REFERRAL\nPatient: Tomas Amukoto")
        _, body = handler.dispatch({"action": "ocr", "image_base64": self.PNG, "image_type": "image/png"}, clients, CONFIG,
                                   auth_header=f"Bearer {token}")
        self.assertIn("Tomas Amukoto", body["text"])

    # ── Live location and home ───────────────────────────────────────────────
    def test_live_location_needs_the_alert_key_and_shows_in_track(self):
        token, clients, _ = self._login(DOCTOR)
        _, created = handler.dispatch({"action": "alert_create", "message": "Help", "lat": -22.5, "lng": 17.0},
                                      clients, CONFIG, auth_header="")
        aid = created["alert_id"]
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "alert_location", "alert_id": aid, "update_key": "wrong", "lat": -22.6, "lng": 17.1},
                             clients, CONFIG, auth_header="")
        self.assertEqual(ctx.exception.status_code, 403)
        handler.dispatch({"action": "alert_location", "alert_id": aid, "update_key": created["update_key"],
                          "lat": -22.61, "lng": 17.12, "simulated": True}, clients, CONFIG, auth_header="")
        _, listed = handler.dispatch({"action": "alert_list"}, clients, CONFIG, auth_header=f"Bearer {token}")
        alert = next(a for a in listed["alerts"] if a["alert_id"] == aid)
        self.assertEqual(alert["track"][-1]["lat"], "-22.61000")
        self.assertTrue(alert["track"][-1]["simulated"])

    def test_alert_from_patient_with_home_shows_home_from_archive(self):
        if "PAT-004" not in handler.PATIENT_HOMES:
            self.skipTest("dataset without PAT-004 home")
        users = FakeTable(stored_user("7777", "PAT-004", ["PAT-004"]))
        clients = make_clients(users=users)
        handler.dispatch({"action": "alert_create", "patient_id": "PAT-004", "pin": "7777", "message": "Can't breathe"},
                         clients, CONFIG, auth_header="")
        token, staff_clients, _ = self._login(DOCTOR)
        staff_clients["audit_table"] = clients["audit_table"]
        _, listed = handler.dispatch({"action": "alert_list"}, staff_clients, CONFIG, auth_header=f"Bearer {token}")
        self.assertTrue(listed["alerts"][0]["home"]["address"])

    def test_unknown_action_returns_400(self):
        with self.assertRaises(handler.ArchiveError) as ctx:
            handler.dispatch({"action": "explode"}, make_clients(), CONFIG)
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
