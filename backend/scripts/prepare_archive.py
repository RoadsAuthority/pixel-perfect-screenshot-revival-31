"""Prepare the Hopewell Clinic documents for S3 / Bedrock and the backend.

Reads   hopewell-clinic-documents/  (manifest.json, users.json, folders of .txt + .metadata.json)
Writes  backend/archive-upload/      -> upload the CONTENTS into s3://<bucket>/archive/
        backend/src/documents.json    -> document catalogue the API uses to list documents
        backend/demo-users/*.json     -> DynamoDB items (PINs stored as salted scrypt hashes)

Each .metadata.json is augmented with flat filter keys so Bedrock can filter on
any vector store:
    doc_id       = documentId
    title        = manifest title
    group_<name> = "yes" for every access group (e.g. group_doctors)

Run:  python backend/scripts/prepare_archive.py
"""

import hashlib
import json
import re
import secrets
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "hopewell-clinic-documents"
BACKEND = ROOT / "backend"
UPLOAD = BACKEND / "archive-upload"
CATALOG = BACKEND / "src" / "documents.json"
USERS_OUT = BACKEND / "demo-users"

# Fictional demo PINs, one per staff account in users.json. Never reuse for real people.
DEMO_PINS = {
    "CLK-001": "1111",
    "NUR-001": "2222",
    "DOC-001": "3333",
    "LAB-001": "4444",
    "REC-001": "5555",
}


def group_key(group: str) -> str:
    return "group_" + re.sub(r"[^a-z0-9]+", "_", group.lower()).strip("_")


def hash_pin(pin: str) -> tuple[str, str]:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return salt.hex(), derived.hex()


def prepare_documents() -> None:
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    if UPLOAD.exists():
        shutil.rmtree(UPLOAD)
    catalog = []
    for entry in manifest:
        rel = Path(entry["file"])
        src_txt = SOURCE / rel
        src_meta = SOURCE / f"{rel}.metadata.json"
        attrs = json.loads(src_meta.read_text(encoding="utf-8"))["metadataAttributes"]
        groups = attrs["accessGroups"]
        attrs["doc_id"] = entry["documentId"]
        attrs["title"] = entry["title"]
        for group in groups:
            attrs[group_key(group)] = "yes"

        dest_txt = UPLOAD / rel
        dest_txt.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_txt, dest_txt)
        (UPLOAD / f"{rel}.metadata.json").write_text(
            json.dumps({"metadataAttributes": attrs}, indent=2) + "\n", encoding="utf-8"
        )
        catalog.append(
            {
                "doc_id": entry["documentId"],
                "title": entry["title"],
                "type": entry["documentType"],
                "folder": entry["folder"],
                "date": attrs.get("documentDate", entry.get("date", "")),
                "patient_id": entry.get("patientId") or "",
                "groups": groups,
                "s3_key": f"archive/{rel.as_posix()}",
            }
        )
    catalog.sort(key=lambda d: (d["folder"], d["doc_id"]))
    CATALOG.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(catalog)} documents in {UPLOAD} and catalogue {CATALOG}")


def prepare_users() -> None:
    users = json.loads((SOURCE / "users.json").read_text(encoding="utf-8"))
    if USERS_OUT.exists():
        shutil.rmtree(USERS_OUT)
    USERS_OUT.mkdir()
    for user in users:
        match = re.search(r"\(([A-Z]+-\d+)\)", user["displayName"])
        if not match:
            raise SystemExit(f"No staff code in displayName: {user['displayName']}")
        code = match.group(1)
        pin = DEMO_PINS[code]
        name = user["displayName"].replace(f"({code})", "").strip()
        salt, pin_hash = hash_pin(pin)
        item = {
            "user_id": {"S": code},
            "username": {"S": user["username"]},
            "name": {"S": name},
            "groups": {"L": [{"S": g} for g in user["groups"]]},
            "pin_salt": {"S": salt},
            "pin_hash": {"S": pin_hash},
        }
        (USERS_OUT / f"{code}.json").write_text(json.dumps(item, indent=2) + "\n", encoding="utf-8")
        print(f"User {code:8} {name:32} groups={user['groups']} PIN={pin}")


if __name__ == "__main__":
    prepare_documents()
    prepare_users()
