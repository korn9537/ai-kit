// node:test helpers for scripts/*.test.mjs. node:test runs a test only after the file's code has moved on, so each
// helper compares at the call and its test reports that result: later fixture steps and tear-down never reach it.
import assert from "node:assert/strict";
import { test } from "node:test";

// runs `fn` at once (assertions in it); the test named `name` passes or rethrows its error
export function check(name, fn) {
  let error;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  test(name, () => {
    if (error) throw error;
  });
}

const text = (out) => (out === undefined || out === "" ? undefined : typeof out === "string" ? out : JSON.stringify(out, null, 2));

export const ok = (name, cond, out) => check(name, () => assert.ok(cond, text(out)));
export const eq = (name, got, want) => check(name, () => assert.deepStrictEqual(got, want));
export const match = (name, got, re) => check(name, () => assert.match(got, re));

// `fn` must throw an error whose message matches `re`
export const throws = (name, fn, re) =>
  check(name, () => {
    let error;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    assert.ok(error, "did not throw");
    assert.match(error.message, re);
  });
