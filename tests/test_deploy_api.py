"""An unexpected profile must never cause writes to a work AWS account."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest


def test_account_mismatch_stops_before_resource_changes(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / "scripts/deploy-api.py"
    spec = importlib.util.spec_from_file_location("deploy_api", script)
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    (tmp_path / ".tmp").mkdir()
    (tmp_path / ".tmp/analysis-api.zip").write_bytes(b"local-test-artifact")
    monkeypatch.setattr(deploy, "ROOT", tmp_path)
    monkeypatch.setattr(sys, "argv", [str(script), "--profile", "personal-test", "--personal-account-id", "111111111111"])
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "inherited-test-key")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "inherited-test-secret")
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        assert command[1:3] == ["--profile", "personal-test"]
        assert "AWS_ACCESS_KEY_ID" not in kwargs["env"]
        assert "AWS_SECRET_ACCESS_KEY" not in kwargs["env"]
        assert "sts" in command and "get-caller-identity" in command
        return SimpleNamespace(stdout=json.dumps({"Account": "999999999999"}))

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(SystemExit, match="Account mismatch"):
        deploy.main()
    assert len(calls) == 1
