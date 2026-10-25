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
eq("quoted value with spaces", maskPrompt('password="my secret phrase" ok'), 'password=[masked] ok');
eq("json quoted value", maskPrompt('{"password": "abc def"}'), '{"password": [masked]}');
eq("single-quoted value", maskPrompt("secret='a b c'"), "secret=[masked]");
eq("secret_key", maskPrompt("secret_key=abc"), "secret_key=[masked]");
eq("SECRET_KEY", maskPrompt("SECRET_KEY=abc"), "SECRET_KEY=[masked]");
eq("password_hash", maskPrompt("password_hash: x"), "password_hash: [masked]");
eq("client_secret_value", maskPrompt("client_secret_value=x"), "client_secret_value=[masked]");
eq("api-key hyphen", maskPrompt("api-key: x"), "api-key: [masked]");
eq("url password with slash", maskPrompt("postgres://u:p/ss@h/db"), "postgres://u:[masked]@h/db");
eq("vendor token after underscore", maskPrompt("foo_ghp_" + "a".repeat(36)), "foo_[masked]");
eq("ghs and ghu tokens", maskPrompt(`ghs_${"b".repeat(36)} ghu_${"c".repeat(36)}`), "[masked] [masked]");
eq("jwt with empty signature", maskPrompt("eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."), "[masked]");
eq("pgp private key block", maskPrompt("a -----BEGIN PGP PRIVATE KEY BLOCK-----\nxyz\n-----END PGP PRIVATE KEY BLOCK----- b"), "a [masked] b");
eq("bearer header", maskPrompt("Authorization: Bearer abc.DEF-123_x"), "Authorization: Bearer [masked]");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
