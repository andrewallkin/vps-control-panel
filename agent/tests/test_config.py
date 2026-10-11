from vpscp_agent.config import load_settings


def test_db_backup_settings_defaults():
    settings = load_settings({})
    assert settings.pg_container == "postgres-central"
    assert settings.backup_image == "vpscp-backup:local"
    assert settings.max_upload_bytes == 10737418240
    assert settings.backup_state_dir == settings.state_dir / "backup"
    assert settings.dumps_dir == settings.state_dir / "dumps"
    assert settings.restore_dir == settings.state_dir / "restore"
    assert settings.stack_env_path == settings.stack_dir / ".env"
