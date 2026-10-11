from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
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
