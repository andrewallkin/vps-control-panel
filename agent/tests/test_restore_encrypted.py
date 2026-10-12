import gzip

from pyrage import passphrase as pyrage_passphrase

from tests.fakes import FakeRunner
from vpscp_agent.jobs import Job, JobContext, JobManager
from vpscp_agent.pg import Psql
from vpscp_agent.restore import UploadStore, restore_cluster, validate_dump
from vpscp_agent.state import StateDB

PLAIN_DUMP = (
    b"--\n-- PostgreSQL database cluster dump\n--\n"
    b"CREATE ROLE appuser;\n"
)


def _env(settings, monkeypatch):
    settings.stack_dir.mkdir(parents=True, exist_ok=True)
    settings.stack_env_path.write_text(
        "POSTGRES_USER=pgadmin\nPOSTGRES_PASSWORD=stack-admin-secret\n"
        "BACKUP_ARCHIVE_PASSPHRASE=s3cret\n"
    )
    settings.apps_dir.mkdir(parents=True, exist_ok=True)
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    return settings, runner, db, Psql(settings, runner), UploadStore(settings)


def _complete_upload(store: UploadStore, data: bytes, filename: str) -> str:
    import hashlib

    upload_id = store.create(filename, len(data))
    store.append(upload_id, 0, data)
    digest = hashlib.sha256(data).hexdigest()
    store.complete(upload_id, digest)
    return upload_id


def test_validate_dump_accepts_age_encrypted(settings, monkeypatch):
    """Backups are uploaded age-encrypted; the restore path must decrypt with
    the archive passphrase before the pg header check."""
    settings, _runner, _db, _psql, _store = _env(settings, monkeypatch)
    encrypted = pyrage_passphrase.encrypt(gzip.compress(PLAIN_DUMP), "s3cret")
    path = settings.restore_dir / "backup_x.sql.gz.age"
    settings.restore_dir.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encrypted)

    scan = validate_dump(path, filename="backup_x.sql.gz.age", passphrase="s3cret")
    assert scan.header_ok
    assert scan.roles == ["appuser"]


def test_validate_dump_still_accepts_plaintext(settings, monkeypatch):
    settings, _runner, _db, _psql, _store = _env(settings, monkeypatch)
    path = settings.restore_dir / "backup_y.sql.gz"
    settings.restore_dir.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(PLAIN_DUMP))

    scan = validate_dump(path, filename="backup_y.sql.gz")
    assert scan.header_ok


def test_restore_cluster_loads_decrypted_dump(settings, monkeypatch):
    settings, runner, db, psql, store = _env(settings, monkeypatch)
    encrypted = pyrage_passphrase.encrypt(gzip.compress(PLAIN_DUMP), "s3cret")
    upload_id = _complete_upload(store, encrypted, "backup_z.sql.gz.age")
    runner.on("d.datname FROM pg_database", stdout="")
    runner.on("r.rolname FROM pg_roles", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=[], returncode=0)

    job = Job(kind="test", params={})
    JobManager(db)._jobs[job.id] = job
    result = restore_cluster(
        JobContext(job),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
    )
    assert result["error_count"] == 0
    # the bytes piped into psql must be the decrypted dump
    piped = runner.pipe_through_calls[0]["source"]
    assert piped == PLAIN_DUMP
