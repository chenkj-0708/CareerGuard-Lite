import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {hashNormalise,excerptForHash,excerptHash} from "../lib/hash-contract.js";
assert.equal(hashNormalise("  ＨELLO\u0085World! 123 "),"hello world! 123");
assert.equal(excerptForHash("a".repeat(2500)+"ignored middle"+"b".repeat(2500)),"a".repeat(2500)+"b".repeat(2500));
assert.equal(Array.from(excerptForHash("😀".repeat(6000))).length,5000);
assert.equal(await excerptHash(" Hello World! "),createHash("sha256").update("hello world!").digest("hex"));
assert.notEqual(await excerptHash("Hello!"),await excerptHash("Hello?"));
console.log("HashNormalise-CORR v1 Unicode, excerpt and digest tests passed");
