import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedNode } from "../scripts/node-version.mjs";

test("Node minimum matches the dependency requirement", () => {
  for (const version of ["20.19.0", "22.0.0", "22.11.9"]) assert.equal(isSupportedNode(version), false, version);
  for (const version of ["22.12.0", "22.21.0", "24.0.0", "26.0.0"]) assert.equal(isSupportedNode(version), true, version);
});
