"""Development only: python -m api.local [--port 8787]. Binds loopback."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from . import handler


def local_analyze(symbol):
    from scanner.analysis import AnalysisError, analyze_symbol
    from scanner.run import settings_from
    try:
        return analyze_symbol(symbol, settings_from(None))
    except AnalysisError as error:
        raise handler._ApprovedError(error.status, error.code, str(error)) from None


class LocalHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlsplit(self.path)
        result = handler.lambda_handler({"rawPath": parsed.path, "rawQueryString": parsed.query, "headers": {k.lower(): v for k, v in self.headers.items()}, "requestContext": {"http": {"method": self.command}}}, None)
        self.send_response(result["statusCode"])
        for name, value in result.get("headers", {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(result["body"].encode())

    do_OPTIONS = do_GET

    def log_message(self, format, *args):
        # Do not log arbitrary query strings.
        print(f"Local analysis request: {args[1] if len(args) > 1 else 'complete'}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    handler._analyze = local_analyze
    print(f"Analysis API: http://127.0.0.1:{args.port}/analyze", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), LocalHandler).serve_forever()


if __name__ == "__main__":
    main()
