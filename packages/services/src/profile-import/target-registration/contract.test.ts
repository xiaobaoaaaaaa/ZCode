import { expect, it, vi } from "vitest";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";
import { registerImportedHistory } from "../targetRegistration.js";

it("repairs index/project after a failed registration and preserves later user organization", async () => {
  const imported = {
    sessionId: "official_import_test",
    workspacePath: "/synthetic/project",
    title: "Original",
    createdAt: 1,
    updatedAt: 2,
    alreadyImported: true,
  };
  let stored: any = null;
  let projectId: string | null = null;
  const projects = {
    resolveSessionDirectories: () => ({ projectId }),
    readTree: () => ({ projects: [] }),
    saveProject: vi.fn(() => ({ id: "project-new" })),
    moveTask: vi.fn(({ projectId: id }) => {
      projectId = id;
    }),
  };
  const applyCliFacts = vi.fn(async ({ meta }) => {
    stored = meta;
    return meta;
  });
  applyCliFacts.mockRejectedValueOnce(new Error("index unavailable"));
  const repo = {
    getTaskMeta: async () => stored,
    applyCliFacts,
    getProjectRepository: async () => projects,
  } as unknown as TaskIndexRepo;
  await expect(registerImportedHistory(repo, imported)).rejects.toThrow("index unavailable");
  const recovered = await registerImportedHistory(repo, imported);
  expect(recovered.taskId).toBe(imported.sessionId);
  expect(projects.moveTask).toHaveBeenCalledWith({
    task: { taskId: imported.sessionId, workspacePath: imported.workspacePath },
    projectId: "project-new",
  });
  stored = { ...stored, title: "User renamed" };
  projectId = "user-project";
  expect((await registerImportedHistory(repo, imported)).title).toBe("User renamed");
  expect(applyCliFacts).toHaveBeenCalledTimes(2);
  expect(projects.moveTask).toHaveBeenCalledTimes(1);
});
