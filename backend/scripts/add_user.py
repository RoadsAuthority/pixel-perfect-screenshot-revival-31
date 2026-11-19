import argparse
import getpass
import hashlib
import secrets

import boto3
from botocore.exceptions import ClientError


def hash_pin(pin: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return salt.hex(), derived.hex()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an archive user with a salted PIN hash.")
    parser.add_argument("--table-name", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--role", required=True, choices=["patient", "clerk", "nurse", "admin"])
    parser.add_argument("--patient-id")
    parser.add_argument("--name")
    parser.add_argument("--region", default="eu-west-1")
    args = parser.parse_args()

    user_id = args.user_id.strip().upper()
    patient_id = args.patient_id.strip().upper() if args.patient_id else ""
    name = args.name.strip() if args.name else user_id
    if not user_id or len(user_id) > 128:
        parser.error("--user-id must contain between 1 and 128 characters.")
    if not name or len(name) > 128:
        parser.error("--name must contain between 1 and 128 characters.")
    if args.role == "patient" and not patient_id:
        parser.error("--patient-id is required for a patient account.")
    if args.role != "patient" and patient_id:
        parser.error("--patient-id is only valid for a patient account.")
    pin = getpass.getpass("Enter a 4-digit PIN: ")
    if len(pin) != 4 or not pin.isdigit():
        parser.error("The PIN must contain exactly four digits.")
    confirmation = getpass.getpass("Confirm PIN: ")
    if pin != confirmation:
        parser.error("The PINs do not match.")
    salt, pin_hash = hash_pin(pin)
    item = {
        "user_id": user_id,
        "name": name,
        "role": args.role,
        "pin_salt": salt,
        "pin_hash": pin_hash,
    }
    if patient_id:
        item["patient_id"] = patient_id
    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table_name)
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(user_id)")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            parser.error(f"User {user_id} already exists. Remove or update it through an authorized admin workflow.")
        raise
    print(f"Added {args.role} account {user_id}; the PIN is stored only as a salted hash.")


if __name__ == "__main__":
    main()
