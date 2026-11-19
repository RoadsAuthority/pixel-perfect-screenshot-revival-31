import argparse
from pathlib import Path

import boto3


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload fictional sample documents and start Bedrock ingestion.")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--knowledge-base-id", required=True)
    parser.add_argument("--data-source-id", required=True)
    parser.add_argument("--region", default="eu-west-1")
    args = parser.parse_args()

    sample_dir = Path(__file__).resolve().parents[1] / "sample-data"
    s3 = boto3.client("s3", region_name=args.region)
    files = sorted(path for path in sample_dir.iterdir() if path.is_file())
    if not files:
        raise RuntimeError(f"No sample documents found in {sample_dir}.")
    for path in files:
        key = f"archive/{path.name}"
        content_type = "application/json" if path.name.endswith(".metadata.json") else "text/plain; charset=utf-8"
        s3.upload_file(str(path), args.bucket, key, ExtraArgs={"ContentType": content_type})
        print(f"Uploaded s3://{args.bucket}/{key}")

    bedrock = boto3.client("bedrock-agent", region_name=args.region)
    job = bedrock.start_ingestion_job(
        knowledgeBaseId=args.knowledge_base_id,
        dataSourceId=args.data_source_id,
        description="Load fictional Ask the Archive demo documents",
    )
    print(f"Started Bedrock ingestion job {job['ingestionJob']['ingestionJobId']}.")


if __name__ == "__main__":
    main()
