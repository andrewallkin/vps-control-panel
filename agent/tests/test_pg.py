import pytest

from tests.fakes import FakeRunner
from vpscp_agent.pg import Psql, quote_ident


def test_exec_sql_passes_secret_via_env_not_args(settings, tmp_path):
    (settings.stack_dir).mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    psql = Psql(settings, runner)
    psql.exec_sql("\\getenv pw VPSCP_PW\nSELECT :'pw';", secrets={"VPSCP_PW": "s3cret"})
    call = runner.calls[0]
    assert "s3cret" not in " ".join(call["args"])
    assert call["args"][:4] == ["docker", "exec", "-i", "-e"] and "VPSCP_PW" in call["args"]
    assert call["extra_env"] == {"VPSCP_PW": "s3cret"}
    assert call["args"][-6:] == ["-U", "pgadmin", "-d", "postgres", "-f", "-"]


def test_query_rows_parses_csv(settings, tmp_path):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    runner.on("psql", stdout='a,1\n"b,c",2\n')
    psql = Psql(settings, runner)
    rows = psql.query_rows("SELECT a, b FROM t")
    assert rows == [["a", "1"], ["b,c", "2"]]


def test_verify_login_uses_container_host(settings, tmp_path):
    settings.stack_dir.mkdir(parents=True)
    runner = FakeRunner()
    runner.on("SELECT 1", returncode=2)
    psql = Psql(settings, runner)
    assert psql.verify_login("myuser", "mypass", "mydb") is False
    call = runner.calls[0]
    args = call["args"]
    assert "postgres-central" in args
    hi = args.index("-h")
    assert args[hi + 1] == "postgres-central"
    assert call["extra_env"] == {"PGPASSWORD": "mypass"}


def test_quote_ident_rejects_injection():
    with pytest.raises(ValueError):
        quote_ident('x"; drop')
