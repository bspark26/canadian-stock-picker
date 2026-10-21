"""Small DynamoDB JSON cache with an atomic daily download allowance."""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone


class LimitReached(RuntimeError):
    pass


def conditional_failure(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


class DynamoCache:
    def __init__(self, table, client=None, clock=time.time, release="v1"):
        if client is None:
            import boto3
            client = boto3.client("dynamodb")
        self.client, self.table, self.clock, self.release = client, table, clock, release

    def key(self, category, key):
        digest = hashlib.sha256(key.encode()).hexdigest()
        return f"{self.release}:{category}:{digest}"

    def get(self, category, key, hours):
        response = self.client.get_item(TableName=self.table, Key={"pk": {"S": self.key(category, key)}}, ConsistentRead=True)
        item = response.get("Item", {})
        if not item or self.clock() - float(item["created"]["N"]) >= hours * 3600:
            return None
        return json.loads(item["payload"]["S"])

    def put(self, category, key, value):
        payload = json.dumps(value, allow_nan=False, separators=(",", ":"))
        if len(payload.encode()) > 350_000:
            raise ValueError("Cache item is too large")
        now = int(self.clock())
        self.client.put_item(TableName=self.table, Item={
            "pk": {"S": self.key(category, key)}, "created": {"N": str(now)},
            "expires": {"N": str(now + 8 * 86400)}, "payload": {"S": payload},
        })

    def reserve_download(self, limit):
        """Count before network access; unsuccessful downloads also use an allowance."""
        now = int(self.clock())
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        try:
            self.client.update_item(
                TableName=self.table, Key={"pk": {"S": f"budget:{day}"}},
                UpdateExpression="SET expires = :expires ADD attempts :one",
                ConditionExpression="attribute_not_exists(attempts) OR attempts < :limit",
                ExpressionAttributeValues={":expires": {"N": str(now + 2 * 86400)}, ":one": {"N": "1"}, ":limit": {"N": str(limit)}},
            )
        except Exception as error:
            if conditional_failure(error):
                raise LimitReached("Daily analysis allowance reached") from None
            raise

    def claim(self, symbol, seconds=150):
        now = int(self.clock())
        try:
            self.client.put_item(
                TableName=self.table,
                Item={"pk": {"S": self.key("lock", symbol)}, "expires": {"N": str(now + seconds)}},
                ConditionExpression="attribute_not_exists(pk) OR expires < :now",
                ExpressionAttributeValues={":now": {"N": str(now)}},
            )
            return True
        except Exception as error:
            if conditional_failure(error):
                return False
            raise

    def release_claim(self, symbol):
        self.client.delete_item(TableName=self.table, Key={"pk": {"S": self.key("lock", symbol)}})
