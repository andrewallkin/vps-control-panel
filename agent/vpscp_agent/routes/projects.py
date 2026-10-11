from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, model_validator

from vpscp_agent import audit
from vpscp_agent.deploy_keys import ensure_deploy_key
from vpscp_agent.projects import (
    ProjectRecord,
    get_project,
    list_projects,
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

    def validated(self) -> dict[str, str]:
        return {
            "slug": validate_project_slug(self.slug),
            "repo_url": validate_repo_url(self.repo_url),
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

    def validated_updates(self) -> dict[str, str]:
        out: dict[str, str] = {}
        if self.repo_url is not None:
            out["repo_url"] = validate_repo_url(self.repo_url)
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
    fields = body.validated()
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
    updates = body.validated_updates()
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
