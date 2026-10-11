from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, model_validator

from vpscp_agent import audit
from vpscp_agent.deploy_keys import ensure_deploy_key
from vpscp_agent.jobs import JobLockedError
from vpscp_agent.project_env import (
    EnvEntriesResponse,
    patch_project_env,
    read_project_env,
    write_project_env,
)
from vpscp_agent.projects import (
    DeleteProjectResult,
    ProjectRecord,
    clone_project,
    delete_project,
    get_project,
    list_projects,
    pull_project,
    register_project,
    test_repo_access,
    update_project,
)
from vpscp_agent.validation import (
    Slug,
    validate_branch,
    validate_compose_file,
    validate_deploy_mode,
    validate_project_slug,
    validate_repo_url,
)

router = APIRouter(prefix="/v1/projects", tags=["projects"])


class RegisterProjectBody(BaseModel):
    slug: str
    repo_url: str
    branch: str
    compose_file: str
    deploy_mode: Literal["image", "build"]

    def validated(self, *, allow_file_repos: bool = False) -> dict[str, str]:
        return {
            "slug": validate_project_slug(self.slug),
            "repo_url": validate_repo_url(self.repo_url, allow_file_repos=allow_file_repos),
            "branch": validate_branch(self.branch),
            "compose_file": validate_compose_file(self.compose_file),
            "deploy_mode": validate_deploy_mode(self.deploy_mode),
        }


class UpdateProjectBody(BaseModel):
    repo_url: str | None = None
    branch: str | None = None
    compose_file: str | None = None
    deploy_mode: Literal["image", "build"] | None = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "UpdateProjectBody":
        if (
            self.repo_url is None
            and self.branch is None
            and self.compose_file is None
            and self.deploy_mode is None
        ):
            raise ValueError("at least one field is required")
        return self

    def validated_updates(self, *, allow_file_repos: bool = False) -> dict[str, str]:
        out: dict[str, str] = {}
        if self.repo_url is not None:
            out["repo_url"] = validate_repo_url(self.repo_url, allow_file_repos=allow_file_repos)
        if self.branch is not None:
            out["branch"] = validate_branch(self.branch)
        if self.compose_file is not None:
            out["compose_file"] = validate_compose_file(self.compose_file)
        if self.deploy_mode is not None:
            out["deploy_mode"] = validate_deploy_mode(self.deploy_mode)
        return out


class DeployKeyResponse(BaseModel):
    public_key: str


class TestAccessResponse(BaseModel):
    ok: bool
    message: str


@router.post("", response_model=ProjectRecord)
def post_register(body: RegisterProjectBody, request: Request) -> ProjectRecord:
    db = request.app.state.db
    settings = request.app.state.settings
    fields = body.validated(allow_file_repos=settings.allow_file_repos)
    params = {
        key: fields[key] for key in ("slug", "repo_url", "branch", "compose_file", "deploy_mode")
    }
    with audit.audited(db, "project.register", params):
        return register_project(db, settings, **fields)


@router.patch("/{slug}", response_model=ProjectRecord)
def patch_project(slug: Slug, body: UpdateProjectBody, request: Request) -> ProjectRecord:
    db = request.app.state.db
    settings = request.app.state.settings
    validate_project_slug(slug)
    updates = body.validated_updates(allow_file_repos=settings.allow_file_repos)
    params = {"slug": slug, **updates}
    with audit.audited(db, "project.update", params):
        return update_project(db, settings, slug, **updates)


@router.get("", response_model=list[ProjectRecord])
def get_projects(request: Request) -> list[ProjectRecord]:
    db = request.app.state.db
    settings = request.app.state.settings
    return list_projects(settings, db)


@router.get("/{slug}", response_model=ProjectRecord)
def get_project_route(slug: Slug, request: Request) -> ProjectRecord:
    db = request.app.state.db
    settings = request.app.state.settings
    return get_project(settings, db, slug)


@router.post("/{slug}/deploy-key", response_model=DeployKeyResponse)
def post_deploy_key(slug: Slug, request: Request) -> DeployKeyResponse:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    validate_project_slug(slug)
    params = {"slug": slug}
    with audit.audited(db, "project.deploy_key", params):
        public_key = ensure_deploy_key(settings, db, runner, slug=slug)
    return DeployKeyResponse(public_key=public_key)


@router.post("/{slug}/test-access", response_model=TestAccessResponse)
def post_test_access(slug: Slug, request: Request) -> TestAccessResponse:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    validate_project_slug(slug)
    return test_repo_access(settings, db, runner, slug=slug)


@router.post("/{slug}/clone", status_code=202)
def post_clone(slug: Slug, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    get_project(settings, db, slug)

    def body_fn(ctx):
        return clone_project(ctx, settings, db, runner, slug)

    job = jobs.start(
        "project.clone",
        {"slug": slug},
        body_fn,
        lock_key=f"deploy:{slug}",
    )
    return {"job_id": job.id}


@router.post("/{slug}/pull")
def post_pull(slug: Slug, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    lock_key = f"deploy:{slug}"
    if jobs.is_locked(lock_key):
        raise JobLockedError(lock_key)
    params = {"slug": slug}
    with audit.audited(db, "project.pull", params):
        return pull_project(settings, db, runner, slug)


class PutEnvBody(BaseModel):
    content: str


class PatchEnvBody(BaseModel):
    set: dict[str, str] = {}
    unset: list[str] = []

    @model_validator(mode="after")
    def validate_patch_fields(self) -> "PatchEnvBody":
        if not self.set and not self.unset:
            raise ValueError("at least one set or unset is required")
        overlap = set(self.set) & set(self.unset)
        if overlap:
            raise ValueError("key cannot be in both set and unset")
        return self


class DeleteProjectBody(BaseModel):
    confirm: str


@router.get("/{slug}/env", response_model=EnvEntriesResponse)
def get_project_env_route(slug: Slug, request: Request, reveal: bool = False) -> EnvEntriesResponse:
    db = request.app.state.db
    settings = request.app.state.settings
    return read_project_env(settings, db, slug, reveal=reveal)


@router.put("/{slug}/env")
def put_project_env_route(slug: Slug, body: PutEnvBody, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    params = {"slug": slug, "keys": []}
    with audit.audited(db, "env.write", params):
        keys = write_project_env(settings, db, slug, body.content)
        params["keys"] = keys
    return {"ok": "true"}


@router.patch("/{slug}/env")
def patch_project_env_route(slug: Slug, body: PatchEnvBody, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    params = {
        "slug": slug,
        "set": list(body.set.keys()),
        "unset": list(body.unset),
    }
    with audit.audited(db, "env.patch", params):
        patch_project_env(
            settings,
            db,
            slug,
            set_values=body.set,
            unset_keys=body.unset,
        )
    return {"ok": "true"}


@router.delete("/{slug}", response_model=DeleteProjectResult)
def delete_project_route(
    slug: Slug, body: DeleteProjectBody, request: Request
) -> DeleteProjectResult:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    lock_key = f"deploy:{slug}"
    if jobs.is_locked(lock_key):
        raise JobLockedError(lock_key)
    params = {"slug": slug}
    with audit.audited(db, "project.delete", params):
        return delete_project(settings, db, runner, slug=slug, confirm=body.confirm)
