from __future__ import annotations

import os
import shutil
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
from pydantic import BaseModel

from vpscp_agent.audit import scrub_error_message
from vpscp_agent.commands import Runner
from vpscp_agent.config import Settings
from vpscp_agent.db_ops import ConflictError, NotFoundError, detach
from vpscp_agent.github_keys import ensure_known_hosts, git_ssh_command
from vpscp_agent.hostnames import release_ports, release_site
from vpscp_agent.jobs import JobContext
from vpscp_agent.nginx_apply import remove_site
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
    validate_repo_url(repo_url, allow_file_repos=settings.allow_file_repos)
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

    new_repo = (
        row["repo_url"]
        if repo_url is None
        else validate_repo_url(repo_url, allow_file_repos=settings.allow_file_repos)
    )
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
        except (ValueError, OSError, httpx.HTTPError) as exc:
            return TestAccessResult(
                ok=False,
                message=scrub_error_message(str(exc)),
            )
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


def _git_clone_env(
    settings: Settings,
    *,
    slug: str,
    repo_url: str,
) -> dict[str, str]:
    extra_env: dict[str, str] = {"GIT_TERMINAL_PROMPT": "0"}
    if not is_ssh_repo_url(repo_url):
        return extra_env

    from vpscp_agent.deploy_keys import deploy_key_private_path

    private_path = deploy_key_private_path(settings, slug)
    if not private_path.is_file():
        raise ValueError("deploy key is not generated")
    known_hosts = ensure_known_hosts(settings)
    extra_env["GIT_SSH_COMMAND"] = git_ssh_command(private_path, known_hosts)
    return extra_env


def _replace_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def _merge_clone_into_project(tmp_dir: Path, project_dir: Path) -> None:
    for child in tmp_dir.iterdir():
        dest = project_dir / child.name
        if child.name == ".env":
            if dest.exists():
                child.unlink()
            else:
                shutil.move(str(child), str(dest))
            continue
        if child.name == "data":
            if dest.is_dir():
                shutil.rmtree(child)
            else:
                shutil.move(str(child), str(dest))
            continue
        if child.name == ".git":
            _replace_path(dest)
            shutil.move(str(child), str(dest))
            continue
        _replace_path(dest)
        shutil.move(str(child), str(dest))


def clone_project(
    ctx: JobContext,
    settings: Settings,
    db: StateDB,
    runner: Runner,
    slug: str,
) -> dict[str, str]:
    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")

    repo_url = row["repo_url"]
    branch = row["branch"]
    project_dir = settings.apps_dir / slug
    project_dir.mkdir(parents=True, exist_ok=True)
    preserve_env = (project_dir / ".env").is_file()

    tmp_dir = settings.apps_dir / f".tmp-{slug}-{uuid.uuid4().hex}"
    ctx.log(f"cloning {slug}")
    extra_env = _git_clone_env(settings, slug=slug, repo_url=repo_url)

    try:
        runner(
            [
                "git",
                "clone",
                "--branch",
                branch,
                "--single-branch",
                repo_url,
                str(tmp_dir),
            ],
            extra_env=extra_env,
            timeout=300,
        )
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    try:
        _merge_clone_into_project(tmp_dir, project_dir)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if preserve_env:
        runner(
            ["git", "update-index", "--skip-worktree", ".env"],
            cwd=project_dir,
            timeout=30,
        )

    result = runner(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        timeout=30,
    )
    commit = result.stdout.strip()
    ctx.log(f"cloned {slug} at {commit[:12]}")
    return {"commit": commit}


def pull_project(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    slug: str,
) -> dict[str, str]:
    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")

    project_dir = settings.apps_dir / slug
    if not (project_dir / ".git").exists():
        raise ValueError("project is not cloned")

    repo_url = row["repo_url"]
    branch = row["branch"]
    extra_env = _git_clone_env(settings, slug=slug, repo_url=repo_url)

    runner(
        ["git", "fetch", "origin", branch],
        cwd=project_dir,
        extra_env=extra_env,
        timeout=120,
    )
    runner(
        ["git", "reset", "--hard", f"origin/{branch}"],
        cwd=project_dir,
        extra_env=extra_env,
        timeout=120,
    )
    result = runner(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        timeout=30,
    )
    return {"commit": result.stdout.strip()}


class DeleteProjectResult(BaseModel):
    removed: list[str]
    warnings: list[str]


def delete_project(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    *,
    slug: str,
    confirm: str,
) -> DeleteProjectResult:
    if confirm != slug:
        raise ValueError("confirm must match slug")

    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")

    removed: list[str] = []
    warnings: list[str] = []
    project_dir = settings.apps_dir / slug
    compose_path = project_dir / row["compose_file"]

    with db.connect() as conn:
        had_hostname = (
            conn.execute("SELECT 1 FROM hostname WHERE site = ?", (slug,)).fetchone() is not None
        )
        had_ports = (
            conn.execute("SELECT 1 FROM port_allocation WHERE owner = ?", (slug,)).fetchone()
            is not None
        )
        had_attachment = (
            conn.execute("SELECT 1 FROM db_attachment WHERE slug = ?", (slug,)).fetchone()
            is not None
        )

    if compose_path.is_file():
        result = runner(
            [
                "docker",
                "compose",
                "-p",
                slug,
                "-f",
                row["compose_file"],
                "--env-file",
                ".env",
                "down",
                "--remove-orphans",
            ],
            cwd=project_dir,
            check=False,
            timeout=300,
        )
        if result.returncode == 0:
            removed.append("compose")
        else:
            tail = result.stderr.strip() or result.stdout.strip() or "compose down failed"
            warnings.append(scrub_error_message(tail))

    nginx_ok = False
    try:
        remove_site(slug, settings=settings, runner=runner, db=db)
        nginx_ok = True
        removed.append("nginx")
    except Exception as exc:  # noqa: BLE001
        warnings.append(scrub_error_message(str(exc)))
        release_site(db, slug)

    if had_hostname or nginx_ok:
        removed.append("hostnames")

    if had_ports:
        release_ports(db, slug)
        removed.append("ports")
    else:
        release_ports(db, slug)

    if had_attachment:
        detach(db, slug=slug)
        removed.append("attachment")
    else:
        detach(db, slug=slug)

    from vpscp_agent.deploy_keys import deploy_key_private_path, deploy_key_public_path

    private_path = deploy_key_private_path(settings, slug)
    public_path = deploy_key_public_path(settings, slug)
    had_key = private_path.is_file() or public_path.is_file()
    private_path.unlink(missing_ok=True)
    public_path.unlink(missing_ok=True)
    if had_key:
        removed.append("deploy_key")

    if project_dir.is_dir():
        shutil.rmtree(project_dir)
        removed.append("dir")

    with db.connect() as conn:
        cur = conn.execute("DELETE FROM project WHERE slug = ?", (slug,))
        if cur.rowcount:
            removed.append("registry")

    return DeleteProjectResult(removed=removed, warnings=warnings)
