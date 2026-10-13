"""Localhost corroboration API restricted to the explicitly configured extension."""
import argparse
import collections
import json
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
try:
    from .verifier import VerificationEngine, CHECKS
except ImportError:
    from verifier import VerificationEngine, CHECKS

ENGINE = VerificationEngine()
MAX_BODY_BYTES = 4096
DOMAIN = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
IDENTIFIER = re.compile(r"[A-Za-z0-9-]{16,80}$")


class Protection:
    def __init__(self):
        self.lock = threading.Lock()
        self.tokens = {}
        self.used = {}
        self.calls = collections.deque()

    def rate(self):
        now = time.time()
        while self.calls and self.calls[0] < now - 60:
            self.calls.popleft()
        if len(self.calls) >= 30:
            return False
        self.calls.append(now)
        return True

    def issue(self):
        now = time.time()
        self.tokens = {k: v for k, v in self.tokens.items() if v > now}
        token = secrets.token_urlsafe(32)
        self.tokens[token] = now + 60
        return token

    def validate(self, payload, token):
        now = time.time()
        fields = {"request_id", "timestamp", "nonce", "company_domain", "contact_domain", "requested_checks"}
        if not isinstance(payload, dict) or set(payload) != fields:
            raise ValueError("Unexpected or missing request fields")
        for key in ("request_id", "nonce"):
            if not isinstance(payload[key], str) or not IDENTIFIER.fullmatch(payload[key]):
                raise ValueError("Invalid request identifier")
        timestamp = payload["timestamp"]
        if type(timestamp) not in (int, float) or not abs(now - timestamp) <= 60:
            raise ValueError("Expired or invalid timestamp")
        for key in ("company_domain", "contact_domain"):
            if not isinstance(payload[key], str) or (payload[key] and not DOMAIN.fullmatch(payload[key])):
                raise ValueError("Invalid domain")
        checks = payload["requested_checks"]
        if not isinstance(checks, list) or not checks or any(not isinstance(c, str) or c not in CHECKS for c in checks) or len(set(checks)) != len(checks):
            raise ValueError("Unsupported checks")
        if self.tokens.get(token, 0) <= now:
            raise PermissionError("Expired or invalid token")
        self.used = {k: v for k, v in self.used.items() if v > now}
        identifiers = [("request", payload["request_id"]), ("nonce", payload["nonce"])]
        if any(key in self.used for key in identifiers):
            raise ValueError("Repeated request or nonce")
        for key in identifiers:
            self.used[key] = now + 120
        del self.tokens[token]


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        return self.headers.get("Origin") in self.server.allowed_origins

    def reply(self, value, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if self.allowed():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def gate(self):
        if not self.allowed():
            self.reply({"error": "Origin rejected"}, 403)
            return False
        with self.server.protection.lock:
            accepted = self.server.protection.rate()
        if not accepted:
            self.reply({"error": "Rate limit exceeded"}, 429)
        return accepted

    def do_OPTIONS(self):
        if self.gate():
            self.reply({}, 204)

    def do_GET(self):
        if not self.gate():
            return
        if self.path != "/health":
            self.reply({"error": "Not found"}, 404)
            return
        with self.server.protection.lock:
            token = self.server.protection.issue()
        self.reply({"ok": True, "token": token, "expires_in": 60})

    def do_POST(self):
        if not self.gate():
            return
        if self.path != "/verify":
            self.reply({"error": "Not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                self.reply({"error": "Request size rejected"}, 413)
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("JSON content type required")
            self.connection.settimeout(5)
            payload = json.loads(self.rfile.read(length))
            with self.server.protection.lock:
                self.server.protection.validate(payload, self.headers.get("Authorization", "").removeprefix("Bearer "))
            self.reply(ENGINE.verify(payload))
        except PermissionError:
            self.reply({"error": "Token rejected"}, 401)
        except (ValueError, TypeError, TimeoutError):
            self.reply({"error": "Invalid request"}, 400)

    def log_message(self, format, *args):
        # Access log only: no bodies, domains, tokens or recruitment content.
        print(json.dumps({"timestamp": time.time(), "event": "http_request", "status": args[-2] if len(args) >= 2 else None}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allowed-origin", action="append", required=True)
    args = parser.parse_args()
    if any(not re.fullmatch(r"chrome-extension://[a-p]{32}", origin) for origin in args.allowed_origin):
        parser.error("Use the exact chrome-extension:// origin shown on the extensions page")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.allowed_origins = set(args.allowed_origin)
    server.protection = Protection()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
