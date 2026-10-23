// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getGlobalMemory: vi.fn(),
  setGlobalMemorySessionEnabled: vi.fn(),
}));
vi.mock("@/hooks/useServices.js", () => ({
  useOptionalServices: () => ({ memoryService: mocks }),
  useServices: vi.fn(),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({ useWorkspaceServices: vi.fn() }));
import { useGlobalMemorySession } from "@/hooks/useZCodeSessionService.js";

describe("global memory session control", () => {
  it("does not apply an old toggle result to a newly selected session", async () => {
    mocks.getGlobalMemory.mockResolvedValue({ disabledSessionIds: [] });
    let finish!: (value: { disabledSessionIds: string[] }) => void;
    mocks.setGlobalMemorySessionEnabled.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ id }) => useGlobalMemorySession(id), {
      initialProps: { id: "first" },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.toggle();
    });
    expect(mocks.setGlobalMemorySessionEnabled).toHaveBeenCalledWith({
      sessionId: "first",
      enabled: false,
    });
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      finish({ disabledSessionIds: ["first"] });
      await pending;
    });
    expect(result.current.enabled).toBe(true);
    expect(result.current.busy).toBe(false);
  });
});
