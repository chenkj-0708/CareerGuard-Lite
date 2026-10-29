"""PSL algorithm shared with the browser snapshot (including PRIVATE rules)."""
import hashlib
import ipaddress
from pathlib import Path
PSL_PATH = Path(__file__).resolve().parents[1] / "lib" / "public_suffix_list.dat"
PSL_SHA256 = hashlib.sha256(PSL_PATH.read_bytes()).hexdigest()
_rules = [line.strip() for line in PSL_PATH.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("//")]
def ascii_rule(rule):
    marker = "!" if rule.startswith("!") else "*." if rule.startswith("*.") else ""
    return marker + rule[len(marker):].encode("idna").decode("ascii")
_rules = [ascii_rule(r) for r in _rules]
EXACT = set(r for r in _rules if not r.startswith(("!", "*.")))
EXCEPTIONS = set(r[1:] for r in _rules if r.startswith("!"))
WILDCARDS = set(r[2:] for r in _rules if r.startswith("*."))
def registrable_domain(value):
    host = value.lower().rstrip(".").encode("idna").decode("ascii")
    try:
        ipaddress.ip_address(host)
        return ""
    except ValueError:
        pass
    parts = host.split("."); suffix = 1
    for i in range(len(parts)):
        tail = ".".join(parts[i:])
        if tail in EXCEPTIONS:
            suffix = len(parts) - i - 1
            break
        if tail in EXACT: suffix = max(suffix, len(parts) - i)
        if i > 0 and tail in WILDCARDS: suffix = max(suffix, len(parts) - i + 1)
    return ".".join(parts[-suffix-1:]) if len(parts) > suffix else ""
