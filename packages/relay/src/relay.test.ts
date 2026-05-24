import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonRelayMailbox } from "./index";

describe("JsonRelayMailbox", () => {
  it("tracks message delivery, acknowledgement, failure, and cancellation", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentbase-relay-"));
    const mailbox = new JsonRelayMailbox({ file: path.join(workspace, "mailbox.json") });
    const queued = await mailbox.send({ channel: "run", type: "run", runId: "run_1", payload: { prompt: "summarize" } });
    const delivered = await mailbox.markDelivered(queued.id);
    const acknowledged = await mailbox.acknowledge(queued.id);
    const failed = await mailbox.send({ channel: "export", type: "export", payload: { target: "observer" } });
    await mailbox.fail(failed.id, "network unavailable");
    const cancelled = await mailbox.send({ channel: "approval", type: "approval", payload: { approvalId: "appr_1" } });
    await mailbox.cancel(cancelled.id, "user denied");

    expect(delivered.attempts).toBe(1);
    expect(acknowledged.status).toBe("acknowledged");
    expect(await mailbox.list({ status: "failed" })).toEqual([expect.objectContaining({ error: "network unavailable" })]);
    expect(await mailbox.list({ channel: "approval" })).toEqual([expect.objectContaining({ status: "cancelled" })]);
  });
});
