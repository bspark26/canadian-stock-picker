"""The public endpoint cannot start unlimited provider downloads."""
import json
from unittest.mock import Mock

import pytest

from api.storage import DynamoCache, LimitReached


class ConditionalError(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


def test_cache_expiry_is_checked_without_waiting_for_dynamodb_ttl():
    client = Mock()
    client.get_item.return_value = {"Item": {"created": {"N": "1000"}, "payload": {"S": '{"price": 12}'}}}
    cache = DynamoCache("test", client, clock=lambda: 4600)
    assert cache.get("analysis", "LSPD.TO", 1) is None
    cache.clock = lambda: 4599
    assert cache.get("analysis", "LSPD.TO", 1) == {"price": 12}


def test_cache_writes_finite_json_with_expiry_and_release_namespace():
    client = Mock()
    cache = DynamoCache("test", client, clock=lambda: 1000, release="code-v2")
    cache.put("history", "LSPD.TO", {"close": 20})
    item = client.put_item.call_args.kwargs["Item"]
    assert item["pk"]["S"].startswith("code-v2:history:")
    assert json.loads(item["payload"]["S"]) == {"close": 20}
    assert int(item["expires"]["N"]) > 1000
    with pytest.raises(ValueError):
        cache.put("history", "LSPD.TO", {"close": float("nan")})


def test_daily_allowance_is_atomic_counts_failures_and_fails_closed():
    client = Mock()
    cache = DynamoCache("test", client, clock=lambda: 1792627200)
    cache.reserve_download(30)
    request = client.update_item.call_args.kwargs
    assert request["ConditionExpression"] == "attribute_not_exists(attempts) OR attempts < :limit"
    assert request["ExpressionAttributeValues"][":limit"] == {"N": "30"}
    client.update_item.side_effect = ConditionalError()
    with pytest.raises(LimitReached):
        cache.reserve_download(30)
    client.update_item.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="database unavailable"):
        cache.reserve_download(30)


def test_same_symbol_lock_does_not_hide_infrastructure_failure():
    client = Mock()
    cache = DynamoCache("test", client, clock=lambda: 1000)
    assert cache.claim("LSPD.TO") is True
    client.put_item.side_effect = ConditionalError()
    assert cache.claim("LSPD.TO") is False
    client.put_item.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError):
        cache.claim("LSPD.TO")
