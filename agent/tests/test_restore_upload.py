import gzip
import hashlib

import pytest
from fastapi.testclient import TestClient

from vpscp_agent import audit
from vpscp_agent.main import create_app
from vpscp_agent.restore import UploadStore

TINY_DUMP_PLAIN = (
    b"--\n-- PostgreSQL database cluster dump\n--\n"
    b"CREATE ROLE app_user;\nCREATE DATABASE app WITH ...;\n"
)
TINY_DUMP = gzip.compress(TINY_DUMP_PLAIN)


@pytest.fixture
def restore_client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def _create_upload(client, filename: str, data: bytes) -> str:
    resp = client.post("/v1/restore/uploads", json={"filename": filename, "size": len(data)})
    assert resp.status_code == 200, resp.text
    upload_id = resp.json()["upload_id"]
    mid = len(data) // 2
    r1 = client.put(
        f"/v1/restore/uploads/{upload_id}?offset=0",
        content=data[:mid],
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["received"] == mid
    r2 = client.put(
        f"/v1/restore/uploads/{upload_id}?offset={mid}",
        content=data[mid:],
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["received"] == len(data)
    return upload_id


def test_happy_path_gzip_two_chunks(restore_client, settings):
    client = restore_client
    data = TINY_DUMP
    db = client.app.state.db
    existing = audit.list_events(db)
    before_max_id = existing[0].id if existing else 0

    upload_id = _create_upload(client, "cluster.sql.gz", data)
    digest = hashlib.sha256(data).hexdigest()
    resp = client.post(f"/v1/restore/uploads/{upload_id}/complete", json={"sha256": digest})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == upload_id
    assert body["filename"] == "cluster.sql.gz"
    assert body["size"] == len(data)
    assert body["kind"] == "gzip"
    assert body["header_ok"] is True
    assert body["roles"] == ["app_user"]
    assert body["databases"] == ["app"]

    final = settings.restore_dir / f"{upload_id}.sql.gz"
    assert final.is_file()
    assert not (settings.restore_dir / f"{upload_id}.part").exists()

    new_events = [e for e in audit.list_events(db, limit=500) if e.id > before_max_id]
    ops = [e.operation for e in reversed(new_events)]
    assert ops == [
        "restore.create_upload",
        "restore.append",
        "restore.append",
        "restore.complete",
    ]


def test_wrong_offset(restore_client):
    client = restore_client
    data = TINY_DUMP
    resp = client.post("/v1/restore/uploads", json={"filename": "x.sql.gz", "size": len(data)})
    upload_id = resp.json()["upload_id"]
    bad = client.put(
        f"/v1/restore/uploads/{upload_id}?offset=5",
        content=data[:10],
        headers={"Content-Type": "application/octet-stream"},
    )
    assert bad.status_code == 400
    assert "0" in bad.json()["detail"]


def test_sha_mismatch(restore_client, settings):
    client = restore_client
    upload_id = _create_upload(client, "x.sql.gz", TINY_DUMP)
    resp = client.post(
        f"/v1/restore/uploads/{upload_id}/complete",
        json={"sha256": "0" * 64},
    )
    assert resp.status_code == 400
    assert (settings.restore_dir / f"{upload_id}.part").is_file()
    assert not list(settings.restore_dir.glob(f"{upload_id}.sql*"))


def test_corrupt_gzip(restore_client, settings):
    client = restore_client
    data = b"not gzip at all but long enough"
    upload_id = _create_upload(client, "bad.sql.gz", data)
    digest = hashlib.sha256(data).hexdigest()
    resp = client.post(f"/v1/restore/uploads/{upload_id}/complete", json={"sha256": digest})
    assert resp.status_code == 400
    assert "corrupt gzip" in resp.json()["detail"].lower()
    assert (settings.restore_dir / f"{upload_id}.part").is_file()


def test_plain_sql(restore_client, settings):
    client = restore_client
    data = TINY_DUMP_PLAIN
    upload_id = _create_upload(client, "cluster.sql", data)
    digest = hashlib.sha256(data).hexdigest()
    resp = client.post(f"/v1/restore/uploads/{upload_id}/complete", json={"sha256": digest})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "plain"
    assert (settings.restore_dir / f"{upload_id}.sql").is_file()


def test_non_pg_file(restore_client, settings):
    client = restore_client
    data = gzip.compress(b"hello world\n")
    upload_id = _create_upload(client, "nope.sql.gz", data)
    digest = hashlib.sha256(data).hexdigest()
    resp = client.post(f"/v1/restore/uploads/{upload_id}/complete", json={"sha256": digest})
    assert resp.status_code == 400
    assert "pg_dumpall cluster dump" in resp.json()["detail"]
    assert (settings.restore_dir / f"{upload_id}.part").is_file()


def test_mixed_case_suffix_full_flow(restore_client, settings):
    client = restore_client
    data = TINY_DUMP
    resp = client.post(
        "/v1/restore/uploads", json={"filename": "Cluster.SQL.GZ", "size": len(data)}
    )
    assert resp.status_code == 200, resp.text
    upload_id = resp.json()["upload_id"]
    put = client.put(f"/v1/restore/uploads/{upload_id}?offset=0", content=data)
    assert put.status_code == 200, put.text
    digest = hashlib.sha256(data).hexdigest()
    done = client.post(f"/v1/restore/uploads/{upload_id}/complete", json={"sha256": digest})
    assert done.status_code == 200, done.text
    assert done.json()["kind"] == "gzip"


def test_upload_id_rejects_path_traversal_and_short_id(settings):
    store = UploadStore(settings)
    with pytest.raises(ValueError, match="invalid upload id"):
        store.get("../")
    with pytest.raises(ValueError, match="invalid upload id"):
        store.get("abc")


def test_get_not_audited(restore_client):
    client = restore_client
    db = client.app.state.db
    upload_id = _create_upload(client, "x.sql.gz", TINY_DUMP)
    before = len(audit.list_events(db))
    assert client.get(f"/v1/restore/uploads/{upload_id}").status_code == 200
    assert len(audit.list_events(db)) == before
