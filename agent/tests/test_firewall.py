import ipaddress

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.commands import CommandError, CommandResult
from vpscp_agent.db_ops import ConflictError
from vpscp_agent.firewall import (
    add_rule,
    cloudflare_only,
    delete_rule,
    exposure_report,
    list_rules,
)
from vpscp_agent.main import create_app
from vpscp_agent.state import StateDB

UFW_STATUS_BASE = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
[ 2] 80/tcp                     ALLOW IN    Anywhere                   # http
[ 3] 443/tcp                    ALLOW IN    Anywhere                   # https
[ 4] 10000/tcp                  ALLOW IN    203.0.113.10               # app
[ 5] 22/tcp (v6)                ALLOW IN    Anywhere (v6)              # ssh
[ 6] 80/tcp (v6)                ALLOW IN    Anywhere (v6)              # http
[ 7] 443/tcp (v6)               ALLOW IN    Anywhere (v6)              # https
[ 8] 9000/tcp                   DENY IN     Anywhere                   # deny9000
[ 9] 10001/tcp                  ALLOW IN    Anywhere                   # extra
"""

UFW_CF_ONLY = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
[ 2] 80/tcp                     ALLOW IN    173.245.48.0/20            # cf
[ 3] 443/tcp                    ALLOW IN    173.245.48.0/20            # cf
[ 4] 80/tcp                     ALLOW IN    2400:cb00::/32             # cf
[ 5] 443/tcp                    ALLOW IN    2400:cb00::/32             # cf
[ 6] 22/tcp (v6)                ALLOW IN    Anywhere (v6)              # ssh
"""

SS_TCP = (
    '0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=100,fd=3))\n'
    '0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=200,fd=4))\n'
    '0 128 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=300,fd=5))\n'
    '0 128 0.0.0.0:9000 0.0.0.0:* users:(("node",pid=400,fd=6))\n'
    '0 128 0.0.0.0:10001 0.0.0.0:* users:(("app",pid=401,fd=8))\n'
    '0 128 [::]:443 [::]:* users:(("nginx",pid=201,fd=7))\n'
)

SS_UDP = 'UNCONN 0 0 0.0.0.0:123 0.0.0.0:* users:(("systemd-timesync",pid=50,fd=3))\n'

CF_V4 = "173.245.48.0/20\n104.16.0.0/13"
CF_V6 = "2400:cb00::/32"


class UfwFakeRunner(FakeRunner):
    def __init__(self, status: str) -> None:
        super().__init__()
        self.ufw_status = status

    def _remove_rule(self, number: int) -> None:
        lines = []
        for line in self.ufw_status.splitlines():
            stripped = line.strip()
            if stripped.startswith((f"[ {number}]", f"[{number}]")):
                continue
            lines.append(line)
        self.ufw_status = "\n".join(lines) + ("\n" if lines else "")

    def __call__(self, args, **kwargs):
        if args[:3] == ["ufw", "status", "numbered"]:
            self.calls.append({"args": args, **{k: kwargs.get(k) for k in kwargs}})
            result = CommandResult(0, self.ufw_status, "")
            if kwargs.get("check", True) and result.returncode != 0:
                raise CommandError(result)
            return result
        if args[:3] == ["ufw", "--force", "delete"]:
            self._remove_rule(int(args[3]))
            result = CommandResult(0, "", "")
            self.calls.append({"args": args, **{k: kwargs.get(k) for k in kwargs}})
            if kwargs.get("check", True) and result.returncode != 0:
                raise CommandError(result)
            return result
        return super().__call__(args, **kwargs)


def _seed_cf_ips(db: StateDB) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("cloudflare_ips_v4", CF_V4),
        )
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("cloudflare_ips_v6", CF_V6),
        )


@pytest.fixture
def fw_client(settings):
    runner = UfwFakeRunner("")
    db = StateDB(settings.state_db_path)
    db.migrate()
    with TestClient(create_app(settings, runner=runner)) as client:
        yield client, runner, db, settings


def test_list_rules_parses_v4_v6_comments_and_deny():
    runner = UfwFakeRunner(UFW_STATUS_BASE)

    rules = list_rules(runner)

    assert len(rules) == 9
    assert rules[0] == {
        "number": 1,
        "to": "22/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "Anywhere",
        "v6": False,
        "comment": "ssh",
    }
    assert rules[4]["v6"] is True
    assert rules[4]["from"] == "Anywhere"
    assert rules[7]["action"] == "DENY IN"
    assert rules[7]["comment"] == "deny9000"
    assert rules[8]["comment"] == "extra"


def test_add_rule_builds_ufw_argv():
    runner = UfwFakeRunner(UFW_STATUS_BASE)

    add_rule(runner, port=10001, proto="tcp", action="allow", source="203.0.113.55", comment="x")

    assert runner.calls[-1]["args"] == [
        "ufw",
        "allow",
        "proto",
        "tcp",
        "from",
        "203.0.113.55",
        "to",
        "any",
        "port",
        "10001",
        "comment",
        "x",
    ]


def test_add_rule_any_source():
    runner = FakeRunner()
    add_rule(runner, port=10002, proto="udp", action="deny", source="any", comment="")
    assert runner.calls[-1]["args"][4:6] == ["from", "any"]


def test_add_rule_port_range():
    runner = FakeRunner()
    add_rule(runner, port="10010:10020", proto="tcp", action="allow", source="any", comment="r")
    assert "10010:10020" in runner.calls[-1]["args"]


def test_add_rule_rejects_bad_comment():
    runner = FakeRunner()
    with pytest.raises(ValueError, match="comment"):
        add_rule(runner, port=10003, proto="tcp", action="allow", source="any", comment="bad!")


def test_delete_rule_invokes_ufw_delete_after_relist(settings):
    runner = UfwFakeRunner(UFW_STATUS_BASE)
    db = StateDB(settings.state_db_path)
    db.migrate()

    expected = {
        "to": "10000/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "203.0.113.10",
        "v6": False,
        "comment": "app",
    }
    delete_rule(runner, db=db, number=4, client_ip="203.0.113.99", expected=expected)

    delete_calls = [c for c in runner.calls if c["args"][:3] == ["ufw", "--force", "delete"]]
    assert delete_calls[-1]["args"] == ["ufw", "--force", "delete", "4"]


def test_delete_rule_refuses_stale_number(settings):
    runner = UfwFakeRunner(UFW_STATUS_BASE)
    db = StateDB(settings.state_db_path)
    db.migrate()

    expected = {
        "to": "10000/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "203.0.113.10",
        "v6": False,
        "comment": "app",
    }
    with pytest.raises(ConflictError, match="does not match"):
        delete_rule(
            runner,
            db=db,
            number=4,
            client_ip="203.0.113.99",
            expected={**expected, "comment": "wrong"},
        )


@pytest.mark.parametrize(
    ("cf_only", "rule_number", "expected", "detail"),
    [
        (
            False,
            2,
            {
                "to": "80/tcp",
                "proto": "tcp",
                "action": "ALLOW IN",
                "from": "Anywhere",
                "v6": False,
                "comment": "http",
            },
            "80/tcp",
        ),
        (
            False,
            3,
            {
                "to": "443/tcp",
                "proto": "tcp",
                "action": "ALLOW IN",
                "from": "Anywhere",
                "v6": False,
                "comment": "https",
            },
            "443/tcp",
        ),
        (
            True,
            2,
            {
                "to": "80/tcp",
                "proto": "tcp",
                "action": "ALLOW IN",
                "from": "173.245.48.0/20",
                "v6": False,
                "comment": "cf",
            },
            "cf",
        ),
    ],
)
def test_delete_guardrails_http_https_and_cf(settings, cf_only, rule_number, expected, detail):
    status = UFW_CF_ONLY if cf_only else UFW_STATUS_BASE
    runner = UfwFakeRunner(status)
    db = StateDB(settings.state_db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("firewall_cloudflare_only", "true" if cf_only else "false"),
        )

    with pytest.raises(ConflictError) as exc:
        delete_rule(
            runner,
            db=db,
            number=rule_number,
            client_ip="203.0.113.99",
            expected=expected,
        )
    assert detail in str(exc.value)


def test_delete_ssh_blocked_when_last_covering_rule(settings):
    ssh_only = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    203.0.113.50               # ssh-one
[ 2] 80/tcp                     ALLOW IN    Anywhere                   # http
"""
    runner = UfwFakeRunner(ssh_only)
    db = StateDB(settings.state_db_path)
    db.migrate()

    expected = {
        "to": "22/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "203.0.113.50",
        "v6": False,
        "comment": "ssh-one",
    }
    with pytest.raises(ConflictError, match="22/tcp"):
        delete_rule(runner, db=db, number=1, client_ip="203.0.113.50", expected=expected)


def test_delete_ssh_allowed_when_other_rule_covers_client(settings):
    ssh_two = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    203.0.113.50               # ssh-one
[ 2] 22/tcp                     ALLOW IN    Anywhere                   # ssh-any
"""
    runner = UfwFakeRunner(ssh_two)
    db = StateDB(settings.state_db_path)
    db.migrate()

    expected = {
        "to": "22/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "203.0.113.50",
        "v6": False,
        "comment": "ssh-one",
    }
    delete_rule(runner, db=db, number=1, client_ip="203.0.113.50", expected=expected)
    assert ["ufw", "--force", "delete", "1"] in [c["args"] for c in runner.calls]


def test_delete_web_range_blocked_when_cf_off(settings):
    web_range = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 70:90/tcp                  ALLOW IN    Anywhere                   # wide
"""
    runner = UfwFakeRunner(web_range)
    db = StateDB(settings.state_db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("firewall_cloudflare_only", "false"),
        )

    expected = {
        "to": "70:90/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "Anywhere",
        "v6": False,
        "comment": "wide",
    }
    with pytest.raises(ConflictError, match="70:90/tcp"):
        delete_rule(
            runner,
            db=db,
            number=1,
            client_ip="203.0.113.50",
            expected=expected,
        )


def test_delete_ssh_allowed_when_range_covers_client(settings):
    ssh_range = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    203.0.113.50               # ssh-one
[ 2] 20:30/tcp                  ALLOW IN    203.0.113.50               # ssh-range
"""
    runner = UfwFakeRunner(ssh_range)
    db = StateDB(settings.state_db_path)
    db.migrate()

    expected = {
        "to": "22/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "203.0.113.50",
        "v6": False,
        "comment": "ssh-one",
    }
    delete_rule(runner, db=db, number=1, client_ip="203.0.113.50", expected=expected)
    assert ["ufw", "--force", "delete", "1"] in [c["args"] for c in runner.calls]


def test_cloudflare_only_on_adds_cf_rules_then_removes_generic(settings):
    runner = UfwFakeRunner(UFW_STATUS_BASE)
    db = StateDB(settings.state_db_path)
    db.migrate()
    _seed_cf_ips(db)

    cloudflare_only(runner, db, on=True)

    add_cmds = [c["args"] for c in runner.calls if c["args"][:2] == ["ufw", "allow"]]
    assert any("173.245.48.0/20" in args and "80" in args and args[-1] == "cf" for args in add_cmds)
    delete_cmds = [c["args"] for c in runner.calls if c["args"][:3] == ["ufw", "--force", "delete"]]
    assert delete_cmds


def test_cloudflare_only_off_restores_generic_then_drops_cf(settings):
    runner = UfwFakeRunner(UFW_CF_ONLY)
    db = StateDB(settings.state_db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("firewall_cloudflare_only", "true"),
        )

    cloudflare_only(runner, db, on=False)

    allow_cmds = [c["args"] for c in runner.calls if c["args"][:2] == ["ufw", "allow"]]
    assert any(
        args[4:6] == ["from", "any"] and "80" in args and args[-1] == "http" for args in allow_cmds
    )
    delete_cf = [
        c["args"]
        for c in runner.calls
        if c["args"][:3] == ["ufw", "--force", "delete"] and "# cf" not in str(c)
    ]
    assert delete_cf


def test_exposure_report_marks_external_and_unexpected(settings):
    runner = UfwFakeRunner(UFW_STATUS_BASE)
    db = StateDB(settings.state_db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("public_ipv4", "198.51.100.9"),
        )

    runner.on(lambda args: args[:4] == ["ss", "-H", "-tlnp"], stdout=SS_TCP)
    runner.on(lambda args: args[:4] == ["ss", "-H", "-ulnp"], stdout=SS_UDP)

    report = exposure_report(runner, db)

    by_port = {(row["address"], row["port"]): row for row in report}
    assert by_port[("0.0.0.0", 22)]["external"] is True
    assert by_port[("0.0.0.0", 22)]["expected"] is True
    assert by_port[("0.0.0.0", 9000)]["external"] is False
    assert by_port[("0.0.0.0", 10001)]["external"] is True
    assert by_port[("0.0.0.0", 10001)]["expected"] is False
    assert ("127.0.0.1", 5432) not in {(r["address"], r["port"]) for r in report if r["external"]}


def test_get_rules_route(fw_client):
    client, runner, _db, _settings = fw_client
    runner.ufw_status = UFW_STATUS_BASE

    resp = client.get("/v1/firewall/rules")
    assert resp.status_code == 200
    assert resp.json()[0]["comment"] == "ssh"


def test_post_rule_route_audited(fw_client):
    client, runner, db, _settings = fw_client
    runner.ufw_status = UFW_STATUS_BASE

    resp = client.post(
        "/v1/firewall/rules",
        json={
            "port": 10005,
            "proto": "tcp",
            "action": "allow",
            "source": "any",
            "comment": "web",
        },
    )
    assert resp.status_code == 200
    events = audit.list_events(db, limit=5)
    assert events[0].operation == "fw.add"


def test_delete_rule_route_409_guardrail(fw_client):
    client, runner, db, _settings = fw_client
    runner.ufw_status = UFW_STATUS_BASE
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("firewall_cloudflare_only", "false"),
        )

    resp = client.request(
        "DELETE",
        "/v1/firewall/rules/2?client_ip=203.0.113.1",
        json={
            "to": "80/tcp",
            "proto": "tcp",
            "action": "ALLOW IN",
            "from": "Anywhere",
            "v6": False,
            "comment": "http",
        },
    )
    assert resp.status_code == 409


def test_cloudflare_only_route(fw_client):
    client, runner, db, _settings = fw_client
    runner.ufw_status = UFW_STATUS_BASE
    _seed_cf_ips(db)

    resp = client.post("/v1/firewall/cloudflare-only", json={"on": True})
    assert resp.status_code == 200
    assert audit.list_events(db, limit=1)[0].operation == "fw.cloudflare_only"


def test_exposure_route(fw_client):
    client, runner, _db, _settings = fw_client
    runner.ufw_status = UFW_STATUS_BASE
    runner.on(lambda args: args[:4] == ["ss", "-H", "-tlnp"], stdout=SS_TCP)
    runner.on(lambda args: args[:4] == ["ss", "-H", "-ulnp"], stdout="")

    resp = client.get("/v1/firewall/exposure")
    assert resp.status_code == 200
    assert any(not row["expected"] for row in resp.json())


def test_validation_error_returns_400(fw_client):
    client, _runner, _db, _settings = fw_client
    resp = client.post(
        "/v1/firewall/rules",
        json={
            "port": 5432,
            "proto": "tcp",
            "action": "allow",
            "source": "any",
            "comment": "bad",
        },
    )
    assert resp.status_code == 400


@pytest.mark.parametrize(
    "port",
    ["5430:5440", "7979:8081", "1:65535", "5432:5432", "8080:9000", "20:25"],
)
def test_port_ranges_spanning_reserved_ports_rejected(fw_client, port):
    """A range whose span covers 5432/8080 or privileged ports must be
    rejected even when the endpoints are fine: '5430:5440' would expose the
    central Postgres, '20:25' silently opens SSH-adjacent privileged ports."""
    client, _runner, _db, _settings = fw_client
    resp = client.post(
        "/v1/firewall/rules",
        json={
            "port": port,
            "proto": "tcp",
            "action": "allow",
            "source": "any",
            "comment": "bad",
        },
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.parametrize("port", ["20000:20100", "10000:19999"])
def test_port_ranges_without_reserved_ports_accepted(fw_client, port):
    client, runner, _db, _settings = fw_client
    runner.ufw_status = UFW_STATUS_BASE
    resp = client.post(
        "/v1/firewall/rules",
        json={
            "port": port,
            "proto": "tcp",
            "action": "allow",
            "source": "203.0.113.0/24",
            "comment": "ok",
        },
    )
    assert resp.status_code in (200, 201), resp.text


def test_ssh_cidr_covers_client():
    net = ipaddress.ip_network("203.0.113.0/24")
    assert ipaddress.ip_address("203.0.113.50") in net


UFW_CIDR_HTTPS = """Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
[ 2] 443/tcp                    ALLOW IN    203.0.113.0/24             # partner
[ 3] 10000/tcp                  ALLOW IN    Anywhere                   # app
"""


def test_delete_ssh_allow_requires_client_ip(settings):
    runner = UfwFakeRunner(
        """Status: active
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
"""
    )
    db = StateDB(settings.state_db_path)
    db.migrate()
    expected = {
        "to": "22/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "Anywhere",
        "v6": False,
        "comment": "ssh",
    }
    with pytest.raises(ValueError, match="client_ip is required"):
        delete_rule(runner, db=db, number=1, client_ip=None, expected=expected)


def test_delete_ssh_allow_rejects_invalid_client_ip(settings):
    runner = UfwFakeRunner(
        """Status: active
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
"""
    )
    db = StateDB(settings.state_db_path)
    db.migrate()
    expected = {
        "to": "22/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "Anywhere",
        "v6": False,
        "comment": "ssh",
    }
    with pytest.raises(ValueError, match="invalid client_ip"):
        delete_rule(runner, db=db, number=1, client_ip="not-an-ip", expected=expected)


def test_delete_cidr_https_blocked_while_cf_only_off(settings):
    runner = UfwFakeRunner(UFW_CIDR_HTTPS)
    db = StateDB(settings.state_db_path)
    db.migrate()
    expected = {
        "to": "443/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "203.0.113.0/24",
        "v6": False,
        "comment": "partner",
    }
    with pytest.raises(ConflictError, match="443/tcp"):
        delete_rule(runner, db=db, number=2, client_ip="203.0.113.1", expected=expected)


def test_delete_non_web_rule_without_client_ip(settings):
    runner = UfwFakeRunner(UFW_CIDR_HTTPS)
    db = StateDB(settings.state_db_path)
    db.migrate()
    expected = {
        "to": "10000/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "Anywhere",
        "v6": False,
        "comment": "app",
    }
    delete_rule(runner, db=db, number=3, client_ip=None, expected=expected)
    assert ["ufw", "--force", "delete", "3"] in [c["args"] for c in runner.calls]


def test_delete_ssh_route_missing_client_ip_400(fw_client):
    client, runner, _db, _settings = fw_client
    runner.ufw_status = """Status: active
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
"""
    resp = client.request(
        "DELETE",
        "/v1/firewall/rules/1",
        json={
            "to": "22/tcp",
            "proto": "tcp",
            "action": "ALLOW IN",
            "from": "Anywhere",
            "v6": False,
            "comment": "ssh",
        },
    )
    assert resp.status_code == 400


def test_delete_route_invalid_client_ip_400(fw_client):
    client, runner, _db, _settings = fw_client
    runner.ufw_status = """Status: active
[ 1] 22/tcp                     ALLOW IN    Anywhere                   # ssh
[ 2] 22/tcp                     ALLOW IN    203.0.113.0/24             # backup
"""
    resp = client.request(
        "DELETE",
        "/v1/firewall/rules/2?client_ip=not-an-ip",
        json={
            "to": "22/tcp",
            "proto": "tcp",
            "action": "ALLOW IN",
            "from": "203.0.113.0/24",
            "v6": False,
            "comment": "backup",
        },
    )
    assert resp.status_code == 400


def test_delete_cf_comment_https_blocked_while_cf_only_off(settings):
    status = """Status: active
[ 1] 443/tcp                    ALLOW IN    173.245.48.0/20            # cf
"""
    runner = UfwFakeRunner(status)
    db = StateDB(settings.state_db_path)
    db.migrate()
    expected = {
        "to": "443/tcp",
        "proto": "tcp",
        "action": "ALLOW IN",
        "from": "173.245.48.0/20",
        "v6": False,
        "comment": "cf",
    }
    with pytest.raises(ConflictError, match="443/tcp"):
        delete_rule(runner, db=db, number=1, client_ip="203.0.113.1", expected=expected)


def test_cloudflare_only_off_still_deletes_cf_rules_internally(settings):
    runner = UfwFakeRunner(UFW_CF_ONLY)
    db = StateDB(settings.state_db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("firewall_cloudflare_only", "true"),
        )
    cloudflare_only(runner, db, on=False)
    assert any(c["args"][:3] == ["ufw", "--force", "delete"] for c in runner.calls)


def test_exposure_not_external_with_cidr_only_allow(settings):
    status = """Status: active
[ 1] 9000/tcp                   ALLOW IN    10.0.0.0/8                 # internal
"""
    runner = UfwFakeRunner(status)
    db = StateDB(settings.state_db_path)
    db.migrate()
    ss = '0 128 0.0.0.0:9000 0.0.0.0:* users:(("node",pid=1,fd=3))\n'
    runner.on(lambda args: args[:4] == ["ss", "-H", "-tlnp"], stdout=ss)
    runner.on(lambda args: args[:4] == ["ss", "-H", "-ulnp"], stdout="")
    report = exposure_report(runner, db)
    row = next(r for r in report if r["port"] == 9000)
    assert row["external"] is False


def test_exposure_deny_before_allow_blocks(settings):
    status = """Status: active
[ 1] 9000/tcp                   DENY IN     Anywhere                   # deny
[ 2] 9000/tcp                   ALLOW IN    Anywhere                   # allow
"""
    runner = UfwFakeRunner(status)
    db = StateDB(settings.state_db_path)
    db.migrate()
    ss = '0 128 0.0.0.0:9000 0.0.0.0:* users:(("node",pid=1,fd=3))\n'
    runner.on(lambda args: args[:4] == ["ss", "-H", "-tlnp"], stdout=ss)
    runner.on(lambda args: args[:4] == ["ss", "-H", "-ulnp"], stdout="")
    report = exposure_report(runner, db)
    row = next(r for r in report if r["port"] == 9000)
    assert row["external"] is False


def test_exposure_cloudflare_cidr_allow_is_expected(settings):
    status = """Status: active
[ 1] 80/tcp                     ALLOW IN    173.245.48.0/20            # cf
"""
    runner = UfwFakeRunner(status)
    db = StateDB(settings.state_db_path)
    db.migrate()
    ss = '0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1,fd=3))\n'
    runner.on(lambda args: args[:4] == ["ss", "-H", "-tlnp"], stdout=ss)
    runner.on(lambda args: args[:4] == ["ss", "-H", "-ulnp"], stdout="")
    report = exposure_report(runner, db)
    row = next(r for r in report if r["port"] == 80)
    assert row["external"] is True
    assert row["expected"] is True


def test_exposure_allow_before_deny_is_external(settings):
    status = """Status: active
[ 1] 9000/tcp                   ALLOW IN    Anywhere                   # allow
[ 2] 9000/tcp                   DENY IN     Anywhere                   # deny
"""
    runner = UfwFakeRunner(status)
    db = StateDB(settings.state_db_path)
    db.migrate()
    ss = '0 128 0.0.0.0:9000 0.0.0.0:* users:(("node",pid=1,fd=3))\n'
    runner.on(lambda args: args[:4] == ["ss", "-H", "-tlnp"], stdout=ss)
    runner.on(lambda args: args[:4] == ["ss", "-H", "-ulnp"], stdout="")
    report = exposure_report(runner, db)
    row = next(r for r in report if r["port"] == 9000)
    assert row["external"] is True
    assert row["expected"] is False


def test_delete_cidr_https_route_409(fw_client):
    client, runner, db, _settings = fw_client
    runner.ufw_status = UFW_CIDR_HTTPS
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("firewall_cloudflare_only", "false"),
        )
    resp = client.request(
        "DELETE",
        "/v1/firewall/rules/2?client_ip=203.0.113.1",
        json={
            "to": "443/tcp",
            "proto": "tcp",
            "action": "ALLOW IN",
            "from": "203.0.113.0/24",
            "v6": False,
            "comment": "partner",
        },
    )
    assert resp.status_code == 409
