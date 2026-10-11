from fastapi import APIRouter, Request
from pydantic import BaseModel, field_validator

from vpscp_agent import audit
from vpscp_agent.backup_ops import (
    BUCKET_RE,
    BackupSettingsIn,
    BackupSettingsOut,
    read_settings,
    run_now,
    status,
    test_credentials,
    write_settings,
)

router = APIRouter(prefix="/v1/backup", tags=["backup"])

_WRITE_SECRET_FIELDS = frozenset({"service_account", "archive_passphrase"})


class TestCredentialsBody(BaseModel):
    service_account: str | None = None
    bucket: str

    @field_validator("bucket")
    @classmethod
    def validate_bucket(cls, value: str) -> str:
        if not BUCKET_RE.fullmatch(value):
            raise ValueError(f"invalid bucket name: {value!r}")
        return value


@router.get("/settings")
def get_settings(request: Request) -> BackupSettingsOut:
    return read_settings(request.app.state.settings)


@router.put("/settings")
def put_settings(body: BackupSettingsIn, request: Request) -> BackupSettingsOut:
    settings = request.app.state.settings
    runner = request.app.state.runner
    db = request.app.state.db
    params = body.model_dump()
    with audit.audited(
        db,
        "backup.write_settings",
        params,
        extra_secret_fields=_WRITE_SECRET_FIELDS,
    ):
        return write_settings(settings, runner, body)


@router.post("/test")
def post_test(body: TestCredentialsBody, request: Request) -> dict:
    settings = request.app.state.settings
    runner = request.app.state.runner
    db = request.app.state.db
    params = body.model_dump()
    with audit.audited(
        db,
        "backup.test_credentials",
        params,
        extra_secret_fields=frozenset({"service_account"}),
    ):
        return test_credentials(settings, runner, body.service_account, body.bucket)


@router.post("/run-now")
def post_run_now(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    db = request.app.state.db
    with audit.audited(db, "backup.run_now", {}):
        run_now(settings)
    return {"status": "ok"}


@router.get("/status")
def get_status(request: Request) -> dict:
    return status(request.app.state.settings, request.app.state.runner)
