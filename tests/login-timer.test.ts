import assert from "node:assert/strict";
import test from "node:test";
import * as ui from "../src/ui";

test("the code timer remains visible without a server-provided retry time", () => {
  const timer = (ui as any).loginTimerView;
  assert.equal(typeof timer, "function");
  const state = { codeRequestedAt: 10000, codeResendWaitSeconds: 0, codeResendAllowed: false };
  assert.deepEqual(timer(state, 75000, 75000), { text: "Ждём код · 01:05", disabled: true });
  assert.deepEqual(timer(state, 130000, 75000), { text: "Ждём код · 02:00", disabled: true });
});

test("the retry countdown advances locally between backend refreshes", () => {
  const timer = (ui as any).loginTimerView;
  assert.equal(typeof timer, "function");
  const state = { codeRequestedAt: 10000, codeResendWaitSeconds: 30, codeResendAllowed: true };
  assert.deepEqual(timer(state, 12000, 10000), { text: "Повтор через 00:28", disabled: true });
  assert.deepEqual(timer(state, 40000, 10000), { text: "Запросить код повторно", disabled: false });
});
