import pytest

from vpscp_agent.envfile import EnvFile, read_env, write_env_atomic


def test_parse_get_and_preserve_comments():
    env = EnvFile.parse("# c\nA=1\n\nB='two'\nC=\"x y\"\n")
    assert env.get("A") == "1" and env.get("B") == "two" and env.get("C") == "x y"
    env.set_many({"A": "9", "D": "new"})
    assert env.render() == "# c\nA=9\n\nB='two'\nC=\"x y\"\nD=new\n"


def test_set_rejects_newlines_and_bad_keys():
    env = EnvFile.parse("")
    with pytest.raises(ValueError):
        env.set_many({"A": "x\ny"})
    with pytest.raises(ValueError):
        env.set_many({"bad-key": "x"})


def test_write_atomic_mode_600(tmp_path):
    path = tmp_path / ".env"
    write_env_atomic(path, EnvFile.parse("A=1\n"))
    assert path.read_text() == "A=1\n"
    assert path.stat().st_mode & 0o777 == 0o600
    assert read_env(tmp_path / "missing").keys() == []
