import { useCallback, useMemo, useState } from "react";
import type { ModelSelection } from "@zcode/shared/model-selection";
import { submissionModeSchema } from "@zcode/shared/zcode-protocol-v4";
import { useModelSelectionView } from "@/hooks/useModelSelectionView.js";
import { useComposerClientNamespace } from "@/hooks/useServices.js";
import {
  readComposerRecent,
  isSelectionInView,
  prepareComposerRecentReceipt,
  acceptComposerRecentReceipt,
} from "@/lib/composerRecent.js";
import { useAssistantPreferences } from "@/store/workspaceAssistantDraft.js";
import {
  V4ComposerModeSwitch,
  V4ComposerModelControls,
  type V4ComposerToolbarProps,
} from "@/v4/composer/V4ComposerToolbar.js";
import { resolveComposerScope } from "@/v4/composer/composerDraftStore.js";
import {
  resolveV4ComposerConfigPickerState,
  type V4ComposerConfigPicker,
} from "@/v4/composer/configPickerState.js";

export function useAssistantSubmissionControls(
  path: string,
  identity: string | undefined,
  projectId: string | undefined,
  disabled: boolean,
) {
  const workspaceKey = identity?.trim() || path;
  const clientNamespace = useComposerClientNamespace();
  const recent = useMemo(
    () =>
      readComposerRecent(
        path,
        identity,
        undefined,
        resolveComposerScope(projectId, identity, clientNamespace),
      ),
    [clientNamespace, identity, path, projectId],
  );
  const { values, update } = useAssistantPreferences(workspaceKey, projectId);
  const requested = values.modelSelection ?? recent?.modelSelection;
  // 普通会话的 build 是「变更前确认」。助手独立派发默认自主模式，显式权限由本项目助手偏好恢复。
  const permissionMode = values.permissionMode ?? "guarded";
  const read = useModelSelectionView(
    path,
    undefined,
    identity,
    undefined,
    requested ? { selection: requested } : undefined,
  );
  const view = read.state.status === "ready" ? read.state.view : null;
  const selection = requested ? (view?.effectiveSelection ?? requested) : view?.preferredSelection;
  const [picker, setPicker] = useState<V4ComposerConfigPicker | null>(null);
  const onSwitchMode = useCallback(
    (value: string) => {
      const parsed = submissionModeSchema.safeParse(value);
      if (parsed.success && parsed.data !== "plan") update({ permissionMode: parsed.data });
    },
    [update],
  );
  const persistModel = (selection: ModelSelection) => update({ modelSelection: selection });
  const props: V4ComposerToolbarProps = {
    workspacePath: path,
    workspaceIdentity: identity,
    sessionId: null,
    phase: null,
    usage: null,
    draftMode: true,
    modelSelectionView: view,
    modelSelectionState: read.state,
    modelSelectionReload: read.reload,
    modelSelectionRefresh: read.refresh,
    draftConfig: { modelSelection: selection, mode: permissionMode },
    disabled,
    activeConfigPicker: picker,
    onConfigPickerOpenChange: (id, open) =>
      setPicker((current) => resolveV4ComposerConfigPickerState(current, id, open)),
    onSelectModel: (provider, model, _source, effort) => {
      const providerId = provider || selection?.providerId;
      if (providerId)
        persistModel({
          providerId,
          modelId: model,
          ...(effort ? { options: { reasoningLevel: effort } } : {}),
        });
    },
    onSelectThought: (effort, model) =>
      persistModel({
        providerId: model.provider,
        modelId: model.model,
        options: { reasoningLevel: effort },
      }),
    onSwitchMode,
  };
  return {
    modelSelection: selection,
    prepareAcceptedPreference() {
      if (!view || !selection || !isSelectionInView(view, selection)) return undefined;
      const receipt = prepareComposerRecentReceipt(
        resolveComposerScope(projectId, identity, clientNamespace),
        { modelSelection: selection, mode: permissionMode },
      );
      return () => {
        acceptComposerRecentReceipt(receipt);
      };
    },
    modelReady: Boolean(
      view && selection && !view.selectionIssue && isSelectionInView(view, selection),
    ),
    permissionMode,
    controls: (
      <div
        data-testid="workspace-assistant-controls"
        className="flex min-w-0 flex-wrap items-center gap-1"
      >
        <V4ComposerModeSwitch {...props} planMode="fixed" inputTestId="workspace-assistant-input" />
        <V4ComposerModelControls {...props} />
      </div>
    ),
  };
}
