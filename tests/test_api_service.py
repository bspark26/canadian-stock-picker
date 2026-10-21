from unittest.mock import Mock

import pytest

from api.service import RequestError, analyze
from api.storage import LimitReached


@pytest.fixture
def dependencies(monkeypatch):
    from scanner import analysis, yahoo
    monkeypatch.delenv("CACHE_TABLE", raising=False)
    store = Mock()
    store.get.return_value = None
    store.claim.return_value = True
    result = {"symbol": "LSPD.TO", "schemaVersion": 1}
    generate = Mock(return_value=result)
    source = Mock()
    monkeypatch.setattr(analysis, "analyze_symbol", generate)
    monkeypatch.setattr(yahoo, "YahooSource", source)
    return store, result, generate, source


def test_missing_production_controls_fail_before_provider_access(dependencies):
    _, _, generate, source = dependencies
    with pytest.raises(RequestError) as error:
        analyze("LSPD.TO")
    assert error.value.code == "not_configured"
    source.assert_not_called()
    generate.assert_not_called()


def test_cached_report_does_not_reserve_or_fetch(dependencies):
    store, result, generate, source = dependencies
    store.get.return_value = result
    assert analyze(" lspd.to ", store) == result
    store.claim.assert_not_called()
    store.reserve_download.assert_not_called()
    generate.assert_not_called()
    source.assert_not_called()


def test_new_report_reserves_before_downloading_and_saves_only_success(dependencies):
    store, result, generate, source = dependencies
    events = []
    store.reserve_download.side_effect = lambda _: events.append("reserve")
    source.side_effect = lambda *args, **kwargs: events.append("source") or source.return_value
    generate.side_effect = lambda *args, **kwargs: events.append("generate") or result
    assert analyze("LSPD.TO", store) == result
    store.reserve_download.assert_called_once_with(30)
    assert events == ["reserve", "source", "generate"]
    generate.assert_called_once()
    assert generate.call_args.kwargs["source"] == source.return_value
    store.put.assert_called_once()
    store.release_claim.assert_called_once_with("LSPD.TO")


def test_daily_limit_and_in_progress_do_not_fetch(dependencies):
    store, _, generate, source = dependencies
    store.reserve_download.side_effect = LimitReached()
    with pytest.raises(RequestError) as error:
        analyze("LSPD.TO", store)
    assert error.value.status == 429
    generate.assert_not_called()
    source.assert_not_called()
    store.release_claim.assert_called_once()
    store.reset_mock()
    store.claim.return_value = False
    with pytest.raises(RequestError) as error:
        analyze("LSPD.TO", store)
    assert error.value.status == 409
    store.reserve_download.assert_not_called()
    generate.assert_not_called()


def test_infrastructure_or_analysis_failure_does_not_serve_fake_report(dependencies):
    store, _, generate, source = dependencies
    store.reserve_download.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError):
        analyze("LSPD.TO", store)
    generate.assert_not_called()
    source.assert_not_called()
    store.put.assert_not_called()
    store.release_claim.assert_called_once()
    store.reset_mock()
    store.reserve_download.side_effect = None
    generate.side_effect = RuntimeError("provider unavailable")
    with pytest.raises(RuntimeError):
        analyze("LSPD.TO", store)
    store.put.assert_not_called()
    store.release_claim.assert_called_once()
