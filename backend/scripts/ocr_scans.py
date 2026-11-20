"""OCR the scanned documents in clinic-documents/Scans/ through the clinic API.

Usage:  python backend/scripts/ocr_scans.py https://<your-service>.onrender.com [--force]

Signs in as a staff demo account, sends each scan image to the API's `ocr` action
(Claude vision on Amazon Bedrock reads the image), and writes the extracted text and
its .metadata.json next to the other documents. Then run prepare_archive.py and
upload_archive.py, and Sync the Knowledge Base.
"""

import base64
import json
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "clinic-documents"
STAFF_ID, STAFF_PIN = "DOC-001", "6666"  # fictional demo account


def call(url: str, body: dict, token: str = "") -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        raise SystemExit(f"HTTP {err.code}: {err.read().decode(errors='replace')}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    url = args[0].rstrip("/")
    if not url.endswith("/archive"):
        url += "/archive"
    force = "--force" in sys.argv

    token = call(url, {"action": "verify", "user_id": STAFF_ID, "pin": STAFF_PIN, "channel": "web"})["token"]
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest:
        if not entry.get("scanFile"):
            continue
        txt = SOURCE / entry["file"]
        if txt.exists() and not force:
            print(f"{entry['documentId']}: already transcribed (use --force to redo)")
            continue
        image = SOURCE / entry["scanFile"]
        print(f"{entry['documentId']}: reading {image.name} ...")
        result = call(url, {
            "action": "ocr",
            "image_type": "image/jpeg",
            "image_base64": base64.b64encode(image.read_bytes()).decode(),
        }, token)
        text = result["text"].strip()
        header = (
            "========================================================================\n"
            f"SCANNED DOCUMENT - TEXT EXTRACTED BY OCR\n"
            f"Document ID: {entry['documentId']}\n"
            f"Title: {entry['title']}\n"
            f"Original scan: {image.name}\n"
            f"OCR: Claude vision on Amazon Bedrock, {date.today().isoformat()}. Check the original scan for exact wording.\n"
            "FICTIONAL DEMONSTRATION RECORD - NOT REAL PATIENT DATA\n"
            "========================================================================\n"
        )
        txt.parent.mkdir(parents=True, exist_ok=True)
        txt.write_text(header + text + "\n", encoding="utf-8")
        meta = {
            "documentId": entry["documentId"],
            "documentType": entry["documentType"],
            "folder": entry["folder"],
            "accessGroups": entry["accessGroups"],
            "documentDate": entry["date"],
            "patientId": entry.get("patientId") or "",
            "source": "ocr",
        }
        (SOURCE / f"{entry['file']}.metadata.json").write_text(json.dumps({"metadataAttributes": meta}, indent=2) + "\n", encoding="utf-8")
        print(f"  wrote {txt.relative_to(ROOT)} ({len(text)} characters)")
        print("  " + "\n  ".join(text.splitlines()[:8]) + ("\n  ..." if len(text.splitlines()) > 8 else ""))


if __name__ == "__main__":
    main()
