import { createCoreError, CoreErrorType, type ModelSelection } from "../deps.js";
import { cloneModelSelection } from "../model-selection.js";
import type { EffectiveModelSelectionResult } from "@zcode/shared/model-selection";

const SUBAGENT_SELECTION_MESSAGES = {
  "selection-missing": "No model selected / 未选择模型",
  "account-connection-unavailable": "Account connection unavailable / 当前账号连接不可用",
  "provider-not-found": "Provider unavailable / 供应商不存在或不可用",
  "model-not-found": "Model unavailable / 模型不存在或不可用",
  "reasoning-level-missing": "No reasoning level selected / 未选择思考档位",
  "reasoning-level-not-supported": "Reasoning level unsupported / 不支持所选思考档位",
} satisfies Record<NonNullable<EffectiveModelSelectionResult["selectionIssue"]>, string>;

/** 显式 profile 是待解析意图；继承与内部 override 已有执行归属，不重新对应账号。 */
export function resolveSubagentSelection(input: {
  mainAgentModelPolicy?: import("@zcode/shared").MainAgentModelPolicy;
  proposedModel?: string;
  catalog?: readonly import("@zcode/contracts").ModelCatalogEntry[];
  profileSelection?: ModelSelection | null;
  parentSelection?: ModelSelection | null;
  overrideSelection?: ModelSelection;
  resolveSelection?: (selection: ModelSelection) => EffectiveModelSelectionResult;
}): { hasConcreteModel: boolean; selection: ModelSelection; modelSelectionReason: string } {
  let suggested: ModelSelection | undefined;
  let modelSelectionReason = "Inherited current parent model / 沿用当前主模型";
  if (input.mainAgentModelPolicy?.enabled && !input.profileSelection && !input.overrideSelection) {
    const allowed = input.mainAgentModelPolicy.allowedModels.find(
      (model) => `${model.providerId}/${model.modelId}` === input.proposedModel,
    );
    const available =
      allowed &&
      input.catalog?.find(
        (model) =>
          model.providerId === allowed.providerId &&
          model.modelId === allowed.modelId &&
          !model.disabledReason,
      );
    const resolved = available && allowed && input.resolveSelection?.(cloneModelSelection(allowed));
    if (
      resolved &&
      !resolved.selectionIssue &&
      resolved.effectiveSelection?.providerId === allowed?.providerId &&
      resolved.effectiveSelection?.modelId === allowed?.modelId
    ) {
      suggested = resolved.effectiveSelection;
      modelSelectionReason = "Main agent selected an allowed model / 主智能体选择已允许模型";
    } else {
      modelSelectionReason = !input.proposedModel
        ? "No model proposed; inherited parent / 未指定模型，沿用主模型"
        : !allowed
          ? "Model not allowed; inherited parent / 模型未获允许，沿用主模型"
          : "Allowed model unavailable; inherited parent / 已允许模型不可用，沿用主模型";
    }
  } else if (input.overrideSelection) {
    modelSelectionReason = "Active execution binding / 当前执行绑定";
  } else if (input.profileSelection) {
    modelSelectionReason = "Manual agent model takes precedence / 手动指定优先";
  } else if (input.proposedModel) {
    modelSelectionReason =
      "Main-agent selection disabled; inherited parent / 主智能体选择已关闭，沿用主模型";
  }
  const explicit = input.profileSelection ?? suggested;
  const result: EffectiveModelSelectionResult = input.overrideSelection
    ? { effectiveSelection: input.overrideSelection }
    : suggested
      ? { effectiveSelection: suggested }
      : explicit
        ? input.resolveSelection
          ? input.resolveSelection(cloneModelSelection(explicit))
          : { effectiveSelection: explicit }
        : { effectiveSelection: input.parentSelection ?? null };
  if (!result.effectiveSelection || result.selectionIssue) {
    const reason = result.selectionIssue ?? "selection-missing";
    const requested = input.overrideSelection ?? explicit ?? input.parentSelection;
    const identity = requested ? `; selection=${requested.providerId}/${requested.modelId}` : "";
    // 解析失败不能落回父模型，否则会悄悄改变用户显式指定的子任务模型。
    // 公共错误投影不读取结构化字段（只有 selectionIssue 时消费方看不到）；后台也只保留 message。
    // 因此同时给既有 reason 和消息补上原因，两个消费路径都能定位，不增加专用错误协议。
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      `Cannot start subagent: ${SUBAGENT_SELECTION_MESSAGES[reason]} [reason=${reason}${identity}]`,
      {
        recoverable: true,
        context: {
          selectionIssue: reason,
          reason,
          ...(result.effectiveSelection
            ? {
                providerId: result.effectiveSelection.providerId,
                modelId: result.effectiveSelection.modelId,
              }
            : {}),
        },
      },
    );
  }
  return {
    modelSelectionReason,
    hasConcreteModel: explicit != null,
    selection: cloneModelSelection(result.effectiveSelection),
  };
}
