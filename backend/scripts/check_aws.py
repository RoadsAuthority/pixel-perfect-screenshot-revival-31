"""Read-only health check of the AWS side of Ask the Archive.

Usage:  python backend/scripts/check_aws.py

Reads settings from backend/.env (see backend/.env.example). Never prints keys,
PIN hashes or salts. Makes no changes to AWS.
"""

import hashlib
import os
import sys
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
DEMO_PINS = {"CLK-001": "1111", "NUR-001": "2222", "DOC-001": "3333", "LAB-001": "4444", "REC-001": "5555"}


def load_env() -> None:
    if not ENV_FILE.exists():
        raise SystemExit(f"Create {ENV_FILE} from backend/.env.example first.")
    for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ[key.strip()] = value.strip().strip('"').strip("'")


def ok(msg: str) -> None:
    print(f"ok    {msg}")


def bad(msg: str) -> None:
    print(f"FAIL  {msg}")


def pin_matches(pin: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        derived = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt_hex), n=16384, r=8, p=1, dklen=64)
        return derived.hex() == hash_hex
    except (ValueError, TypeError):
        return False


def main() -> None:
    load_env()
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    region = os.environ.get("AWS_REGION", "")
    print(f"Region: {region}\n")

    try:
        arn = boto3.client("sts", region_name=region).get_caller_identity()["Arn"]
        ok(f"credentials work ({arn.split(':')[-1]})")
    except (BotoCoreError, ClientError) as err:
        bad(f"credentials: {err}")
        sys.exit(1)

    # ── Users table ──────────────────────────────────────────────────────────
    table = os.environ.get("AUTH_USERS_TABLE", "")
    print(f"\nUsers table '{table}':")
    try:
        items = boto3.resource("dynamodb", region_name=region).Table(table).scan().get("Items", [])
        if not items:
            bad("table is empty — add the 5 files from backend/demo-users/")
        for item in items:
            uid = item.get("user_id")
            groups = item.get("groups")
            problems = []
            if not isinstance(groups, (list, set)):
                problems.append(f"'groups' is {type(groups).__name__}, expected a List")
            if item.get("locked_until"):
                problems.append("account temporarily locked (too many wrong PINs; wait 5 minutes)")
            pin = DEMO_PINS.get(uid)
            if pin is None:
                problems.append("not one of the Hopewell demo IDs")
            elif not pin_matches(pin, item.get("pin_salt", ""), item.get("pin_hash", "")):
                problems.append(f"stored hash does not match demo PIN {pin}")
            (bad if problems else ok)(f"{uid}: groups={list(groups) if groups else groups}" + (" — " + "; ".join(problems) if problems else ""))
        missing = set(DEMO_PINS) - {i.get("user_id") for i in items}
        if missing:
            bad(f"missing users: {', '.join(sorted(missing))}")
    except ClientError as err:
        bad(f"cannot read table: {err.response['Error']['Code']} — check name/region")

    # ── S3 ───────────────────────────────────────────────────────────────────
    bucket = os.environ.get("BUCKET_NAME", "")
    print(f"\nS3 bucket '{bucket}':")
    try:
        keys = []
        for page in boto3.client("s3", region_name=region).get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="archive/"):
            keys += [o["Key"] for o in page.get("Contents", [])]
        docs = [k for k in keys if k.endswith(".txt")]
        metas = [k for k in keys if k.endswith(".metadata.json")]
        (ok if len(docs) == 59 and len(metas) == 59 else bad)(f"{len(docs)} documents, {len(metas)} metadata files under archive/ (expected 59 + 59)")
        old = [k for k in keys if "patient_P0" in k or "oxygen" in k]
        if old:
            bad(f"old sample files still present: {len(old)} — delete them")
    except ClientError as err:
        bad(f"cannot list bucket: {err.response['Error']['Code']}")

    # ── Knowledge Base ───────────────────────────────────────────────────────
    kb_id = os.environ.get("KB_ID", "")
    print(f"\nKnowledge Base '{kb_id}':")
    agent = boto3.client("bedrock-agent", region_name=region)
    try:
        kb = agent.get_knowledge_base(knowledgeBaseId=kb_id)["knowledgeBase"]
        ok(f"status {kb['status']}")
        for ds in agent.list_data_sources(knowledgeBaseId=kb_id)["dataSourceSummaries"]:
            jobs = agent.list_ingestion_jobs(
                knowledgeBaseId=kb_id, dataSourceId=ds["dataSourceId"],
                sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"}, maxResults=1,
            )["ingestionJobSummaries"]
            if not jobs:
                bad(f"data source '{ds['name']}' has never been synced — click Sync")
                continue
            job = jobs[0]
            stats = job.get("statistics", {})
            msg = (f"data source '{ds['name']}': last sync {job['status']} at {job['startedAt']:%Y-%m-%d %H:%M} — "
                   f"indexed {stats.get('numberOfNewDocumentsIndexed', 0)} new, "
                   f"{stats.get('numberOfModifiedDocumentsIndexed', 0)} modified, "
                   f"{stats.get('numberOfDocumentsFailed', 0)} failed")
            (ok if job["status"] == "COMPLETE" and not stats.get("numberOfDocumentsFailed") else bad)(msg)
    except ClientError as err:
        bad(f"cannot read Knowledge Base: {err.response['Error']['Code']} — check KB_ID/region")
        return

    # Retrieval with the same group filter the app uses (Doctors).
    try:
        result = boto3.client("bedrock-agent-runtime", region_name=region).retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": "Which patients are allergic to penicillin?"},
            retrievalConfiguration={"vectorSearchConfiguration": {
                "numberOfResults": 5,
                "filter": {"orAll": [
                    {"equals": {"key": "group_doctors", "value": "yes"}},
                    {"equals": {"key": "group_everyone", "value": "yes"}},
                ]},
            }},
        )["retrievalResults"]
        ids = [r.get("metadata", {}).get("doc_id", "?") for r in result]
        (ok if ids else bad)(f"filtered retrieval as Doctors returned {len(ids)} chunks: {', '.join(ids)}")
    except ClientError as err:
        bad(f"retrieval failed: {err.response['Error']['Code']}: {err.response['Error'].get('Message', '')[:200]}")


if __name__ == "__main__":
    main()
