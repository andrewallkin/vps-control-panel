"""deploy job_id for startup reconciliation

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa

from alembic import op

revision = "0006_deploy_job_id"
down_revision = "0005_panel_event"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("deploy", sa.Column("job_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("deploy", "job_id")
