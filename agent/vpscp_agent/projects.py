from __future__ import annotations

import os
import sqlite3
from datetime import UTC, datetime

from pydantic import BaseModel

from vpscp_agent.audit import scrub_error_message
from vpscp_agent.commands import Runner
from vpscp_agent.config import Settings
from vpscp_agent.db_ops import ConflictError, NotFoundError
from vpscp_agent.github_keys import ensure_known_hosts, git_ssh_command
from vpscp_agent.state import StateDB
from vpscp_agent.validation import (
    is_ssh_repo_url,
    validate_branch,
    validate_compose_file,
    validate_deploy_mode,
    validate_project_slug,
    validate_repo_url,
)


class ProjectRecord(BaseModel):
    slug: str
    repo_url: str
    branch: str
    compose_file: str
    deploy_mode: str
    created_at: str
    dir_exists: bool
    cloned: bool


class TestAccessResult(BaseModel):
    ok: bool
    message: str


def _ensure_project_dirs(settings: Settings, slug: str) -> None:
    project_dir = settings.apps_dir / slug
    data_dir = project_dir / "data"
    project_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(project_dir, 0o750)
    os.chmod(data_dir, 0o750)


def _row_to_record(settings: Settings, row: sqlite3.Row) -> ProjectRecord:
    slug = row["slug"]
    project_dir = settings.apps_dir / slug
    return ProjectRecord(
        slug=slug,
        repo_url=row["repo_url"],
        branch=row["branch"],
        compose_file=row["compose_file"],
        deploy_mode=row["deploy_mode"],
        created_at=row["created_at"],
        dir_exists=project_dir.is_dir(),
        cloned=(project_dir / ".git").exists(),
    )


def get_project_row(db: StateDB, slug: str) -> sqlite3.Row | None:
    with db.connect() as conn:
        return conn.execute("SELECT * FROM project WHERE slug = ?", (slug,)).fetchone()


def register_project(
    db: StateDB,
    settings: Settings,
    *,
    slug: str,
    repo_url: str,
    branch: str,
    compose_file: str,
    deploy_mode: str,
) -> ProjectRecord:
    validate_project_slug(slug)
    validate_repo_url(repo_url)
    validate_branch(branch)
    validate_compose_file(compose_file)
    validate_deploy_mode(deploy_mode)

    existing = get_project_row(db, slug)
    if existing is not None:
        same = (
            existing["repo_url"] == repo_url
            and existing["branch"] == branch
            and existing["compose_file"] == compose_file
            and existing["deploy_mode"] == deploy_mode
        )
        if not same:
            raise ConflictError(f"project already registered with different settings: {slug!r}")
        _ensure_project_dirs(settings, slug)
        return _row_to_record(settings, existing)

    created_at = datetime.now(UTC).isoformat()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO project (slug, repo_url, branch, compose_file, deploy_mode, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (slug, repo_url, branch, compose_file, deploy_mode, created_at),
        )
    _ensure_project_dirs(settings, slug)
    row = get_project_row(db, slug)
    assert row is not None
    return _row_to_record(settings, row)


def update_project(
    db: StateDB,
    settings: Settings,
    slug: str,
    *,
    repo_url: str | None = None,
    branch: str | None = None,
    compose_file: str | None = None,
    deploy_mode: str | None = None,
) -> ProjectRecord:
    validate_project_slug(slug)
    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")

    new_repo = row["repo_url"] if repo_url is None else validate_repo_url(repo_url)
    new_branch = row["branch"] if branch is None else validate_branch(branch)
    new_compose = (
        row["compose_file"] if compose_file is None else validate_compose_file(compose_file)
    )
    new_mode = row["deploy_mode"] if deploy_mode is None else validate_deploy_mode(deploy_mode)

    with db.connect() as conn:
        conn.execute(
            "UPDATE project SET repo_url = ?, branch = ?, compose_file = ?, deploy_mode = ? "
            "WHERE slug = ?",
            (new_repo, new_branch, new_compose, new_mode, slug),
        )
    updated = get_project_row(db, slug)
    assert updated is not None
    return _row_to_record(settings, updated)


def get_project(settings: Settings, db: StateDB, slug: str) -> ProjectRecord:
    validate_project_slug(slug)
    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")
    return _row_to_record(settings, row)


def list_projects(settings: Settings, db: StateDB) -> list[ProjectRecord]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM project ORDER BY slug").fetchall()
    return [_row_to_record(settings, row) for row in rows]


def test_repo_access(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    *,
    slug: str,
) -> TestAccessResult:
    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")

    repo_url = row["repo_url"]
    branch = row["branch"]
    extra_env: dict[str, str] = {"GIT_TERMINAL_PROMPT": "0"}

    if is_ssh_repo_url(repo_url):
        from vpscp_agent.deploy_keys import deploy_key_private_path

        private_path = deploy_key_private_path(settings, slug)
        if not private_path.is_file():
            return TestAccessResult(ok=False, message="deploy key is not generated")
        try:
            known_hosts = ensure_known_hosts(settings)
        except (ValueError, OSError) as exc:
            return TestAccessResult(ok=False, message=str(exc))
        extra_env["GIT_SSH_COMMAND"] = git_ssh_command(private_path, known_hosts)

    result = runner(
        ["git", "ls-remote", repo_url, branch],
        extra_env=extra_env,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        message = scrub_error_message(
            result.stderr.strip() or result.stdout.strip() or "git failed"
        )
        return TestAccessResult(ok=False, message=message)
    if not result.stdout.strip():
        return TestAccessResult(ok=False, message="branch not found")
    return TestAccessResult(ok=True, message="ok")
