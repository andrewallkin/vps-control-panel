import gzip
import os

import pytest

os.environ.setdefault("BACKUP_LOG_DIR", "/tmp/vpscp-backup-test-logs")

from pyrage import passphrase as pyrage_passphrase  # noqa: E402

import backup_script  # noqa: E402


def test_maybe_encrypt_backup_encrypts_with_passphrase(tmp_path, monkeypatch):
    """DB dumps contain all app rows and role hashes: when the archive
    passphrase is set the uploaded object must be age-encrypted."""
    monkeypatch.setenv("BACKUP_ARCHIVE_PASSPHRASE", "s3cret")
    dump = tmp_path / "backup_x.sql.gz"
    dump.write_bytes(gzip.compress(b"CREATE ROLE pgadmin;"))

    result = backup_script.maybe_encrypt_backup(str(dump))

    assert result.endswith(".sql.gz.age")
    with open(result, "rb") as handle:
        encrypted = handle.read()
    assert b"CREATE ROLE" not in encrypted
    decrypted = pyrage_passphrase.decrypt(encrypted, "s3cret")
    assert gzip.decompress(decrypted) == b"CREATE ROLE pgadmin;"


def test_maybe_encrypt_backup_without_passphrase_keeps_plain(tmp_path, monkeypatch):
    monkeypatch.delenv("BACKUP_ARCHIVE_PASSPHRASE", raising=False)
    dump = tmp_path / "backup_x.sql.gz"
    dump.write_bytes(b"plain")

    result = backup_script.maybe_encrypt_backup(str(dump))

    assert result == str(dump)
    assert dump.read_bytes() == b"plain"
