import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TID_TASK_ITEM, TID_WORKSPACE_MORE_BUTTON, testId } from "@zcode/shared/test-ids";
import { clearAppData, clickTestIdByDom } from "#e2e/helpers/desktop-app";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "#e2e/helpers/v4-conversation";
import { ensureUpstreamProviderForE2E } from "#e2e/helpers/upstream-provider";

const CASE_TIMEOUT_MS = 120_000;
const SEED_MARKER = "E2E_SIDEBAR_UNREAD_CLEAR_SEED";
const REPLY_MARKER = "SIDEBAR_UNREAD_CLEAR_OK";
const MARK_UNREAD_LABELS = ["Mark as unread", "标记为未读"];
const MARK_READ_LABELS = ["Mark as read", "标记为已读"];

describe("TSL04/TSL04a：侧栏与 Header 双向切换已读状态", () => {
  afterEach(async function () {
    if (this.currentTest?.state !== "failed") return;
    console.info(
      "[unread-menu]",
      await browser.execute(() => ({
        items: Array.from(document.querySelectorAll('[role="menuitem"]')).map(
          (item) => item.textContent,
        ),
        triggers: Array.from(document.querySelectorAll('[aria-haspopup="menu"]')).map((item) => ({
          id: item.getAttribute("data-testid"),
          open: item.getAttribute("data-state"),
        })),
      })),
    );
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("手动清已读不打开任务，点击同一任务仍自动清除，状态持久化且不改变活动时间", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E();
    // pending case 独立跑时 app data 每次重建；显式选择 replay provider，避免仅有配置但
    // 当前草稿仍停在未鉴权 builtin provider，导致发送按钮在回归步骤前一直禁用。
    await ensureUpstreamProviderForE2E();
    await sendV4Prompt(`${SEED_MARKER}: Reply with exactly "${REPLY_MARKER}".`);
    await waitForV4TimelineContaining(REPLY_MARKER, 45_000);
    await waitForV4Pane(
      (snapshot) =>
        Boolean(snapshot.sessionId && snapshot.sessionId !== "draft" && !snapshot.canStop),
      "未读清除 case 没有建立正式 session",
      45_000,
    );
    const taskId = (await getV4PaneSnapshot()).sessionId;
    if (!taskId || taskId === "draft") {
      throw new Error(`未读清除 case 缺少 taskId: ${String(taskId)}`);
    }

    await waitForTaskRow(taskId);
    await waitForTaskIndexUnread(taskId, null, "新任务初始状态不是已读");
    const activityBefore = readTaskIndexActivity(taskId);

    await markTaskUnreadFromContextMenu(taskId);
    await waitForTaskUnreadIndicator(taskId, true, "右键标记未读后没有显示蓝点");
    await waitForTaskIndexUnread(taskId, "number", "右键标记未读没有写入 tasks-index");

    // TSL04a：手动已读必须在不打开任务的情况下完成，不能借用点击行的自动清除。
    await startNewV4Draft();
    await markTaskUnreadFromContextMenu(taskId, false);
    await waitForTaskUnreadIndicator(taskId, false, "手动标记已读后蓝点没有消失");
    await waitForTaskIndexUnread(taskId, null, "手动标记已读没有写入 tasks-index");
    expect((await getV4PaneSnapshot()).sessionId).toBe("draft");
    await selectV4TaskById(taskId);

    // Header 使用相同菜单规则，标记已读后仍停留在原会话。
    for (const unread of [true, false]) {
      await $(`[data-testid="${TID_WORKSPACE_MORE_BUTTON}"]`).click();
      await selectUnreadMenuAction(unread);
      await waitForTaskIndexUnread(taskId, unread ? "number" : null, "Header 未读切换未落库");
      expect((await getV4PaneSnapshot()).sessionId).toBe(taskId);
    }
    await markTaskUnreadFromContextMenu(taskId);
    await waitForTaskIndexUnread(taskId, "number", "点击打开前没有恢复未读前置");

    // 回归目标：当前 task 已经打开时，再点同一行也必须执行完整的已读事务。
    await clickTestIdByDom(testId(TID_TASK_ITEM, taskId), {
      timeout: 15_000,
      timeoutMsg: "标记未读后的 task 行不可点击",
    });
    await waitForTaskUnreadIndicator(taskId, false, "打开未读 task 后蓝点没有消失");
    await waitForTaskIndexUnread(taskId, null, "打开未读 task 后 tasks-index 仍是未读");

    await startNewV4Draft();
    await selectV4TaskById(taskId);
    await waitForTaskUnreadIndicator(taskId, false, "切走再返回后未读蓝点重新出现");
    await waitForTaskIndexUnread(taskId, null, "切走再返回后 tasks-index 未读状态反弹");

    // 分组有独立菜单实现；按未读视图清除后行应消失，且都不打开后台任务。
    await startNewV4Draft();
    for (const view of ["grouped", "timeline", "unread"]) {
      if (view === "unread") {
        await markTaskUnreadFromContextMenu(taskId);
        await waitForTaskIndexUnread(taskId, "number", "按未读视图缺少未读前置");
      }
      await $('[data-testid="sidebar-view-menu"]').click();
      await $(`[data-testid="sidebar-view-${view}"]`).click();
      await waitForTaskRow(taskId);
      if (view !== "unread") {
        await markTaskUnreadFromContextMenu(taskId);
        await waitForTaskIndexUnread(taskId, "number", `${view} 标记未读未落库`);
      }
      await markTaskUnreadFromContextMenu(taskId, false);
      await waitForTaskIndexUnread(taskId, null, `${view} 标记已读未落库`);
      expect((await getV4PaneSnapshot()).sessionId).toBe("draft");
    }
    await browser.waitUntil(
      async () => !(await $(`[data-testid="${testId(TID_TASK_ITEM, taskId)}"]`).isExisting()),
      { timeout: 15_000, timeoutMsg: "手动标记已读后仍留在按未读列表" },
    );
    expect(readTaskIndexActivity(taskId)).toEqual(activityBefore);
  });
});

async function waitForTaskRow(taskId: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (taskItemTestId) => Boolean(document.querySelector(`[data-testid="${taskItemTestId}"]`)),
        testId(TID_TASK_ITEM, taskId),
      ),
    {
      timeout: 30_000,
      timeoutMsg: `侧栏没有出现 task 行: ${taskId}`,
    },
  );
}

async function markTaskUnreadFromContextMenu(taskId: string, unread = true) {
  const opened = await browser.execute(
    (taskItemTestId) => {
      const row = document.querySelector<HTMLElement>(`[data-testid="${taskItemTestId}"]`);
      if (!row) {
        return false;
      }
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
      return true;
    },
    testId(TID_TASK_ITEM, taskId),
  );
  expect(opened).toBe(true);

  await selectUnreadMenuAction(unread);
}

async function selectUnreadMenuAction(unread: boolean) {
  const labels = unread ? MARK_UNREAD_LABELS : MARK_READ_LABELS;
  await browser.waitUntil(
    () =>
      browser.execute(
        (labels) =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).some((item) =>
            labels.includes((item.textContent ?? "").trim()),
          ),
        labels,
      ),
    {
      timeout: 15_000,
      timeoutMsg: `task 菜单没有出现“标记为${unread ? "未读" : "已读"}”`,
    },
  );

  const clicked = await browser.execute((labels) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (candidate) => labels.includes((candidate.textContent ?? "").trim()),
    );
    item?.click();
    return Boolean(item);
  }, labels);
  expect(clicked).toBe(true);
  // Radix 的关闭动画结束后再触发下一个菜单，避免第二次点击落在尚未卸载的遮罩上。
  await browser.waitUntil(
    () => browser.execute(() => !document.querySelector('[role="menuitem"]')),
    { timeout: 5_000, timeoutMsg: "已读菜单操作后没有关闭" },
  );
}

async function waitForTaskUnreadIndicator(taskId: string, expected: boolean, timeoutMsg: string) {
  await browser.waitUntil(
    () =>
      browser
        .execute(
          (taskItemTestId) =>
            Boolean(
              document
                .querySelector<HTMLElement>(`[data-testid="${taskItemTestId}"]`)
                ?.querySelector('[data-unread-indicator="true"]'),
            ),
          testId(TID_TASK_ITEM, taskId),
        )
        .then((visible) => visible === expected),
    { timeout: 15_000, timeoutMsg },
  );
}

async function waitForTaskIndexUnread(
  taskId: string,
  expected: "number" | null,
  timeoutMsg: string,
) {
  await browser.waitUntil(
    () => {
      const unreadAt = readTaskIndexUnread(taskId);
      return expected === "number" ? typeof unreadAt === "number" : unreadAt === null;
    },
    { timeout: 15_000, timeoutMsg },
  );
}

function readTaskIndexUnread(taskId: string): number | null | undefined {
  const db = new DatabaseSync(join(homedir(), ".zcode", "v2", "tasks-index.sqlite"));
  try {
    const row = db.prepare("select unread_at from tasks where task_id = ?").get(taskId) as
      | { unread_at?: number | null }
      | undefined;
    return row?.unread_at;
  } finally {
    db.close();
  }
}

function readTaskIndexActivity(taskId: string) {
  const db = new DatabaseSync(join(homedir(), ".zcode", "v2", "tasks-index.sqlite"));
  try {
    return db
      .prepare("select cli_created_at, cli_updated_at from tasks where task_id = ?")
      .get(taskId);
  } finally {
    db.close();
  }
}
