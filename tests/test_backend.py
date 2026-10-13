import copy
import json
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from backend.verifier import VerificationEngine, public_addresses
from backend.server import Handler, Protection


def payload():
    return {"request_id": "request-1234567890", "nonce": "nonce-12345678901", "timestamp": time.time(),
            "company_domain": "example.com", "contact_domain": "mail.example.com",
            "requested_checks": ["rdap_domain_registration", "website_reachable", "contact_domain_match"]}


class VerifierTests(unittest.TestCase):
    def test_evidence_only(self):
        def fetch(url):
            return 200, json.dumps({"objectClassName": "domain", "events": [{"eventAction": "registration", "eventDate": "2020-01-01T00:00:00Z"}]}).encode()
        result = VerificationEngine(fetch).verify(payload())
        self.assertNotIn("score", result)
        self.assertNotIn("tier", result)
        self.assertEqual(result["checks"]["contact_domain_match"]["status"], "supported")
        self.assertGreater(result["checks"]["rdap_domain_registration"]["domain_age_days"], 0)

    def test_timeout_unavailable(self):
        def fail(url):
            raise TimeoutError()
        result = VerificationEngine(fail).verify(payload())
        self.assertEqual(result["checks"]["rdap_domain_registration"]["status"], "unavailable")
        self.assertEqual(result["checks"]["website_reachable"]["status"], "unavailable")

    def test_missing_not_safe(self):
        data = payload(); data["company_domain"] = ""
        result = VerificationEngine().verify(data)
        self.assertTrue(all(c["status"] == "inconclusive" for c in result["checks"].values()))

    def test_private_addresses_blocked(self):
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(ValueError): public_addresses("example.com")


class SecurityTests(unittest.TestCase):
    def test_replay_and_expiry(self):
        guard = Protection(); data = payload()
        guard.validate(data, guard.issue())
        with self.assertRaises(ValueError): guard.validate(data, guard.issue())
        data["request_id"] += "x"
        with self.assertRaises(ValueError): guard.validate(data, guard.issue())
        guard = Protection(); token = guard.issue(); guard.tokens[token] = time.time() - 1
        with self.assertRaises(PermissionError): guard.validate(payload(), token)

    def test_schema_and_freshness(self):
        for change in ({"document_body": "raw"}, {"timestamp": 0}, {"requested_checks": ["anything"]}, {"company_domain": "127.0.0.1"}, {"timestamp": float("nan")}, {"requested_checks": [[]]}):
            guard = Protection(); data = payload(); data.update(change)
            with self.assertRaises(ValueError): guard.validate(data, guard.issue())

    def test_rate(self):
        guard = Protection()
        self.assertTrue(all(guard.rate() for _ in range(30)))
        self.assertFalse(guard.rate())

    def test_http_rejections(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.allowed_origins = {"chrome-extension://" + "a"*32}
        server.protection = Protection()
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        base = f"http://127.0.0.1:{server.server_port}"
        def request(body=None, origin=None, token=None):
            headers = {"Content-Type": "application/json"}
            if origin: headers["Origin"] = origin
            if token: headers["Authorization"] = "Bearer " + token
            return urllib.request.urlopen(urllib.request.Request(base + ("/verify" if body is not None else "/health"), data=body, headers=headers))
        try:
            for origin in (None, "https://evil.example"):
                with self.assertRaises(urllib.error.HTTPError) as error: request(origin=origin)
                self.assertEqual(error.exception.code, 403)
                self.assertIsNone(error.exception.headers.get("Access-Control-Allow-Origin"))
            origin = next(iter(server.allowed_origins))
            for body, expected in ((b"x"*4097, 413), (b"{", 400), (b'{}', 400)):
                with self.assertRaises(urllib.error.HTTPError) as error: request(body, origin)
                self.assertEqual(error.exception.code, expected)
            with request(origin=origin) as response:
                token = json.load(response)["token"]
            data = payload(); data["company_domain"] = ""
            with request(json.dumps(data).encode(), origin, token) as response:
                self.assertEqual(json.load(response)["schemaVersion"], 2)
        finally:
            server.shutdown(); server.server_close(); worker.join()


if __name__ == "__main__": unittest.main()
