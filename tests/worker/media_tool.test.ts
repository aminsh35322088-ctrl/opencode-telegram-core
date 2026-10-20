import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mediaTool from "../../worker/runtime_tools/media.ts";

test("image generation pulls a bounded Topic transfer and emits an artifact marker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "core-media-tool-test-"));
  const bytes = Buffer.from("fake-png-content");
  const actions: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { payload: { action: string; offset?: number; limit?: number } };
    const action = request.payload.action;
    actions.push(action);
    let result: unknown;
    if (action === "image.generate") result = { ok: true, transferId: "transfer-1", filename: "image-1.png", mimeType: "image/png", size: bytes.length, selection: { providerID: "test", modelID: "image" } };
    else if (action === "media.chunk") {
      const offset = request.payload.offset ?? 0;
      const chunk = bytes.subarray(offset, offset + (request.payload.limit ?? bytes.length));
      result = { offset, nextOffset: offset + chunk.length, size: bytes.length, eof: offset + chunk.length >= bytes.length, data: chunk.toString("base64") };
    } else if (action === "media.finish") result = { cleaned: true };
    else throw new Error(`unexpected action ${action}`);
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const output = await mediaTool.execute({ action: "image.generate", prompt: "a small cat", output: "artifacts/result.png" }, { sessionID: "ses_topic", directory: root });
    const result = JSON.parse(output) as { ok: boolean; path: string; deliveryMarker: string; mimeType: string };
    assert.equal(result.ok, true);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.deliveryMarker, `__TELEGRAM_ARTIFACT__ ${result.path}`);
    assert.deepEqual(await readFile(result.path), bytes);
    assert.deepEqual(actions, ["image.generate", "media.chunk", "media.finish"]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
