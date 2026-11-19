"""Replace s3://<BUCKET_NAME>/archive/ with the prepared files in backend/archive-upload/.

Usage:  python backend/scripts/upload_archive.py

Reads AWS settings from backend/.env. Deletes everything under archive/ first,
then uploads, then verifies. Afterwards click Sync on the Knowledge Base data source.
"""

import json
import os
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
UPLOAD = BACKEND / "archive-upload"
ENV_FILE = BACKEND / ".env"


def load_env() -> None:
    for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ[key.strip()] = value.strip().strip('"').strip("'")


def main() -> None:
    load_env()
    import boto3

    bucket = os.environ["BUCKET_NAME"]
    s3 = boto3.client("s3", region_name=os.environ["AWS_REGION"])

    files = sorted(p for p in UPLOAD.rglob("*") if p.is_file())
    expected = 2 * len(json.loads((BACKEND / "src" / "documents.json").read_text(encoding="utf-8")))
    if len(files) != expected:
        raise SystemExit(f"Expected {expected} prepared files in {UPLOAD}, found {len(files)}. Run prepare_archive.py first.")

    # 1. Delete everything currently under archive/.
    old = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="archive/"):
        old += [{"Key": o["Key"]} for o in page.get("Contents", [])]
    for i in range(0, len(old), 1000):
        s3.delete_objects(Bucket=bucket, Delete={"Objects": old[i:i + 1000], "Quiet": True})
    print(f"Deleted {len(old)} old objects under archive/")

    # 2. Upload the prepared files.
    for path in files:
        key = "archive/" + path.relative_to(UPLOAD).as_posix()
        content_type = "application/json" if path.name.endswith(".metadata.json") else "text/plain; charset=utf-8"
        s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_type})
    print(f"Uploaded {len(files)} files")

    # 3. Verify.
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="archive/"):
        keys += [o["Key"] for o in page.get("Contents", [])]
    docs = [k for k in keys if k.endswith(".txt")]
    metas = [k for k in keys if k.endswith(".metadata.json")]
    sample = json.loads(s3.get_object(Bucket=bucket, Key=metas[0])["Body"].read())["metadataAttributes"]
    tagged = "doc_id" in sample and any(k.startswith("group_") for k in sample)
    print(f"Now in archive/: {len(docs)} documents, {len(metas)} metadata files, tags present: {tagged}")
    print(f"Example: {docs[0]}")
    catalog = json.loads((BACKEND / "src" / "documents.json").read_text(encoding="utf-8"))
    missing = [d["s3_key"] for d in catalog if d["s3_key"] not in keys]
    print("All source links will resolve." if not missing else f"Missing for source links: {missing[:3]}")


if __name__ == "__main__":
    main()
