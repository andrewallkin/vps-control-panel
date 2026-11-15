from vpscp_panel.project_runtime import classify_compose_ps


def test_classify_compose_ps_non_dict_service_row_is_unhealthy():
    ps = {
        "services": [
            {"state": "running", "health": "healthy"},
            "bad",
        ]
    }
    assert classify_compose_ps(ps) == "unhealthy"


def test_classify_compose_ps_empty_services_is_empty_not_unhealthy():
    assert classify_compose_ps({"services": []}) == "empty"


def test_classify_compose_ps_invalid_ps_is_unhealthy():
    assert classify_compose_ps(None) == "unhealthy"
    assert classify_compose_ps([]) == "unhealthy"
    assert classify_compose_ps({"services": "nope"}) == "unhealthy"


def test_classify_compose_ps_all_running_healthy_is_up():
    ps = {
        "services": [
            {"state": "running", "health": "healthy"},
            {"state": "running", "health": None},
        ]
    }
    assert classify_compose_ps(ps) == "up"
