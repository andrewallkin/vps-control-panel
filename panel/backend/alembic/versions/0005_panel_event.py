"""panel_event and totp pending secret

Revision ID: 0005_panel_event
Revises: 0004_deploy_one_running
Create Date: 2026-03-22 00:00:04.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_panel_event"
down_revision: str | None = "0004_deploy_one_running"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "panel_event",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_panel_event_ts", "panel_event", ["ts"])
    op.add_column("admin_user", sa.Column("totp_pending_enc", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("admin_user", "totp_pending_enc")
    op.drop_index("ix_panel_event_ts", table_name="panel_event")
    op.drop_table("panel_event")
