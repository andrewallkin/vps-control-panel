import io
import tarfile
from pathlib import Path

import pytest
from pyrage import passphrase as pyrage_passphrase

import config_archive


def test_encrypt_decrypt_round_trip():
    plain = b"secret payload"
    key = "test-passphrase"
    encrypted = config_archive.encrypt(plain, key)
    assert encrypted != plain
    assert pyrage_passphrase.decrypt(encrypted, key) == plain


def test_build_archive_produces_valid_gzip_tar():
    sources = []
    data = config_archive.build_archive(sources)
    assert data[:2] == b"\x1f\x8b"
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
        assert tf.getnames() == []


def test_collect_sources_arcnames_and_exclusions(tmp_path):
    apps = tmp_path / "apps"
    slug = apps / "myapp"
    slug.mkdir(parents=True)
    (slug / ".env").write_text("SECRET=1\n")
    (slug / "README.md").write_text("clone noise\n")
    (slug / "src").mkdir()
    (slug / "src" / "main.py").write_text("print('hi')\n")
    data_dir = slug / "data"
    data_dir.mkdir()
    (data_dir / "db.sqlite").write_text("binary\n")

    stack_env = tmp_path / "stack" / ".env"
    stack_env.parent.mkdir(parents=True)
    stack_env.write_text("STACK=1\n")

    panel = tmp_path / "panel"
    panel.mkdir()
    (panel / "config.yaml").write_text("x: 1\n")

    sources = config_archive.collect_sources(
        apps_root=apps,
        extra=[tmp_path / "stack" / ".env", panel],
    )
    arcnames = {arc for _path, arc in sources}
    assert "apps/myapp/.env" in arcnames
    assert "apps/myapp/data/db.sqlite" in arcnames
    assert "stack/.env" in arcnames
    assert "panel/config.yaml" in arcnames
    assert not any("README" in a for a in arcnames)
    assert not any("/src/" in a or a.endswith("main.py") for a in arcnames)


def test_collect_sources_skips_missing_extra(tmp_path):
    apps = tmp_path / "apps"
    apps.mkdir()
    sources = config_archive.collect_sources(
        apps_root=apps,
        extra=[tmp_path / "missing" / ".env"],
    )
    assert sources == []


def test_build_archive_includes_collected_files(tmp_path):
    apps = tmp_path / "apps"
    slug = apps / "web"
    slug.mkdir(parents=True)
    (slug / ".env").write_text("A=1\n")
    sources = config_archive.collect_sources(apps_root=apps, extra=[])
    archive = config_archive.build_archive(sources)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
        names = tf.getnames()
        assert "apps/web/.env" in names
        member = tf.extractfile("apps/web/.env")
        assert member is not None
        assert member.read() == b"A=1\n"
