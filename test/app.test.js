import test from "node:test";
import assert from "node:assert/strict";

import { bootApp, createApp } from "../src/app.js";

test("app module can be imported without browser DOM side effects", () => {
  assert.equal(typeof createApp, "function");
  assert.equal(typeof bootApp, "function");
  assert.equal(globalThis.cleanMyLinkTransforms, undefined);
});
