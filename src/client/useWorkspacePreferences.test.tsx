// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  type PreferenceInput,
  type WorkspacePreferences,
} from "../domain/preferences.js";
import { useWorkspacePreferences } from "./useWorkspacePreferences.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function apiFixture(
  initial: WorkspacePreferences = { ...DEFAULT_PREFERENCES, initialized: true },
) {
  let saved = structuredClone(initial);
  return {
    getPreferences: vi.fn(async () => saved),
    initializePreferences: vi.fn(
      async (input: PreferenceInput) =>
        (saved = { ...mergePreferences(saved, input), initialized: true }),
    ),
    updatePreferences: vi.fn(
      async (input: PreferenceInput) =>
        (saved = mergePreferences(saved, input)),
    ),
  };
}
beforeEach(() => {
  localStorage.clear();
  delete window.__THREADSTR_PREFERENCES__;
});

it("preserves the prepaint snapshot and blocks writes until the database is loaded", async () => {
  const saved = {
    ...DEFAULT_PREFERENCES,
    initialized: true,
    theme: "dark" as const,
  };
  window.__THREADSTR_PREFERENCES__ = saved;
  const read = deferred<WorkspacePreferences>();
  const api = apiFixture(saved);
  api.getPreferences.mockImplementationOnce(() => read.promise);
  const { result } = renderHook(() => useWorkspacePreferences(api));
  expect(result.current.preferences.theme).toBe("dark");
  act(() => result.current.update({ theme: "light" }));
  expect(api.updatePreferences).not.toHaveBeenCalled();
  expect(result.current.warning).toContain("finish loading");
  await act(async () => read.reject(new Error("Offline")));
  expect(result.current.preferences.theme).toBe("dark");
  expect(result.current.warning).toContain("could not be loaded");
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.warning).toBe(""));
  act(() => result.current.update({ theme: "neutral" }));
  await waitFor(() => expect(result.current.preferences.theme).toBe("neutral"));
  expect(api.updatePreferences).toHaveBeenCalledWith({ theme: "neutral" });
});

it("retains failed fields when another queued preference saves, then retries only failed fields", async () => {
  const api = apiFixture();
  const failed = deferred<WorkspacePreferences>();
  api.updatePreferences.mockImplementationOnce(() => failed.promise);
  const { result } = renderHook(() => useWorkspacePreferences(api));
  await waitFor(() =>
    expect(result.current.preferences.initialized).toBe(true),
  );
  act(() => {
    result.current.update({ theme: "dark" });
    result.current.update({ collapsedSections: { Projects: true } });
  });
  await act(async () => failed.reject(new Error("Offline")));
  await waitFor(() =>
    expect(result.current.preferences.collapsedSections.Projects).toBe(true),
  );
  expect(result.current.preferences.theme).toBe("light");
  expect(result.current.warning).toContain("could not be saved");
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.warning).toBe(""));
  expect(api.updatePreferences).toHaveBeenLastCalledWith({ theme: "dark" });
  expect(result.current.preferences).toMatchObject({
    theme: "dark",
    collapsedSections: { Projects: true },
  });
});

it("discards a failed preference intent when a newer value for that field saves", async () => {
  const api = apiFixture();
  api.updatePreferences.mockRejectedValueOnce(new Error("Offline"));
  const { result } = renderHook(() => useWorkspacePreferences(api));
  await waitFor(() =>
    expect(result.current.preferences.initialized).toBe(true),
  );
  act(() => {
    result.current.update({ theme: "dark" });
    result.current.update({ theme: "neutral" });
  });
  await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.preferences.theme).toBe("neutral"));
  expect(result.current.warning).toBe("");
});

it("ignores older focus responses when they finish after a newer refresh", async () => {
  const api = apiFixture();
  const { result } = renderHook(() => useWorkspacePreferences(api));
  await waitFor(() =>
    expect(result.current.preferences.initialized).toBe(true),
  );
  const older = deferred<WorkspacePreferences>();
  const newer = deferred<WorkspacePreferences>();
  api.getPreferences
    .mockImplementationOnce(() => older.promise)
    .mockImplementationOnce(() => newer.promise);
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await act(async () =>
    newer.resolve({ ...DEFAULT_PREFERENCES, initialized: true, theme: "dark" }),
  );
  await act(async () =>
    older.resolve({
      ...DEFAULT_PREFERENCES,
      initialized: true,
      theme: "neutral",
    }),
  );
  expect(result.current.preferences.theme).toBe("dark");
});

it("keeps legacy settings after initialization failure and removes them only after a successful retry", async () => {
  localStorage.setItem("on-track-theme", "dark");
  const api = apiFixture(DEFAULT_PREFERENCES);
  api.initializePreferences.mockRejectedValueOnce(new Error("Offline"));
  const { result } = renderHook(() => useWorkspacePreferences(api));
  await waitFor(() =>
    expect(result.current.warning).toContain("could not be loaded"),
  );
  expect(localStorage.getItem("on-track-theme")).toBe("dark");
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.warning).toBe(""));
  expect(result.current.preferences.theme).toBe("dark");
  expect(localStorage.getItem("on-track-theme")).toBeNull();
});

it("invalidates outstanding writes across database replacement and adopts restored preferences", async () => {
  const api = apiFixture();
  const { result } = renderHook(() => useWorkspacePreferences(api));
  await waitFor(() =>
    expect(result.current.preferences.initialized).toBe(true),
  );
  const write = deferred<WorkspacePreferences>();
  api.updatePreferences.mockImplementationOnce(() => write.promise);
  act(() => result.current.update({ theme: "neutral" }));
  await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledOnce());
  let paused!: Promise<void>;
  act(() => {
    paused = result.current.pause();
  });
  await act(async () => {
    write.resolve({
      ...DEFAULT_PREFERENCES,
      initialized: true,
      theme: "neutral",
    });
    await paused;
  });
  api.getPreferences.mockResolvedValue({
    ...DEFAULT_PREFERENCES,
    initialized: true,
    theme: "dark",
  });
  await act(async () => result.current.resume());
  expect(result.current.preferences.theme).toBe("dark");
  expect(api.updatePreferences).toHaveBeenCalledOnce();
});
