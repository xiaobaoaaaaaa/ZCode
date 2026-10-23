import { basename } from "node:path";
import type { ZCodeOfficialHistoryImportResult, ZCodeTaskMeta } from "@zcode/shared";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";

/** CLI commit is the durable checkpoint. Retrying repairs only missing index/project membership. */
export async function registerImportedHistory(
  repo: TaskIndexRepo,
  imported: ZCodeOfficialHistoryImportResult,
): Promise<ZCodeTaskMeta> {
  const existingMeta = await repo.getTaskMeta({
    workspacePath: imported.workspacePath,
    taskId: imported.sessionId,
  });
  const meta =
    existingMeta ??
    (await repo.applyCliFacts({
      meta: {
        taskId: imported.sessionId,
        traceId: `official_import_${imported.sessionId}`,
        title: imported.title,
        workspacePath: imported.workspacePath,
        createdAt: imported.createdAt,
        updatedAt: imported.updatedAt,
        mode: "build",
        provider: "glm",
      },
      titleSource: "custom",
      lastOutcome: "completed",
    }));
  const projects = await repo.getProjectRepository();
  const task = { taskId: meta.taskId, workspacePath: meta.workspacePath };
  if (!projects.resolveSessionDirectories(task).projectId) {
    const existing = projects
      .readTree()
      .projects.find((project) =>
        project.roots.some((root) => root.rootPath === meta.workspacePath),
      );
    const project =
      existing ??
      projects.saveProject({
        name: basename(meta.workspacePath) || meta.workspacePath,
        roots: [meta.workspacePath],
        primaryRoot: meta.workspacePath,
      });
    projects.moveTask({ task, projectId: project.id });
  }
  return meta;
}
