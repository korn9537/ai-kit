// Tests for usage-mask.mjs: secrets become [masked] before the cut to max code points.
// Usage: node scripts/usage-mask.test.mjs
import { maskPrompt } from "./usage-mask.mjs";

let passed = 0;
let failed = 0;
function eq(desc, got, want) {
  if (Object.is(got, want)) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  }
}

eq("github token", maskPrompt("use ghp_abcdefghijklmnopqrstuvwxyz0123456789 now"), "use [masked] now");
eq("anthropic key", maskPrompt("sk-ant-api03-AbC_dEf-123456789012345678901234"), "[masked]");
eq("aws key", maskPrompt("AKIAIOSFODNN7EXAMPLE"), "[masked]");
eq("jwt", maskPrompt("t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abcDEF123"), "t=[masked]");
eq("assignment", maskPrompt("password=hunter2 and token: abc123"), "password=[masked] and token: [masked]");
eq("url creds", maskPrompt("postgres://dev:s3cret@db:5432/x"), "postgres://dev:[masked]@db:5432/x");
eq("pem", maskPrompt("-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----"), "[masked]");
eq("long hex", maskPrompt("id " + "a1".repeat(24)), "id [masked]");
eq("thai kept, cut by code point", [...maskPrompt("ก".repeat(1200))].length, 1000);
eq("mask before cut", maskPrompt("x".repeat(985) + " password=abcdefghijkl").includes("abcd"), false);
eq("plain text untouched", maskPrompt("แก้ราคา promotion ให้คิดฝั่ง server"), "แก้ราคา promotion ให้คิดฝั่ง server");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
