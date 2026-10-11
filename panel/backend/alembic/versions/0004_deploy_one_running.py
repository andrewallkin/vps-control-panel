"""one running deploy per project

Revision ID: 0004_deploy_one_running
Revises: 0003_projects
Create Date: 2026-03-22 00:00:03.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004_deploy_one_running"
down_revision: str | None = "0003_projects"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX ux_deploy_one_running ON deploy (project_slug) "
        "WHERE status = 'running'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_deploy_one_running")
