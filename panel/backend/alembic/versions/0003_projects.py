"""project tables

Revision ID: 0003_projects
Revises: 0002_domain
Create Date: 2026-03-22 00:00:02.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_projects"
down_revision: str | None = "0002_domain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project",
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("repo_url", sa.String(), nullable=False),
        sa.Column("branch", sa.String(), nullable=False),
        sa.Column("compose_file", sa.String(), nullable=False),
        sa.Column("deploy_mode", sa.String(), nullable=False),
        sa.Column("docker_hub_repo", sa.String(), nullable=True),
        sa.Column("database_mode", sa.String(), nullable=False),
        sa.Column("db_name", sa.String(), nullable=True),
        sa.Column("db_user", sa.String(), nullable=True),
        sa.Column("write_database_url", sa.Boolean(), nullable=False),
        sa.Column("migration_command", sa.String(), nullable=True),
        sa.Column("migration_service", sa.String(), nullable=True),
        sa.Column("health_check_url", sa.String(), nullable=True),
        sa.Column("user_env", sa.Text(), nullable=True),
        sa.Column("creation_state", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("slug"),
    )
    op.create_table(
        "project_service",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_slug", sa.String(), nullable=False),
        sa.Column("service_name", sa.String(), nullable=False),
        sa.Column("image_env_var", sa.String(), nullable=False),
        sa.Column("tag_prefix", sa.String(), nullable=False),
        sa.Column("current_tag", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["project_slug"], ["project.slug"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_slug", "service_name"),
    )
    op.create_table(
        "project_hostname",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_slug", sa.String(), nullable=False),
        sa.Column("domain", sa.String(), nullable=False),
        sa.Column("subdomain", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["domain"], ["domain.name"]),
        sa.ForeignKeyConstraint(["project_slug"], ["project.slug"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "project_route",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_slug", sa.String(), nullable=False),
        sa.Column("path_prefix", sa.String(), nullable=False),
        sa.Column("port_env_var", sa.String(), nullable=False),
        sa.Column("max_body_mb", sa.Integer(), nullable=False, server_default="25"),
        sa.Column("read_timeout_s", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("send_timeout_s", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("streaming", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("websocket", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("pass_authorization", sa.Boolean(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["project_slug"], ["project.slug"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "port_allocation",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_slug", sa.String(), nullable=False),
        sa.Column("env_var", sa.String(), nullable=False),
        sa.Column("host_port", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["project_slug"], ["project.slug"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("host_port"),
    )
    op.create_table(
        "deploy",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_slug", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("tags_json", sa.Text(), nullable=False),
        sa.Column("log", sa.Text(), nullable=False, server_default=""),
        sa.Column("trigger", sa.String(), nullable=False),
        sa.Column("commit", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["project_slug"], ["project.slug"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("deploy")
    op.drop_table("port_allocation")
    op.drop_table("project_route")
    op.drop_table("project_hostname")
    op.drop_table("project_service")
    op.drop_table("project")
