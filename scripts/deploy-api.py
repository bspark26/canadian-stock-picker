"""Deploy only to an explicitly identified personal AWS account."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--personal-account-id", required=True, help="Expected 12-digit account ID, verified before any writes")
    parser.add_argument("--region", default="ca-central-1")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]{12}", args.personal_account_id):
        parser.error("Personal account ID must contain 12 digits")
    package = ROOT / ".tmp/analysis-api.zip"
    if not package.is_file():
        parser.error("Run scripts/package-api.py first")
    # Prevent inherited access-key/session variables from selecting a different account.
    environment = {k: v for k, v in os.environ.items() if k not in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_PROFILE", "AWS_DEFAULT_PROFILE")}
    command = ["aws", "--profile", args.profile, "--region", args.region, "--no-cli-pager"]

    def aws(*parts, capture=False):
        result = subprocess.run([*command, *parts], env=environment, check=True, text=True, stdout=subprocess.PIPE if capture else None)
        return result.stdout if capture else None

    identity = json.loads(aws("sts", "get-caller-identity", capture=True))
    if identity["Account"] != args.personal_account_id:
        raise SystemExit("Account mismatch. No resources were changed.")
    print(f"Verified expected personal account {identity['Account']}; region {args.region}", flush=True)
    limits = json.loads(aws("lambda", "get-account-settings", capture=True))
    unreserved = limits.get("AccountLimit", {}).get("UnreservedConcurrentExecutions", 0)
    # New AWS accounts can have a lower regional quota than the 100 executions
    # AWS requires to remain unreserved. The daily DynamoDB allowance still applies.
    reserve = "true" if unreserved >= 102 else "false"
    if reserve == "false":
        print("Regional concurrency quota is too low to reserve two executions; using the account quota and atomic daily allowance.", flush=True)
    aws("cloudformation", "deploy", "--stack-name", "maple-signal-artifacts", "--template-file", str(ROOT / "infra/artifacts.json"), "--no-fail-on-empty-changeset", "--tags", "Project=MapleSignal", "Ownership=Personal")
    bucket = aws("cloudformation", "describe-stacks", "--stack-name", "maple-signal-artifacts", "--query", "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue | [0]", "--output", "text", capture=True).strip()
    release = hashlib.sha256(package.read_bytes()).hexdigest()
    key = f"builds/{release}.zip"
    aws("s3", "cp", str(package), f"s3://{bucket}/{key}", "--only-show-errors")
    aws("cloudformation", "deploy", "--stack-name", "maple-signal-analysis", "--template-file", str(ROOT / "infra/analysis-api.json"), "--capabilities", "CAPABILITY_IAM", "--parameter-overrides", f"CodeBucket={bucket}", f"CodeKey={key}", f"Release={release[:16]}", f"ReserveConcurrency={reserve}", "--no-fail-on-empty-changeset", "--tags", "Project=MapleSignal", "Ownership=Personal")
    endpoint = aws("cloudformation", "describe-stacks", "--stack-name", "maple-signal-analysis", "--query", "Stacks[0].Outputs[?OutputKey=='AnalysisApiUrl'].OutputValue | [0]", "--output", "text", capture=True).strip()
    print(f"Analysis endpoint: {endpoint}")
    print("After live verification, save this as the GitHub repository variable ANALYSIS_API_URL and rebuild Pages.")


if __name__ == "__main__":
    main()
