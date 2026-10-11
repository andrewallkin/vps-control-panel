from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from vpscp_panel.db import Base


class AdminUser(Base):
    __tablename__ = "admin_user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    totp_secret_enc: Mapped[str] = mapped_column(String, nullable=False)
    totp_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Session(Base):
    __tablename__ = "session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    admin_id: Mapped[int] = mapped_column(ForeignKey("admin_user.id"), nullable=False)
    csrf_token: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stepped_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str] = mapped_column(String, nullable=False)
    ip: Mapped[str] = mapped_column(String, nullable=False)


class Setting(Base):
    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)


class Domain(Base):
    __tablename__ = "domain"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    zone_id: Mapped[str] = mapped_column(String, nullable=False)
    cert_status: Mapped[str | None] = mapped_column(String, nullable=True)
    cert_expires_at: Mapped[str | None] = mapped_column(String, nullable=True)


class Project(Base):
    __tablename__ = "project"

    slug: Mapped[str] = mapped_column(String, primary_key=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    repo_url: Mapped[str] = mapped_column(String, nullable=False)
    branch: Mapped[str] = mapped_column(String, nullable=False)
    compose_file: Mapped[str] = mapped_column(String, nullable=False)
    deploy_mode: Mapped[str] = mapped_column(String, nullable=False)
    docker_hub_repo: Mapped[str | None] = mapped_column(String, nullable=True)
    database_mode: Mapped[str] = mapped_column(String, nullable=False)
    db_name: Mapped[str | None] = mapped_column(String, nullable=True)
    db_user: Mapped[str | None] = mapped_column(String, nullable=True)
    write_database_url: Mapped[bool] = mapped_column(Boolean, nullable=False)
    migration_command: Mapped[str | None] = mapped_column(String, nullable=True)
    migration_service: Mapped[str | None] = mapped_column(String, nullable=True)
    health_check_url: Mapped[str | None] = mapped_column(String, nullable=True)
    user_env: Mapped[str | None] = mapped_column(Text, nullable=True)
    creation_state: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ProjectService(Base):
    __tablename__ = "project_service"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_slug: Mapped[str] = mapped_column(ForeignKey("project.slug"), nullable=False)
    service_name: Mapped[str] = mapped_column(String, nullable=False)
    image_env_var: Mapped[str] = mapped_column(String, nullable=False)
    tag_prefix: Mapped[str] = mapped_column(String, nullable=False)
    current_tag: Mapped[str | None] = mapped_column(String, nullable=True)


class ProjectHostname(Base):
    __tablename__ = "project_hostname"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_slug: Mapped[str] = mapped_column(ForeignKey("project.slug"), nullable=False)
    domain: Mapped[str] = mapped_column(ForeignKey("domain.name"), nullable=False)
    subdomain: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)


class ProjectRoute(Base):
    __tablename__ = "project_route"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_slug: Mapped[str] = mapped_column(ForeignKey("project.slug"), nullable=False)
    path_prefix: Mapped[str] = mapped_column(String, nullable=False)
    port_env_var: Mapped[str] = mapped_column(String, nullable=False)
    max_body_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=25)
    read_timeout_s: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    send_timeout_s: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    streaming: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    websocket: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pass_authorization: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PortAllocation(Base):
    __tablename__ = "port_allocation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_slug: Mapped[str] = mapped_column(ForeignKey("project.slug"), nullable=False)
    env_var: Mapped[str] = mapped_column(String, nullable=False)
    host_port: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)


class Deploy(Base):
    __tablename__ = "deploy"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_slug: Mapped[str] = mapped_column(ForeignKey("project.slug"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    tags_json: Mapped[str] = mapped_column(Text, nullable=False)
    log: Mapped[str] = mapped_column(Text, nullable=False, default="")
    trigger: Mapped[str] = mapped_column(String, nullable=False)
    commit: Mapped[str | None] = mapped_column(String, nullable=True)
