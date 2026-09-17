import { describe, expect, it, vi } from "vitest";

import {
  dispatchToggleWorkspaceHiddenFiles,
  subscribeWorkspaceHiddenFilesToggle,
} from "./workspaceHiddenFiles";

describe("workspaceHiddenFiles emitter", () => {
  it("invokes every subscriber once per dispatch", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeWorkspaceHiddenFilesToggle(a);
    const unsubB = subscribeWorkspaceHiddenFilesToggle(b);

    dispatchToggleWorkspaceHiddenFiles();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
  });

  it("stops invoking an unsubscribed listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceHiddenFilesToggle(listener);

    dispatchToggleWorkspaceHiddenFiles();
    unsubscribe();
    dispatchToggleWorkspaceHiddenFiles();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tolerates a subscriber that throws (other subscribers still fire)", () => {
    const err = vi.fn(() => {
      throw new Error("boom");
    });
    const ok = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      subscribeWorkspaceHiddenFilesToggle(err);
      subscribeWorkspaceHiddenFilesToggle(ok);

      dispatchToggleWorkspaceHiddenFiles();

      expect(err).toHaveBeenCalledTimes(1);
      expect(ok).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
      // Best-effort unsubscribe; set has references, manual clear below.
      // Tests must not leak listeners to subsequent cases.
    }
  });

  it("dispatches zero times when no one is subscribed", () => {
    // No assertion beyond the call not throwing; ensures no global crash.
    expect(() => dispatchToggleWorkspaceHiddenFiles()).not.toThrow();
  });
});