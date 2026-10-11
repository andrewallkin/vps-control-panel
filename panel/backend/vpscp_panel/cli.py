import argparse
import getpass
import os
import sys
from datetime import UTC, datetime

import pyotp
import qrcode
from sqlalchemy import delete, select

import vpscp_panel.db as db_module
from vpscp_panel.config import PanelSettings
from vpscp_panel.db import init_db, run_migrations
from vpscp_panel.models import AdminUser, Session
from vpscp_panel.security import encrypt_secret, hash_password


def _read_password() -> str:
    env_password = os.environ.get("VPSCP_ADMIN_PASSWORD")
    if env_password is not None:
        return env_password
    first = getpass.getpass("Password: ")
    second = getpass.getpass("Confirm password: ")
    if first != second:
        print("Passwords do not match", file=sys.stderr)
        sys.exit(1)
    return first


def _validate_password(password: str) -> None:
    if len(password) < 12:
        print("Password must be at least 12 characters", file=sys.stderr)
        sys.exit(1)


def _print_totp(username: str, secret: str) -> None:
    uri = f"otpauth://totp/vpscp:{username}?secret={secret}&issuer=vpscp"
    print(uri)
    qr = qrcode.QRCode()
    qr.add_data(uri)
    qr.make(fit=True)
    qr.print_ascii(invert=True)


def _get_single_admin(db) -> AdminUser | None:
    return db.scalar(select(AdminUser).limit(1))


def cmd_create_admin(args: argparse.Namespace) -> None:
    settings = PanelSettings()
    run_migrations(settings)
    init_db(settings)
    assert db_module.SessionLocal is not None
    password = _read_password()
    _validate_password(password)
    secret = pyotp.random_base32()
    with db_module.SessionLocal() as db:
        existing = _get_single_admin(db)
        if existing is not None and not args.force:
            sys.exit(2)
        now = datetime.now(UTC)
        if existing is not None and args.force:
            existing.username = args.username
            existing.password_hash = hash_password(password)
            existing.totp_secret_enc = encrypt_secret(settings, secret)
            existing.totp_last_step = None
            db.execute(delete(Session))
            db.commit()
            _print_totp(args.username, secret)
            return
        if existing is not None:
            sys.exit(2)
        admin = AdminUser(
            username=args.username,
            password_hash=hash_password(password),
            totp_secret_enc=encrypt_secret(settings, secret),
            totp_last_step=None,
            failed_attempts=0,
            locked_until=None,
            created_at=now,
        )
        db.add(admin)
        db.commit()
    _print_totp(args.username, secret)


def cmd_has_admin(_args: argparse.Namespace) -> None:
    settings = PanelSettings()
    run_migrations(settings)
    init_db(settings)
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        if _get_single_admin(db) is None:
            sys.exit(1)


def cmd_reset_totp(_args: argparse.Namespace) -> None:
    settings = PanelSettings()
    run_migrations(settings)
    init_db(settings)
    assert db_module.SessionLocal is not None
    secret = pyotp.random_base32()
    with db_module.SessionLocal() as db:
        admin = _get_single_admin(db)
        if admin is None:
            sys.exit(2)
        admin.totp_secret_enc = encrypt_secret(settings, secret)
        admin.totp_last_step = None
        db.commit()
        _print_totp(admin.username, secret)


def cmd_reset_password(_args: argparse.Namespace) -> None:
    settings = PanelSettings()
    run_migrations(settings)
    init_db(settings)
    assert db_module.SessionLocal is not None
    password = _read_password()
    _validate_password(password)
    with db_module.SessionLocal() as db:
        admin = _get_single_admin(db)
        if admin is None:
            sys.exit(2)
        admin.password_hash = hash_password(password)
        db.commit()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="vpscp_panel.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create-admin")
    create.add_argument("--username", required=True)
    create.add_argument("--force", action="store_true")
    create.set_defaults(func=cmd_create_admin)

    has_admin = sub.add_parser("has-admin")
    has_admin.set_defaults(func=cmd_has_admin)

    reset_totp = sub.add_parser("reset-totp")
    reset_totp.set_defaults(func=cmd_reset_totp)

    reset_pw = sub.add_parser("reset-password")
    reset_pw.set_defaults(func=cmd_reset_password)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
