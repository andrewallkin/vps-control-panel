from pathlib import Path

from alembic.config import Config
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from alembic import command
from vpscp_panel.config import PanelSettings

_engine: Engine | None = None
SessionLocal: sessionmaker | None = None


class Base(DeclarativeBase):
    pass


def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db(settings: PanelSettings) -> Engine:
    global _engine, SessionLocal

    settings.panel_data_dir.mkdir(parents=True, exist_ok=True)
    database_url = f"sqlite:///{settings.panel_db_path}"
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _configure_sqlite_connection)
    _engine = engine
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database has not been initialized")
    return _engine


def run_migrations(settings: PanelSettings) -> None:
    settings.panel_data_dir.mkdir(parents=True, exist_ok=True)
    alembic_ini = Path(__file__).resolve().parent.parent / "alembic.ini"
    config = Config(str(alembic_ini))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{settings.panel_db_path}")
    command.upgrade(config, "head")
