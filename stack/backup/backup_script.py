"""
Database backup script with scheduled execution.
Creates PostgreSQL backups and uploads them to Google Cloud Storage.
"""

import os
import subprocess
import datetime
import logging
import sys
import threading
import time
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from config_archive import build_archive, collect_sources, encrypt
from gcs_service import GoogleCloudStorageService
from logging_config import configure_logging
import status

# Configure logging with same config as backend
configure_logging()
logger = logging.getLogger(__name__)

# PostgreSQL connection details (from environment variables)
# Support both individual POSTGRES_* vars and DATABASE_URL
if os.environ.get("DATABASE_URL"):
    # Parse DATABASE_URL: postgresql://user:password@host:port/dbname
    database_url = os.environ.get("DATABASE_URL")
    parsed = urlparse(database_url)
    DB_HOST = parsed.hostname or "postgres"
    DB_PORT = str(parsed.port) if parsed.port else "5432"
    DB_USER = parsed.username
    DB_PASS = parsed.password
    DB_NAME = (parsed.path.lstrip("/") if parsed.path else None) or "postgres"
else:
    # Use individual environment variables
    DB_HOST = os.environ.get("POSTGRES_HOST", "postgres")
    DB_PORT = os.environ.get("POSTGRES_PORT", "5432")
    DB_USER = os.environ.get("POSTGRES_USER")
    DB_PASS = os.environ.get("POSTGRES_PASSWORD")
    DB_NAME = os.environ.get("POSTGRES_DB", "postgres")

# Backup configuration
RETENTION_DAYS = int(os.environ.get("BACKUP_RETENTION_DAYS", "30"))
BACKUP_SCHEDULE_HOUR = os.environ.get("BACKUP_SCHEDULE_HOUR", "0,12")
BACKUP_SCHEDULE_MINUTE = os.environ.get("BACKUP_SCHEDULE_MINUTE", "0")
BACKUP_TIMEZONE = os.environ.get("BACKUP_TIMEZONE", "UTC")
WAIT_FOR_POSTGRES_TIMEOUT = int(os.environ.get("BACKUP_WAIT_FOR_POSTGRES_TIMEOUT", "60"))
WAIT_FOR_POSTGRES_INTERVAL = int(os.environ.get("BACKUP_WAIT_FOR_POSTGRES_INTERVAL", "2"))

_backup_lock = threading.Lock()


def _utc_now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _startup_backup_enabled() -> bool:
    return os.environ.get("BACKUP_ON_STARTUP", "").lower() in ("1", "true", "yes")


def _write_initial_status_if_missing() -> None:
    status_path = status.STATE_DIR / status.STATUS_FILENAME
    if not status_path.exists():
        status.write_status(
            started_at=None,
            finished_at=None,
            success=None,
            object=None,
            size_bytes=None,
            archive_object=None,
            archive_skipped_reason=None,
            error=None,
        )


def maybe_encrypt_backup(backup_path: str) -> str:
    """Age-encrypt the dump with the archive passphrase before upload.

    The dump contains every app row and role password hash; the config
    archive is already age-encrypted and the dump gets the same treatment.
    Without a passphrase the file is uploaded unchanged (plaintext), which
    the backup status reports as such.
    """
    passphrase = os.environ.get("BACKUP_ARCHIVE_PASSPHRASE")
    if not passphrase:
        return backup_path
    with open(backup_path, "rb") as handle:
        data = handle.read()
    encrypted = encrypt(data, passphrase)
    encrypted_path = backup_path + ".age"
    with open(encrypted_path, "wb") as handle:
        handle.write(encrypted)
    os.remove(backup_path)
    logger.info(f"Encrypted dump with archive passphrase: {encrypted_path}")
    return encrypted_path


def _timestamp_from_backup_filename(backup_filename: str) -> str:
    base = os.path.basename(backup_filename)
    prefix = "backup_"
    for suffix in (".sql.gz.age", ".sql.gz"):
        if base.startswith(prefix) and base.endswith(suffix):
            return base[len(prefix) : -len(suffix)]
    return datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def wait_for_postgres() -> bool:
    """Wait for PostgreSQL to be ready before running backup. Handles race conditions when
    the backup container starts before postgres is fully ready (e.g. older Docker Compose)."""
    if DB_PASS is not None:
        os.environ["PGPASSWORD"] = DB_PASS
    try:
        cmd = ["pg_isready", "-h", DB_HOST, "-p", DB_PORT, "-U", DB_USER]
        elapsed = 0
        while elapsed < WAIT_FOR_POSTGRES_TIMEOUT:
            result = subprocess.run(cmd, capture_output=True, env=os.environ)
            if result.returncode == 0:
                logger.info("PostgreSQL is ready")
                return True
            logger.info(f"Waiting for PostgreSQL at {DB_HOST}:{DB_PORT} ({elapsed}s elapsed)...")
            time.sleep(WAIT_FOR_POSTGRES_INTERVAL)
            elapsed += WAIT_FOR_POSTGRES_INTERVAL
        logger.error(f"PostgreSQL not ready after {WAIT_FOR_POSTGRES_TIMEOUT}s. Aborting.")
        return False
    finally:
        if "PGPASSWORD" in os.environ:
            del os.environ["PGPASSWORD"]


def create_pg_dump():
    """Executes pg_dumpall to create a compressed backup of all databases."""
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_filename = f"backup_{timestamp}.sql.gz"

    # Set environment variable for pg_dumpall password
    os.environ["PGPASSWORD"] = DB_PASS

    # pg_dumpall dumps entire cluster (all databases, roles, tablespaces)
    # Note: -d/--dbname expects a connection string, not a database name. Omit it; pg_dumpall uses postgres by default.
    pg_dumpall_command = [
        "pg_dumpall",
        "-h",
        DB_HOST,
        "-p",
        DB_PORT,
        "-U",
        DB_USER,
    ]

    # Execute pg_dumpall and pipe the output to gzip
    logger.info(f"Creating full cluster dump (all databases): {backup_filename}...")
    try:
        pg_dumpall_process = subprocess.Popen(
            pg_dumpall_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )

        with open(backup_filename, "wb") as f_out:
            gzip_process = subprocess.run(
                ["gzip"], stdin=pg_dumpall_process.stdout, stdout=f_out, check=True
            )

        pg_dumpall_process.stdout.close()
        pg_dumpall_process.wait()

        if pg_dumpall_process.returncode != 0:
            stderr = pg_dumpall_process.stderr.read().decode("utf-8")
            raise subprocess.CalledProcessError(
                pg_dumpall_process.returncode, pg_dumpall_command, stderr=stderr
            )

        # Get file size for logging
        file_size = os.path.getsize(backup_filename)
        logger.info(
            f"Successfully created dump file: {backup_filename} ({file_size / 1024 / 1024:.2f} MB)"
        )
        return backup_filename

    except subprocess.CalledProcessError as e:
        logger.error(f"Error during pg_dumpall/gzip: {e}")
        if hasattr(e, "stderr") and e.stderr:
            logger.error(f"pg_dumpall stderr: {e.stderr}")
        return None
    finally:
        # Clean up the password variable
        if "PGPASSWORD" in os.environ:
            del os.environ["PGPASSWORD"]


def run_backup():
    """Main backup execution function."""
    if not _backup_lock.acquire(blocking=False):
        logger.info("Backup already in progress; skipping this run")
        return

    started_at = _utc_now_iso()
    success = False
    object_name = None
    size_bytes = None
    archive_object = None
    archive_skipped_reason = None
    archive_error = None
    error = None
    backup_file = None

    logger.info("=" * 60)
    logger.info("Starting scheduled database backup")
    logger.info("=" * 60)

    try:
        if not all([DB_HOST, DB_USER, DB_PASS]):
            error = "Missing required database environment variables"
            logger.error("ERROR: Missing required database environment variables.")
            logger.error(
                f"DB_HOST: {DB_HOST}, DB_USER: {DB_USER}, DB_PASS: {'*' if DB_PASS else None}"
            )
            return

        if not wait_for_postgres():
            error = "PostgreSQL not ready"
            logger.error("Aborting backup: PostgreSQL not ready.")
            return

        backup_file = create_pg_dump()
        if not backup_file:
            error = "Failed to create cluster dump"
            logger.error("Failed to create cluster dump. Aborting backup.")
            return
        backup_file = maybe_encrypt_backup(backup_file)

        gcs_service = GoogleCloudStorageService()
        if not gcs_service.is_available():
            error = "Google Cloud Storage service not available"
            logger.error("Google Cloud Storage service not available. Aborting backup.")
            return

        upload_success = gcs_service.upload_file(backup_file)
        if not upload_success:
            error = "Failed to upload backup to Google Cloud Storage"
            logger.error("Failed to upload backup to Google Cloud Storage")
            return

        success = True
        object_name = os.path.basename(backup_file)
        size_bytes = os.path.getsize(backup_file)
        logger.info("Backup uploaded successfully to Google Cloud Storage")

        archive_passphrase = os.environ.get("BACKUP_ARCHIVE_PASSPHRASE")
        if archive_passphrase:
            try:
                sources = collect_sources()
                archive_data = build_archive(sources)
                encrypted = encrypt(archive_data, archive_passphrase)
                archive_name = (
                    f"config_{_timestamp_from_backup_filename(backup_file)}.tar.gz.age"
                )
                if gcs_service.upload_bytes(archive_name, encrypted):
                    archive_object = archive_name
                else:
                    archive_error = "Failed to upload config archive"
                    logger.error(archive_error)
            except Exception as exc:
                archive_error = str(exc)
                logger.error(f"Config archive failed: {exc}", exc_info=True)
        else:
            archive_skipped_reason = "no passphrase configured"

        deleted_count = gcs_service.cleanup_old_backups(RETENTION_DAYS)
        logger.info(f"Cleanup completed. Deleted {deleted_count} old backup(s).")

    except Exception as exc:
        error = str(exc)
        logger.error(f"A critical error occurred during backup: {exc}", exc_info=True)

    finally:
        if backup_file and os.path.exists(backup_file):
            try:
                os.remove(backup_file)
                logger.info(f"Removed local backup file: {backup_file}")
            except Exception as exc:
                logger.warning(f"Failed to remove local backup file: {exc}")

        try:
            status_fields = {
                "started_at": started_at,
                "finished_at": _utc_now_iso(),
                "success": success,
                "object": object_name,
                "size_bytes": size_bytes,
                "archive_object": archive_object,
                "archive_skipped_reason": archive_skipped_reason,
                "error": error,
            }
            if archive_error is not None:
                status_fields["archive_error"] = archive_error
            status.write_status(**status_fields)
        finally:
            _backup_lock.release()

    logger.info("=" * 60)
    logger.info("Backup process completed")
    logger.info("=" * 60)


def check_run_now_trigger():
    if status.consume_trigger():
        run_backup()


def main():
    """Main function to start the backup scheduler."""
    logger.info("Initializing backup scheduler...")
    logger.info(f"Cluster: all databases @ {DB_HOST}:{DB_PORT}")
    logger.info(f"Retention: {RETENTION_DAYS} days")

    # Get timezone
    try:
        tz = ZoneInfo(BACKUP_TIMEZONE)
        logger.info(f"Schedule: hour={BACKUP_SCHEDULE_HOUR} minute={BACKUP_SCHEDULE_MINUTE} {BACKUP_TIMEZONE}")
    except Exception as e:
        logger.error(f"Invalid timezone: {BACKUP_TIMEZONE}. Error: {e}")
        logger.info("Falling back to UTC")
        tz = ZoneInfo("UTC")

    # Validate environment variables
    if not all([DB_HOST, DB_USER, DB_PASS]):
        logger.error("Missing required database environment variables. Exiting.")
        sys.exit(1)

    _write_initial_status_if_missing()

    scheduler = BlockingScheduler(timezone=tz)

    scheduler.add_job(
        run_backup,
        trigger=CronTrigger(hour=BACKUP_SCHEDULE_HOUR, minute=BACKUP_SCHEDULE_MINUTE, timezone=tz),
        id="twice_daily_backup",
        name="Twice Daily Database Backup",
        replace_existing=True,
    )

    scheduler.add_job(
        check_run_now_trigger,
        trigger=IntervalTrigger(seconds=15),
        id="run_now_trigger",
        name="Run-now trigger poll",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    # Get the job to check next run time
    job = scheduler.get_job("twice_daily_backup")
    if job and hasattr(job, "next_run_time") and job.next_run_time:
        logger.info(f"Next backup scheduled for: {job.next_run_time}")
    else:
        logger.info("Backup scheduler configured. Next run time will be calculated when scheduler starts.")

    try:
        if _startup_backup_enabled():
            logger.info("Running initial backup on startup...")
            run_backup()
        else:
            logger.info("Skipping startup backup (BACKUP_ON_STARTUP not enabled)")

        logger.info("Backup scheduler started. Waiting for scheduled time...")
        # Start the scheduler (this will block)
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped by user")
        scheduler.shutdown()
    except Exception as e:
        logger.error(f"Scheduler error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
