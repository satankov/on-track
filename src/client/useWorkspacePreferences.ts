import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ApiClient } from "./api.js";
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  preferencesSchema,
  type PreferenceInput,
  type WorkspacePreferences,
} from "../domain/preferences.js";
import { applyTheme } from "./theme.js";
import {
  clearLegacyPreferences,
  readLegacyPreferences,
} from "./preferences.js";

declare global {
  interface Window {
    __THREADSTR_PREFERENCES__?: WorkspacePreferences;
  }
}

export function useWorkspacePreferences(
  api: Pick<
    ApiClient,
    "getPreferences" | "initializePreferences" | "updatePreferences"
  >,
) {
  const [preferences, setPreferences] = useState(() => {
    const snapshot = preferencesSchema.safeParse(
      window.__THREADSTR_PREFERENCES__,
    );
    const initial = snapshot.success ? snapshot.data : DEFAULT_PREFERENCES;
    return initial.initialized
      ? initial
      : mergePreferences(initial, readLegacyPreferences());
  });
  const [warning, setWarning] = useState("");
  const current = useRef(preferences);
  const confirmed = useRef(preferences);
  const ready = useRef(false);
  const suspended = useRef(false);
  const generation = useRef(0);
  const refreshRequest = useRef(0);
  const change = useRef(0);
  const pending = useRef(0);
  const tail = useRef<Promise<void>>(Promise.resolve());
  const retryInput = useRef<PreferenceInput | undefined>(undefined);
  const adopt = useCallback((value: WorkspacePreferences) => {
    current.current = value;
    setPreferences(value);
  }, []);
  useLayoutEffect(() => applyTheme(preferences.theme), [preferences.theme]);

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    const revision = change.current;
    const request = ++refreshRequest.current;
    try {
      let result = preferencesSchema.parse(await api.getPreferences());
      if (epoch !== generation.current || request !== refreshRequest.current)
        return;
      if (!result.initialized)
        result = preferencesSchema.parse(
          await api.initializePreferences(readLegacyPreferences()),
        );
      if (
        epoch !== generation.current ||
        revision !== change.current ||
        request !== refreshRequest.current
      )
        return;
      clearLegacyPreferences();
      ready.current = true;
      confirmed.current = result;
      adopt(result);
      setWarning("");
    } catch {
      if (
        epoch === generation.current &&
        revision === change.current &&
        request === refreshRequest.current
      )
        setWarning(
          "Preferences could not be loaded. Retry to recover your saved settings.",
        );
    }
  }, [api, adopt]);

  useEffect(() => {
    const lifetime = generation;
    void Promise.resolve().then(refresh);
    const focus = () => {
      if (!suspended.current && !pending.current && !retryInput.current)
        void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      lifetime.current++;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  const update = useCallback(
    (input: PreferenceInput) => {
      if (!ready.current || suspended.current) {
        setWarning(
          "Wait for preferences to finish loading before changing them.",
        );
        return;
      }
      const epoch = generation.current;
      const revision = ++change.current;
      pending.current++;
      adopt(mergePreferences(current.current, input));
      tail.current = tail.current.then(async () => {
        try {
          if (epoch !== generation.current) return;
          const saved = preferencesSchema.parse(
            await api.updatePreferences(input),
          );
          if (epoch !== generation.current) return;
          confirmed.current = saved;
          if (retryInput.current) {
            const remaining = {
              ...retryInput.current,
              collapsedSections: { ...retryInput.current.collapsedSections },
            };
            if (input.theme !== undefined) delete remaining.theme;
            if (input.showExamples !== undefined) delete remaining.showExamples;
            for (const key of Object.keys(
              input.collapsedSections ?? {},
            ) as Array<keyof WorkspacePreferences["collapsedSections"]>)
              delete remaining.collapsedSections[key];
            if (!Object.keys(remaining.collapsedSections).length)
              delete (remaining as PreferenceInput).collapsedSections;
            retryInput.current = Object.keys(remaining).length
              ? remaining
              : undefined;
          }
          if (revision === change.current) adopt(saved);
          if (!retryInput.current) setWarning("");
        } catch {
          if (epoch === generation.current) {
            if (revision === change.current) adopt(confirmed.current);
            retryInput.current = {
              ...retryInput.current,
              ...input,
              collapsedSections: {
                ...retryInput.current?.collapsedSections,
                ...input.collapsedSections,
              },
            };
            setWarning(
              "Preferences could not be saved. Your last saved settings are shown. Retry to save your change.",
            );
          }
        } finally {
          pending.current--;
        }
      });
    },
    [api, adopt],
  );

  return {
    preferences,
    warning,
    update,
    retry: () =>
      retryInput.current ? update(retryInput.current) : void refresh(),
    pause: async () => {
      suspended.current = true;
      generation.current++;
      await tail.current;
    },
    resume: async () => {
      suspended.current = false;
      retryInput.current = undefined;
      await refresh();
    },
  };
}
