import type Database from "better-sqlite3";
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  preferenceInputSchema,
  preferencesSchema,
  type PreferenceInput,
  type WorkspacePreferences,
} from "../../domain/preferences.js";

export function readPreferences(
  database: Database.Database,
): WorkspacePreferences {
  const row = database
    .prepare("SELECT * FROM workspace_preferences WHERE id = 1")
    .get() as Record<string, unknown> | undefined;
  if (!row) return structuredClone(DEFAULT_PREFERENCES);
  const boolean = (key: string): boolean => {
    if (row[key] !== 0 && row[key] !== 1)
      throw new Error("Invalid workspace preferences");
    return row[key] === 1;
  };
  return preferencesSchema.parse({
    theme: row.theme,
    showExamples: boolean("show_examples"),
    initialized: boolean("initialized"),
    collapsedSections: {
      Pinned: boolean("collapsed_pinned"),
      Projects: boolean("collapsed_projects"),
      Archive: boolean("collapsed_archive"),
      Examples: boolean("collapsed_examples"),
    },
  });
}

export function writePreferences(
  database: Database.Database,
  value: WorkspacePreferences,
): void {
  const p = preferencesSchema.parse(value);
  database
    .prepare(
      `INSERT INTO workspace_preferences (id, theme, show_examples, collapsed_pinned, collapsed_projects, collapsed_archive, collapsed_examples, initialized)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET theme=excluded.theme, show_examples=excluded.show_examples,
    collapsed_pinned=excluded.collapsed_pinned, collapsed_projects=excluded.collapsed_projects, collapsed_archive=excluded.collapsed_archive,
    collapsed_examples=excluded.collapsed_examples, initialized=excluded.initialized`,
    )
    .run(
      p.theme,
      +p.showExamples,
      +p.collapsedSections.Pinned,
      +p.collapsedSections.Projects,
      +p.collapsedSections.Archive,
      +p.collapsedSections.Examples,
      +p.initialized,
    );
}

export function updatePreferences(
  database: Database.Database,
  input: PreferenceInput,
  initialize = false,
): WorkspacePreferences {
  const patch = preferenceInputSchema.parse(input);
  return database.transaction(() => {
    const current = readPreferences(database);
    if (initialize && current.initialized) return current;
    const next = { ...mergePreferences(current, patch), initialized: true };
    writePreferences(database, next);
    return next;
  })();
}
