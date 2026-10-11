"""Dependency-free localhost API for CareerGuard Lite selective verification."""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from .verifier import VerificationEngine
except ImportError:
    from verifier import VerificationEngine

ENGINE = VerificationEngine()
MAX_BODY_BYTES = 100_000


class Handler(BaseHTTPRequestHandler):
    server_version = "CareerGuardBackend/0.1"

    def _headers(self, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _json(self, value: dict, status: int = 200) -> None:
        self._headers(status)
        self.wfile.write(json.dumps(value).encode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._headers(204)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json({"ok": True, "service": "CareerGuard selective verifier", "version": "0.1.0"})
        else:
            self._json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/verify":
            self._json({"ok": False, "error": "Not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("Request body must be between 1 and 100000 bytes.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not str(payload.get("pageUrl", "")).startswith(("http://", "https://")):
                raise ValueError("A valid public pageUrl is required.")
            self._json(ENGINE.verify(payload))
        except (ValueError, json.JSONDecodeError) as error:
            self._json({"ok": False, "error": str(error)}, 400)

    def log_message(self, format: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"CareerGuard backend listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
