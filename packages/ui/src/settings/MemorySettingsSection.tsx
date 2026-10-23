import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type IMemoryService,
  type GlobalMemorySnapshot,
  type ProjectMemoryWorkspaceSummary,
} from "@zcode/services";
import { TID_SETTINGS_MEMORY_SWITCH } from "@zcode/shared/test-ids";
import { runUserAction, runUserActionAsync } from "@/lib/userActionTelemetry.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  MemorySettingsViewer,
  type MemoryViewerLoadingState,
} from "@/settings/MemorySettingsViewer.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

type GlobalMemoryService = Pick<
  IMemoryService,
  "getGlobalMemory" | "updateGlobalMemory" | "setGlobalMemoryPreferences"
>;
type MemoryCatalogService = Pick<IMemoryService, "listProjectMemories"> &
  Partial<GlobalMemoryService>;

function normalizeWorkspaceDisplayName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "project";
}

function buildWorkspaceDisplayNameMap(names: readonly string[]): ReadonlyMap<string, string> {
  const matches = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const candidate of names) {
    const displayName = candidate.trim();
    const slug = normalizeWorkspaceDisplayName(displayName);
    if (!displayName || !slug || ambiguous.has(slug)) continue;
    const existing = matches.get(slug);
    if (existing && existing !== displayName) {
      matches.delete(slug);
      ambiguous.add(slug);
      continue;
    }
    matches.set(slug, displayName);
  }
  return matches;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MemorySettingsSection({
  memoryEnabled,
  memoryService,
  onMemoryEnabledChange,
  projectMemoryViewerAvailable,
  workspaceDisplayNames = [],
}: {
  memoryEnabled: boolean;
  memoryService: MemoryCatalogService;
  onMemoryEnabledChange: (enabled: boolean) => Promise<void>;
  projectMemoryViewerAvailable: boolean;
  workspaceDisplayNames?: readonly string[];
}) {
  const { intl } = useZCodeIntl();
  const catalogRequestIdRef = useRef(0);
  const [catalogState, setCatalogState] = useState<MemoryViewerLoadingState>("idle");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<ProjectMemoryWorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const refreshCatalog = useCallback(async (): Promise<ProjectMemoryWorkspaceSummary[] | null> => {
    const requestId = catalogRequestIdRef.current + 1;
    catalogRequestIdRef.current = requestId;
    setCatalogState("loading");
    setCatalogError(null);
    try {
      const result = await memoryService.listProjectMemories();
      if (catalogRequestIdRef.current !== requestId) {
        return null;
      }
      setWorkspaces(result);
      setCatalogState("ready");
      return result;
    } catch (error) {
      if (catalogRequestIdRef.current !== requestId) {
        return null;
      }
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      setCatalogError(getErrorMessage(error));
      setCatalogState("error");
      return null;
    }
  }, [memoryService]);

  useEffect(() => {
    if (memoryEnabled && projectMemoryViewerAvailable) {
      void refreshCatalog();
      return;
    }

    catalogRequestIdRef.current += 1;
    setCatalogState("idle");
    setCatalogError(null);
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
  }, [memoryEnabled, projectMemoryViewerAvailable, refreshCatalog]);

  const displayWorkspaces = useMemo(() => {
    const displayNameBySlug = buildWorkspaceDisplayNameMap(workspaceDisplayNames);
    const orderBySlug = new Map<string, number>();
    for (const [index, name] of workspaceDisplayNames.entries()) {
      const slug = normalizeWorkspaceDisplayName(name);
      if (!orderBySlug.has(slug)) orderBySlug.set(slug, index);
    }
    return workspaces
      .map((workspace, catalogIndex) => {
        const slug = normalizeWorkspaceDisplayName(workspace.label);
        return {
          catalogIndex,
          order: orderBySlug.get(slug) ?? Number.POSITIVE_INFINITY,
          workspace: {
            ...workspace,
            label: displayNameBySlug.get(slug) ?? workspace.label,
          },
        };
      })
      .sort((left, right) => left.order - right.order || left.catalogIndex - right.catalogIndex)
      .map(({ workspace }) => workspace);
  }, [workspaceDisplayNames, workspaces]);
  const selectedWorkspace = useMemo(
    () => displayWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [displayWorkspaces, selectedWorkspaceId],
  );

  useEffect(() => {
    const firstWorkspace = displayWorkspaces[0];
    if (!firstWorkspace) {
      setSelectedWorkspaceId(null);
      return;
    }
    if (
      !selectedWorkspaceId ||
      !displayWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(firstWorkspace.id);
    }
  }, [displayWorkspaces, selectedWorkspaceId]);

  const handleRefresh = useCallback(async () => {
    await runUserActionAsync({
      input: { featureId: "settings.memory", action: "refresh_memory", trigger: "button" },
      operation: refreshCatalog,
      completed: { resultSource: "platform_result" },
      failureStage: "catalog_refresh",
    });
  }, [refreshCatalog]);

  return (
    <div className="space-y-6">
      {projectMemoryViewerAvailable &&
      memoryService.getGlobalMemory &&
      memoryService.updateGlobalMemory &&
      memoryService.setGlobalMemoryPreferences ? (
        <GlobalMemorySettings service={memoryService as GlobalMemoryService} />
      ) : null}
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({
            id: "settings.memory.workspaceMemory",
          })}
          description={intl.formatMessage({
            id: "settings.memoryDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.memory.workspaceMemory",
              })}
              checked={memoryEnabled}
              data-testid={TID_SETTINGS_MEMORY_SWITCH}
              onCheckedChange={(checked) => {
                void onMemoryEnabledChange(checked);
              }}
            />
          }
        />
      </SettingsGroupCard>

      {!projectMemoryViewerAvailable ? (
        <div className="rounded-xl border border-dashed border-border bg-transparent px-4 py-8 text-center text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.memory.viewer.localOnly" })}
        </div>
      ) : !memoryEnabled ? null : (
        <MemorySettingsViewer
          catalogError={catalogError}
          catalogState={catalogState}
          selectedWorkspace={selectedWorkspace}
          workspaces={displayWorkspaces}
          onRefresh={handleRefresh}
          onScopeKeyChange={(workspaceId) =>
            runUserAction({
              input: {
                featureId: "settings.memory",
                action: "change_memory_scope",
                trigger: "select",
              },
              operation: () => setSelectedWorkspaceId(workspaceId),
              completed: { resultSource: "local_commit" },
              failureStage: "local_commit",
            })
          }
        />
      )}
    </div>
  );
}

function GlobalMemorySettings({ service }: { service: GlobalMemoryService }) {
  const { intl } = useZCodeIntl();
  const [snapshot, setSnapshot] = useState<GlobalMemorySnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (id: string, _fallback: string) => intl.formatMessage({ id });
  const accept = useCallback((value: GlobalMemorySnapshot) => {
    setSnapshot(value);
    setDraft(value.content);
  }, []);
  useEffect(() => {
    let active = true;
    service
      .getGlobalMemory()
      .then((value) => {
        if (active) accept(value);
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [service, accept]);
  const run = async (operation: () => Promise<GlobalMemorySnapshot>) => {
    setBusy(true);
    setError(null);
    try {
      accept(await operation());
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={label("settings.globalMemory.title", "Global memory · this profile")}
        description={label(
          "settings.globalMemory.description",
          "Stable preferences and feedback shared across projects. Background context only; never save passwords or keys.",
        )}
        control={
          <Switch
            disabled={busy || !snapshot}
            checked={snapshot?.enabled ?? true}
            aria-label={label("settings.globalMemory.enabled", "Enable global memory")}
            onCheckedChange={(enabled) => {
              void run(() => service.setGlobalMemoryPreferences({ enabled }));
            }}
          />
        }
      />
      <SettingsRow
        label={label("settings.globalMemory.record", "Automatically record stable preferences")}
        control={
          <Switch
            disabled={busy || !snapshot}
            checked={snapshot?.extractionEnabled ?? true}
            aria-label={label(
              "settings.globalMemory.record",
              "Automatically record stable preferences",
            )}
            onCheckedChange={(extractionEnabled) => {
              void run(() => service.setGlobalMemoryPreferences({ extractionEnabled }));
            }}
          />
        }
      />
      <div className="space-y-3 px-4 py-3">
        <label
          className="block text-ui-caption text-foreground-subtle"
          htmlFor="global-memory-content"
        >
          {label(
            "settings.globalMemory.content",
            "Memory Markdown, including source, timestamp and global scope",
          )}
        </label>
        <textarea
          id="global-memory-content"
          className="min-h-40 w-full rounded-lg border border-border bg-transparent p-3 text-ui-base"
          value={draft}
          disabled={busy || !snapshot}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex flex-wrap gap-3 text-ui-base">
          <button
            type="button"
            disabled={busy || !snapshot}
            onClick={() => {
              if (snapshot)
                void run(() =>
                  service.updateGlobalMemory({
                    content: draft,
                    expectedGeneration: snapshot.generation,
                  }),
                );
            }}
          >
            {label("settings.globalMemory.save", "Save")}
          </button>
          <button
            type="button"
            disabled={busy || !snapshot}
            onClick={() => {
              if (snapshot)
                void run(() =>
                  service.updateGlobalMemory({
                    content: "",
                    expectedGeneration: snapshot.generation,
                  }),
                );
            }}
          >
            {label("settings.globalMemory.delete", "Delete all global memory")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(() => service.getGlobalMemory());
            }}
          >
            {label("settings.globalMemory.refresh", "Refresh")}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-ui-caption text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsGroupCard>
  );
}
