"""Validate GCS credentials with a probe upload (no secrets on stdout)."""

import base64
import json
import os
import sys
import tempfile
import uuid

from google.cloud import storage


def _fail(reason: str) -> None:
    print(reason, file=sys.stdout)
    sys.exit(1)


def main() -> None:
    credentials_b64 = os.getenv("GCP_SERVICE_ACCOUNT_CREDENTIALS")
    if not credentials_b64:
        _fail("missing GCP_SERVICE_ACCOUNT_CREDENTIALS")

    bucket_name = os.getenv("GCS_DB_BACKUP_BUCKET_NAME", "vps_postgres_backups")
    if not bucket_name:
        _fail("missing GCS_DB_BACKUP_BUCKET_NAME")

    try:
        credentials_json = base64.b64decode(credentials_b64).decode("utf-8")
        credentials_dict = json.loads(credentials_json)
    except Exception:
        _fail("invalid credentials encoding")

    if credentials_dict.get("type") != "service_account":
        _fail("credentials type is not service_account")
    client_email = credentials_dict.get("client_email")
    private_key = credentials_dict.get("private_key")
    if not client_email or not private_key:
        _fail("credentials missing client_email or private_key")

    temp_credentials_file = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as handle:
            json.dump(credentials_dict, handle)
            temp_credentials_file = handle.name
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_credentials_file

        client = storage.Client()
        bucket = client.bucket(bucket_name)
        probe_name = f"vpscp-probe-{uuid.uuid4()}.txt"
        blob = bucket.blob(probe_name)
        blob.upload_from_string(b"ok", content_type="text/plain")
        blob.delete()
    except Exception as exc:
        _fail(str(exc) or "GCS probe failed")
    finally:
        if temp_credentials_file and os.path.exists(temp_credentials_file):
            try:
                os.unlink(temp_credentials_file)
            except OSError:
                pass
        if temp_credentials_file and os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") == temp_credentials_file:
            del os.environ["GOOGLE_APPLICATION_CREDENTIALS"]

    print(f"OK {client_email} {bucket_name}")


if __name__ == "__main__":
    main()
