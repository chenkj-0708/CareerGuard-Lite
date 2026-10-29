"""Rebuild the offline PSL module from the official vendored snapshot; no network."""
import hashlib
import json
import re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
raw=(ROOT/"lib/public_suffix_list.dat").read_bytes();text=raw.decode("utf-8")
rules=[]
for line in text.splitlines():
    line=line.strip()
    if not line or line.startswith("//"):continue
    marker="!" if line.startswith("!") else "*." if line.startswith("*.") else ""
    rules.append(marker+line[len(marker):].encode("idna").decode("ascii"))
version=re.search(r"// VERSION: (.+)",text).group(1)
runtime=(ROOT/"scripts/psl_runtime.js").read_text(encoding="utf-8").replace("__PSL_VERSION__",json.dumps(version))
code="// Generated from the official pinned PSL snapshot; includes ICANN and PRIVATE sections.\n(() => {\nconst rules = "+json.dumps(rules,separators=(",",":"))+";\n"+runtime
(ROOT/"lib/public-suffix.js").write_text(code,encoding="utf-8",newline="\n")
(ROOT/"lib/psl-manifest.json").write_text(json.dumps({"source":"https://publicsuffix.org/list/public_suffix_list.dat","version":version,"sha256":hashlib.sha256(raw).hexdigest(),"include_private":True},indent=2)+"\n",encoding="utf-8",newline="\n")
