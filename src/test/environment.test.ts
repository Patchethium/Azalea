import { isServer } from "solid-js/web";
import { expect, it } from "vitest";

it("runs Solid tests with browser scheduling behavior", () => {
  expect(isServer).toBe(false);
});
