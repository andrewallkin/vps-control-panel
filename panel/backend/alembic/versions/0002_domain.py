"""domain table

Revision ID: 0002_domain
Revises: 0001_initial
Create Date: 2026-03-22 00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_domain"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "domain",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("zone_id", sa.String(), nullable=False),
        sa.Column("cert_status", sa.String(), nullable=True),
        sa.Column("cert_expires_at", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("domain")
