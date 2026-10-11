from vpscp_agent import metrics


def test_collect_host_reports_sane_values(tmp_path):
    sample = metrics.collect_host([str(tmp_path)], cpu_interval=0.1)

    assert 0 <= sample.cpu_percent <= 100
    assert sample.cpu_count >= 1
    assert sample.load1 >= 0
    assert sample.mem_total > 0
    assert 0 < sample.mem_available <= sample.mem_total
    assert sample.mem_used == sample.mem_total - sample.mem_available
    assert 0 <= sample.mem_percent <= 100
    assert sample.swap_used <= sample.swap_total or sample.swap_total == 0
    assert sample.uptime_seconds > 0
    [disk] = sample.disks
    assert disk.path == str(tmp_path)
    assert disk.total > 0
    assert disk.free <= disk.total
    assert sample.ts.endswith("+00:00")


def test_collect_host_skips_unusable_disk_paths(tmp_path):
    sample = metrics.collect_host([str(tmp_path), "/nonexistent-vpscp-disk-path"], cpu_interval=0.1)

    assert [disk.path for disk in sample.disks] == [str(tmp_path)]


def test_metrics_current_endpoint(client, settings):
    response = client.get("/v1/metrics/current")

    assert response.status_code == 200
    body = response.json()
    assert body["mem_total"] > 0
    assert [d["path"] for d in body["disks"]] == list(settings.disk_paths)
