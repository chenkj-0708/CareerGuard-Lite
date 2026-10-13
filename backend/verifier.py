"""Read-only, authorised exact-hash index lookup; no domain/RDAP requests."""
import hashlib
import json
import time
import uuid
from pathlib import Path
try:
    from .domains import registrable_domain, PSL_SHA256
except ImportError:
    from domains import registrable_domain, PSL_SHA256
HASH_VERSION = "HashNormalise-CORR-v1"
DUPLICATE_MESSAGE = "Similar listing content appears on multiple domains. This can occur through legitimate syndication or reposting and is not proof of fraud."


class VerificationEngine:
    def __init__(self, manifest_path=None):
        self.entries = None
        self.manifest = None
        self.run_id = str(uuid.uuid4())
        if manifest_path:
            path = Path(manifest_path).resolve()
            manifest = json.loads(path.read_text(encoding="utf-8"))
            required = {"indexVersion", "indexFile", "indexSha256", "permissionBasis", "sourceCategories", "constructionWindow", "eligibility", "exclusions", "deduplication", "contaminationChecks", "pslSha256", "hashContractVersion"}
            if not required.issubset(manifest) or any(not manifest[key] for key in required):
                raise ValueError("Incomplete authorised index manifest")
            if manifest["pslSha256"] != PSL_SHA256 or manifest["hashContractVersion"] != HASH_VERSION:
                raise ValueError("Index/browser PSL or hash contract mismatch")
            index_path = (path.parent / manifest["indexFile"]).resolve()
            if path.parent not in index_path.parents:
                raise ValueError("Index must reside within its manifest directory")
            raw = index_path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != manifest["indexSha256"]:
                raise ValueError("Index checksum mismatch")
            data = json.loads(raw)
            entries = data.get("entries")
            if data.get("schemaVersion") != 1 or not isinstance(entries, dict):
                raise ValueError("Invalid read-only index")
            import re
            frozen = {}
            for digest, domains in entries.items():
                if not re.fullmatch(r"[0-9a-f]{64}", digest) or not isinstance(domains, list) or any(not isinstance(d, str) for d in domains):
                    raise ValueError("Invalid index entry")
                roots = frozenset(registrable_domain(d) for d in domains)
                if "" in roots: raise ValueError("Invalid source domain")
                frozen[digest] = roots
            from types import MappingProxyType
            self.entries = MappingProxyType(frozen)
            self.manifest = manifest

    def verify(self, payload):
        start = time.perf_counter()
        count = len(self.entries.get(payload["excerptHash"], ())) if self.entries is not None else 0
        status = "completed" if self.entries is not None else "unavailable"
        reasons = [{"id": "CTX_CROSS_DOMAIN_DUPLICATE", "points": 0, "role": "context", "message": DUPLICATE_MESSAGE}] if count >= 3 else []
        result = {"schemaVersion": 1, "requestId": payload["requestId"], "status": status,
                  "corroborationIndexVersion": self.manifest["indexVersion"] if self.manifest else None,
                  "runId": self.run_id, "duplicateSourceCount": count, "contextReasons": reasons,
                  "gateSensitivity": {"atLeast2": count >= 2, "atLeast3": count >= 3, "atLeast4": count >= 4},
                  "latencyMs": round((time.perf_counter()-start)*1000, 2)}
        if status == "unavailable": result["errorCode"] = "AUTHORISED_INDEX_NOT_CONFIGURED"
        return result
