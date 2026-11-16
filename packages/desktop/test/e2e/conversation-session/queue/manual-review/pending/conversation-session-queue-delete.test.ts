import { clearAppData } from "#e2e/helpers/desktop-app";
import {
  clickV4Stop,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForLatestV4CommandAck,
  waitForV4ConversationState,
} from "#e2e/helpers/v4-conversation";
import { clickQueueRemove, waitForQueueCount } from "#e2e/helpers/conversation-session-queue";
import { countUpstreamRequestsContaining } from "#e2e/helpers/conversation-session-network";

// 复用 QO 的 controlled-stream fixture；pending 回放显式指定该 fixture，尚未转正。
describe("排队消息删除回归 B11a", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("running/held 删除排队消息保留其他项且不触发模型请求", async function () {
    this.timeout(180000);
    await prepareV4ConversationE2E();

    const runId = Date.now();
    await sendV4Prompt(`E2E_SLOW_STREAM E2E_QUEUE_OPS_DELETE_${runId}: Keep running.`);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "删除回归没有进入 streaming",
    );
    const keepMarker = `E2E_QUEUE_OPS_KEEP_${runId}`;
    const runningMarker = `E2E_QUEUE_OPS_DELETE_RUNNING_${runId}`;
    const heldMarker = `E2E_QUEUE_OPS_DELETE_HELD_${runId}`;
    await sendV4Prompt(`${keepMarker}: Keep this queued message.`);
    await waitForQueueCount(1);
    await sendV4Prompt(`${runningMarker}: This queued message must never run.`);
    await waitForQueueCount(2);
    await sendV4Prompt(`${heldMarker}: This queued message must never run.`);
    const initialQueue = await waitForQueueCount(3);
    const [keep, runningTarget, heldTarget] = initialQueue;
    if (!keep || !runningTarget || !heldTarget) throw new Error("删除回归队列项缺失");

    // B11a：真实 busy 输入经 deferred admission 入队，必须在当前轮仍运行时点删除。
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "删除前当前轮已结束，未覆盖 running 删除",
    );
    await clickQueueRemove(runningTarget.id);
    expect((await waitForLatestV4CommandAck("deleteQueueItem")).status).toBe("accepted");
    const afterRunningDelete = await waitForQueueCount(2);
    expect(afterRunningDelete.map((item) => item.id)).toEqual([keep.id, heldTarget.id]);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "删除排队项不应中断当前轮",
    );

    await clickV4Stop();
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 2,
      "stop 后没有保留待删除的 held 队列",
    );
    await clickQueueRemove(heldTarget.id);
    const afterHeldDelete = await waitForQueueCount(1);
    expect(afterHeldDelete.map((item) => item.id)).toEqual([keep.id]);
    expect(afterHeldDelete[0]?.content).toContain(keepMarker);
    for (const marker of [keepMarker, runningMarker, heldMarker]) {
      expect(await countUpstreamRequestsContaining(marker)).toBe(0);
    }
  });
});
