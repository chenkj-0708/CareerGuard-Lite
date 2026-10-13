"""External evidence only. Never computes or modifies browser risk scores."""
import http.client
import ipaddress
import json
import socket
import ssl
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

CHECKS = {"rdap_domain_registration", "website_reachable", "contact_domain_match"}


def public_addresses(domain):
    addresses = {item[4][0] for item in socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Non-public destination")
    return addresses


def public_get(url, redirects=0):
    """Pin the connection to a checked public IP; validate every RDAP redirect."""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username:
        raise ValueError("HTTPS public destinations required")
    address = sorted(public_addresses(parsed.hostname))[0]
    conn = http.client.HTTPSConnection(parsed.hostname, timeout=3)
    raw = socket.create_connection((address, 443), timeout=3)
    conn.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=parsed.hostname)
    try:
        conn.request("GET", parsed.path or "/", headers={"Accept": "application/rdap+json, application/json", "User-Agent": "CareerGuard-Lite/0.2"})
        response = conn.getresponse()
        if response.status in (301, 302, 303, 307, 308) and redirects < 3:
            from urllib.parse import urljoin
            return public_get(urljoin(url, response.getheader("Location", "")), redirects + 1)
        body = response.read(256001)
        if len(body) > 256000:
            raise ValueError("External response too large")
        return response.status, body
    finally:
        conn.close()


class VerificationEngine:
    def __init__(self, fetch=public_get):
        self.fetch = fetch

    def verify(self, payload):
        start = time.perf_counter()
        domain = payload["company_domain"]
        contact = payload["contact_domain"]
        checks = {}
        for name in payload["requested_checks"]:
            began = time.perf_counter()
            error_type = None
            try:
                if not domain or (name == "contact_domain_match" and not contact):
                    value = {"status": "inconclusive", "reason": "missing-domain-evidence"}
                elif name == "contact_domain_match":
                    matches = contact == domain or contact.endswith("." + domain) or domain.endswith("." + contact)
                    value = {"status": "supported" if matches else "contradicted"}
                elif name == "website_reachable":
                    status, _ = self.fetch("https://" + domain + "/")
                    value = {"status": "supported" if 200 <= status < 400 else "unavailable", "http_status": status}
                else:
                    status, body = self.fetch("https://rdap.org/domain/" + domain)
                    if status == 404:
                        value = {"status": "contradicted", "registered": False}
                    elif status == 200:
                        data = json.loads(body)
                        if data.get("objectClassName") != "domain":
                            raise ValueError("Invalid RDAP domain response")
                        value = {"status": "supported", "registered": True, "domain_status": data.get("status", [])}
                        event = next((e for e in data.get("events", []) if e.get("eventAction") == "registration"), None)
                        if event:
                            date = datetime.fromisoformat(event["eventDate"].replace("Z", "+00:00"))
                            value["registration_date"] = event["eventDate"]
                            value["domain_age_days"] = max(0, (datetime.now(timezone.utc) - date).days)
                        value["registrar"] = next((e.get("handle") for e in data.get("entities", []) if "registrar" in e.get("roles", [])), None)
                    else:
                        value = {"status": "unavailable", "http_status": status}
            except Exception as error:
                error_type = type(error).__name__
                value = {"status": "unavailable", "error_type": error_type}
            checks[name] = value
            print(json.dumps({"request_id": payload["request_id"], "timestamp": datetime.now(timezone.utc).isoformat(), "check_type": name, "status": value["status"], "response_time_ms": round((time.perf_counter()-began)*1000, 2), "error_type": error_type}))
        return {"schemaVersion": 2, "request_id": payload["request_id"], "checks": checks, "latencyMs": round((time.perf_counter()-start)*1000, 2)}
