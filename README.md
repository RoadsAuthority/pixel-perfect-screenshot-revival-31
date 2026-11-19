# Pixel Perfect Screenshot Revival

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0101d989-881a-4f93-8ef9-e36f34c59ecc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Architecture

```
Lovable app  ->  FastAPI on Render (/archive)  ->  AWS: Bedrock Knowledge Base + S3 + DynamoDB
```

The browser holds no documents and makes no access decisions. The Render backend
(`backend/src/main.py` + `handler.py`) verifies the staff ID and PIN against salted
hashes in DynamoDB, filters Bedrock retrieval to the user's access groups, withholds
any answer that cites a document the user may not read, returns 5-minute signed S3
links to sources, and writes every question to a DynamoDB audit table.

Set `VITE_ARCHIVE_API_URL` (see `.env.example`) to `https://<service>.onrender.com/archive`.

## Data: Hopewell Community Clinic (fictional)

`hopewell-clinic-documents/` holds 59 fictional records, `users.json` (5 staff) and
`TEST_QUESTIONS.md` (the demo script). Each document's `accessGroups` decides who can
read it: Administration, Nursing, Doctors, Laboratory, Records, or Everyone.

Prepare it for AWS:

```sh
python backend/scripts/prepare_archive.py
```

This writes `backend/archive-upload/` (upload its contents to `s3://<bucket>/archive/`,
then **Sync** the Knowledge Base), `backend/src/documents.json` (the catalogue the API
serves, commit it) and `backend/demo-users/*.json` (paste into the users table with
"View DynamoDB JSON" on).

Demo staff accounts (fictional): CLK-001/1111, NUR-001/2222, DOC-001/3333,
LAB-001/4444, REC-001/5555. Records staff can see every user's question history.

## AWS resources (one region, e.g. eu-central-1)

- S3 bucket with documents under `archive/`
- Bedrock Knowledge Base on `s3://<bucket>/archive/` (Titan Text Embeddings V2)
- DynamoDB: `ClinicUsers` (key `user_id`), `ClinicSessions` (key `token_hash`),
  `ClinicAuditLog` (keys `user_id` + `timestamp_request`, GSI `ByTimestamp` on
  `record_type` + `timestamp_request`)

Render environment variables: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`KB_ID`, `GENERATION_MODEL_ARN`, `BUCKET_NAME`, `AUTH_USERS_TABLE`, `AUTH_SESSIONS_TABLE`,
`AUDIT_TABLE`.

Check a deployment end to end:

```sh
python backend/scripts/smoke_test.py https://<service>.onrender.com/archive
```

The four-digit-PIN flow and fictional data are for the hackathon demo, not for real
patient records.
