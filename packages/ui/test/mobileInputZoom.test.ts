// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LexicalChatInput,
  type LexicalChatInputHandle,
  shouldResetLexicalEditorAfterSubmit,
  shouldSubmitLexicalEnter,
  shouldSubmitLexicalModifiedEnter,
} from "@/LexicalChatInput.js";
import {
  isPrimaryFollowupModifierPressed,
  resolveOppositeFollowupDelivery,
  resolveFollowupModifierTooltip,
  shouldEnableModifiedEnterSubmit,
  shouldReverseFollowupDeliveryForPointer,
} from "@/v4/composer/followupModeSettings.js";
import {
  resolveChatEnterShortcut,
  resolveChatEnterSubmits,
  shouldAvoidIosInputFocusZoom,
} from "@/lib/mobileTextInput.js";

// 保留真实 Lexical 键盘链路；只隔离本测试不使用的目录服务与会话上下文。
vi.mock("@/SlashCommandPlugin.js", () => ({ SlashCommandPlugin: () => null }));
vi.mock("@/v4/activeTaskProvider.js", () => ({ useChatViewActiveTaskProvider: () => null }));
vi.mock("@/hooks/useSettingService.js", () => ({ useSettings: () => ({ settings: {} }) }));
afterEach(cleanup);

describe("follow-up keyboard delivery", () => {
  const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  beforeAll(() => {
    // jsdom 不实现 Range 布局；Lexical 提交选区需要这个浏览器几何接口。
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 0, 0, 0),
    });
  });
  afterAll(() => {
    if (rangeRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeRect);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });
  for (const mode of ["guide", "queue"] as const) {
    it(`${mode}: Enter uses the default and Ctrl/Meta+Enter uses the opposite without changing it`, async () => {
      const api = { current: null as LexicalChatInputHandle | null };
      const submit = vi.fn();
      render(
        createElement(LexicalChatInput, {
          workspacePath: "/keyboard-test",
          taskId: null,
          enableMentionPanel: false,
          editorApiRef: api,
          onSubmit: (text) => {
            submit(text, mode);
          },
          onModifiedSubmit: (text) => {
            submit(text, resolveOppositeFollowupDelivery(mode));
          },
        }),
      );
      const input = screen.getByRole("textbox");
      for (const modifier of ["none", "ctrl", "meta", "none"] as const) {
        await act(async () => {
          api.current!.appendText(`message-${modifier}`);
        });
        fireEvent.keyDown(input, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          ctrlKey: modifier === "ctrl",
          metaKey: modifier === "meta",
        });
        expect(submit).toHaveBeenLastCalledWith(
          `message-${modifier}`,
          modifier === "none" ? mode : mode === "guide" ? "queue" : "guide",
        );
        await act(async () => {});
      }
      expect(submit).toHaveBeenCalledTimes(4);
      for (const event of [
        { shiftKey: true },
        { shiftKey: true, ctrlKey: true },
        { isComposing: true, ctrlKey: true },
      ]) {
        await act(async () => {
          api.current!.clear();
          api.current!.appendText("draft");
        });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13, ...event });
      }
      expect(submit).toHaveBeenCalledTimes(4);
    });
  }
});

describe("mobile text input zoom guard", () => {
  it("keeps modified submit on desktop drafts and Windows coarse-pointer viewports", () => {
    expect(
      shouldEnableModifiedEnterSubmit({
        inputRoutingMode: "startNow",
        isMobileTextInputViewport: true,
        isWebRemoteControl: false,
      }),
    ).toBe(true);
    expect(
      shouldEnableModifiedEnterSubmit({
        inputRoutingMode: "enqueue",
        isMobileTextInputViewport: true,
        isWebRemoteControl: false,
      }),
    ).toBe(true);
    expect(
      shouldEnableModifiedEnterSubmit({
        inputRoutingMode: "enqueue",
        isMobileTextInputViewport: true,
        isWebRemoteControl: true,
      }),
    ).toBe(false);
    expect(
      shouldEnableModifiedEnterSubmit({
        inputRoutingMode: "reject",
        isMobileTextInputViewport: false,
        isWebRemoteControl: false,
      }),
    ).toBe(false);
  });

  it("resolves Cmd/Ctrl+Enter as guide for queue and queue for guide", () => {
    expect(resolveOppositeFollowupDelivery("queue")).toBe("guide");
    expect(resolveOppositeFollowupDelivery("guide")).toBe("queue");
    expect(
      shouldSubmitLexicalModifiedEnter({
        ctrlKey: true,
        modifiedEnterSubmits: true,
        text: "opposite delivery",
      }),
    ).toBe(true);
    expect(
      shouldSubmitLexicalModifiedEnter({
        metaKey: true,
        modifiedEnterSubmits: true,
        text: "opposite delivery",
      }),
    ).toBe(true);
    expect(
      shouldSubmitLexicalModifiedEnter({
        ctrlKey: true,
        isComposing: true,
        modifiedEnterSubmits: true,
        text: "IME",
      }),
    ).toBe(false);
    expect(
      shouldSubmitLexicalModifiedEnter({
        ctrlKey: true,
        modifiedEnterSubmits: true,
        shiftKey: true,
        text: "keep newline",
      }),
    ).toBe(false);
  });

  it("only clears the Lexical editor when the submit callback accepts the clear", () => {
    expect(shouldResetLexicalEditorAfterSubmit()).toBe(true);
    expect(shouldResetLexicalEditorAfterSubmit(true)).toBe(true);
    expect(shouldResetLexicalEditorAfterSubmit(false)).toBe(false);
  });

  it("only reverses pointer delivery for an enabled desktop modifier click", () => {
    expect(
      shouldReverseFollowupDeliveryForPointer({ enabled: true, metaKey: true, ctrlKey: false }),
    ).toBe(true);
    expect(
      shouldReverseFollowupDeliveryForPointer({ enabled: true, metaKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(
      shouldReverseFollowupDeliveryForPointer({ enabled: true, metaKey: false, ctrlKey: false }),
    ).toBe(false);
    expect(
      shouldReverseFollowupDeliveryForPointer({ enabled: false, metaKey: true, ctrlKey: false }),
    ).toBe(false);
  });

  it("resolves the automatic opposite-action tooltip with a platform shortcut", () => {
    expect(
      resolveFollowupModifierTooltip({
        enabled: true,
        canSend: true,
        modifierPressed: true,
        followupMode: "queue",
        isApplePlatform: true,
      }),
    ).toEqual({
      delivery: "guide",
      shortcut: "⌘ + Enter",
      titleId: "chat.followup.guideCurrent",
    });
    expect(
      resolveFollowupModifierTooltip({
        enabled: true,
        canSend: true,
        modifierPressed: true,
        followupMode: "guide",
        isApplePlatform: false,
      }),
    ).toEqual({
      delivery: "queue",
      shortcut: "Ctrl + Enter",
      titleId: "chat.followup.addToQueue",
    });
    expect(
      resolveFollowupModifierTooltip({
        enabled: true,
        canSend: false,
        modifierPressed: true,
        followupMode: "queue",
        isApplePlatform: true,
      }),
    ).toBeNull();
  });

  it("tracks only the platform primary follow-up modifier", () => {
    expect(
      isPrimaryFollowupModifierPressed({ isApplePlatform: true, metaKey: true, ctrlKey: false }),
    ).toBe(true);
    expect(
      isPrimaryFollowupModifierPressed({ isApplePlatform: true, metaKey: false, ctrlKey: true }),
    ).toBe(false);
    expect(
      isPrimaryFollowupModifierPressed({ isApplePlatform: false, metaKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(
      isPrimaryFollowupModifierPressed({ isApplePlatform: false, metaKey: true, ctrlKey: false }),
    ).toBe(false);
  });

  it("keeps Enter as newline for mobile web remote control only", () => {
    const mobileRemoteEnterSubmits = resolveChatEnterSubmits({
      isMobileTextInputViewport: true,
      preferEnterNewline: true,
    });

    expect(mobileRemoteEnterSubmits).toBe(false);
    expect(resolveChatEnterShortcut({ enterSubmits: mobileRemoteEnterSubmits })).toBeUndefined();
    expect(
      shouldSubmitLexicalEnter({
        enterSubmits: mobileRemoteEnterSubmits,
        text: "first line",
      }),
    ).toBe(false);
    expect(
      resolveChatEnterSubmits({
        isMobileTextInputViewport: false,
        preferEnterNewline: true,
      }),
    ).toBe(true);
  });

  it("desktop viewports and non-remote inputs do not enable the zoom guard", () => {
    expect(
      shouldAvoidIosInputFocusZoom({
        isMobileTextInputViewport: false,
        isWebRemoteControl: true,
      }),
    ).toBe(false);
    expect(
      shouldAvoidIosInputFocusZoom({
        isMobileTextInputViewport: true,
        isWebRemoteControl: false,
      }),
    ).toBe(false);
  });

  it("enables the zoom guard for mobile remote input", () => {
    expect(
      shouldAvoidIosInputFocusZoom({
        isMobileTextInputViewport: true,
        isWebRemoteControl: true,
      }),
    ).toBe(true);
  });
});
