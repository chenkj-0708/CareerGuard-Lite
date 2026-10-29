import hashlib
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer
from backend.verifier import VerificationEngine, HASH_VERSION
from backend.domains import PSL_SHA256, registrable_domain
from backend.server import Handler, Protection


def payload(token="test-capability"):
    return {"requestId":"request-1234567890","schemaVersion":1,"scenarioOrScanId":"scenario-123456789","excerptHash":"a"*64,"hashContractVersion":HASH_VERSION,"capabilityToken":token}


def index_fixture(directory,domains=None):
    path=Path(directory);raw=json.dumps({"schemaVersion":1,"entries":{"a"*64:domains or ["one.example.com","two.example.net","three.example.org"]}}).encode()
    (path/"index.json").write_bytes(raw)
    manifest={"indexVersion":"functional-test-only-v1","indexFile":"index.json","indexSha256":hashlib.sha256(raw).hexdigest(),"permissionBasis":"synthetic functional fixture only","sourceCategories":["synthetic"],"constructionWindow":"test setup before queries","eligibility":"synthetic only","exclusions":"all real/held-out scenarios","deduplication":"distinct PSL roots","contaminationChecks":"no real data","pslSha256":PSL_SHA256,"hashContractVersion":HASH_VERSION}
    (path/"manifest.json").write_text(json.dumps(manifest),encoding="utf-8")
    return path/"manifest.json"


class VerifierTests(unittest.TestCase):
    def test_missing_index_unavailable(self):
        result=VerificationEngine().verify(payload())
        self.assertEqual(result["status"],"unavailable");self.assertNotIn("score",result)
    def test_read_only_context_and_no_insert(self):
        with tempfile.TemporaryDirectory() as directory:
            path=index_fixture(directory);before=(Path(directory)/"index.json").read_bytes();engine=VerificationEngine(path)
            result=engine.verify(payload());self.assertEqual(result["duplicateSourceCount"],3)
            self.assertEqual(result["contextReasons"][0]["points"],0)
            data=payload();data["excerptHash"]="b"*64
            self.assertEqual(engine.verify(data)["contextReasons"],[])
            self.assertEqual((Path(directory)/"index.json").read_bytes(),before)
            self.assertNotIn(data["excerptHash"],engine.entries)
    def test_psl_domains_collapsed(self):
        with tempfile.TemporaryDirectory() as directory:
            path=index_fixture(directory,["foo.github.io","jobs.foo.github.io","bar.github.io"])
            result=VerificationEngine(path).verify(payload())
            self.assertEqual(result["duplicateSourceCount"],2);self.assertEqual(result["contextReasons"],[])
            self.assertTrue(result["gateSensitivity"]["atLeast2"])
    def test_manifest_and_checksum_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=index_fixture(directory)
            (Path(directory)/"index.json").write_text("{}")
            with self.assertRaises(ValueError):VerificationEngine(path)
    def test_psl_parity(self):
        for host,expected in (("careers.example.co.uk","example.co.uk"),("foo.github.io","foo.github.io"),("a.b.ck","a.b.ck"),("www.ck","www.ck"),("127.0.0.1","")):
            self.assertEqual(registrable_domain(host),expected)


class SecurityTests(unittest.TestCase):
    def test_replay_expiry_and_per_run_tokens(self):
        guard=Protection();data=payload(guard.issue());guard.validate(data)
        with self.assertRaises(ValueError):guard.validate(data)
        guard.tokens[data["capabilityToken"]]=time.time()-1
        data["requestId"]+="x"
        with self.assertRaises(PermissionError):guard.validate(data)
        with self.assertRaises(PermissionError):Protection().validate(data)
    def test_exact_six_fields(self):
        for extra in ("document_body","company_domain","pageRootDomain","localScore","timestamp","nonce"):
            guard=Protection();data=payload(guard.issue());data[extra]="anything"
            with self.assertRaises(ValueError):guard.validate(data)
    def test_schema_hash_and_size_types(self):
        for change in ({"excerptHash":"bad"},{"schemaVersion":True},{"hashContractVersion":"other"},{"scenarioOrScanId":"short"}):
            guard=Protection();data=payload(guard.issue());data.update(change)
            with self.assertRaises(ValueError):guard.validate(data)
    def test_rate(self):
        guard=Protection();self.assertTrue(all(guard.rate() for _ in range(30)));self.assertFalse(guard.rate())
    def test_replay_window(self):
        guard=Protection();data=payload(guard.issue());now=time.time();guard.validate(data)
        self.assertGreaterEqual(guard.used[data["requestId"]]-now,599)
    def test_http_security_and_protocol(self):
        server=ThreadingHTTPServer(("127.0.0.1",0),Handler);server.allowed_origins={"chrome-extension://"+"a"*32};server.protection=Protection();server.engine=VerificationEngine()
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        base=f"http://127.0.0.1:{server.server_port}"
        def request(body=None,origin=None):
            headers={"Content-Type":"application/json"}
            if origin:headers["Origin"]=origin
            return urllib.request.urlopen(urllib.request.Request(base+("/verify" if body is not None else "/health"),data=body,headers=headers))
        try:
            for origin in (None,"https://evil.example"):
                with self.assertRaises(urllib.error.HTTPError) as error:request(origin=origin)
                self.assertEqual(error.exception.code,403);self.assertIsNone(error.exception.headers.get("Access-Control-Allow-Origin"))
            origin=next(iter(server.allowed_origins))
            for body,expected in ((b"x"*4097,413),(b"{",400),(b"{}",400)):
                with self.assertRaises(urllib.error.HTTPError) as error:request(body,origin)
                self.assertEqual(error.exception.code,expected)
            with request(origin=origin) as response:token=json.load(response)["token"]
            data=payload(token)
            with request(json.dumps(data).encode(),origin) as response:
                self.assertEqual(json.load(response)["status"],"unavailable")
            with self.assertRaises(urllib.error.HTTPError) as error:request(json.dumps(data).encode(),origin)
            self.assertEqual(error.exception.code,400)
        finally:server.shutdown();server.server_close();worker.join()


if __name__=="__main__":unittest.main()
