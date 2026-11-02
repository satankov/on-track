import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  defaultProjectLabels,
  isBuiltinLabel,
  labelConfigurationSchema,
  labelNameKey,
  type Label,
  type LabelConfiguration,
  type ProjectLabel,
} from "../../domain/labels.js";

export class LabelConfigurationConflictError extends Error {}
export class InvalidLabelConfigurationError extends Error {}
export interface ProjectLabelRow {
  chat_id: string;
  id: Label;
  name: string;
  name_key: string;
  symbol: string | null;
  enabled: number;
  position: number;
  builtin: number;
}
export function readProjectLabels(
  database: Database.Database,
  chatId: string,
): ProjectLabel[] {
  return (
    database
      .prepare(
        "SELECT * FROM project_labels WHERE chat_id = ? ORDER BY position",
      )
      .all(chatId) as ProjectLabelRow[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    position: row.position,
  }));
}
export function insertProjectLabel(
  database: Database.Database,
  chatId: string,
  label: ProjectLabel,
): void {
  database
    .prepare(
      "INSERT INTO project_labels (chat_id,id,name,name_key,symbol,enabled,position,builtin) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      chatId,
      label.id,
      label.name,
      labelNameKey(label.name),
      label.symbol,
      +label.enabled,
      label.position,
      +label.builtin,
    );
}
export function seedProjectLabels(
  database: Database.Database,
  chatId: string,
  enabled?: readonly string[],
): void {
  for (const label of defaultProjectLabels(enabled))
    insertProjectLabel(database, chatId, label);
}

/** Inside the project update transaction; omission removes custom labels and their tags. */
export function saveProjectLabels(
  database: Database.Database,
  chatId: string,
  input: LabelConfiguration,
): void {
  const config = labelConfigurationSchema.parse(input);
  const version = database
    .prepare("SELECT label_configuration_revision FROM chats WHERE id=?")
    .pluck()
    .get(chatId);
  if (version !== config.revision)
    throw new LabelConfigurationConflictError(
      "Project labels changed in another window. Reload the project before saving.",
    );
  const previous = readProjectLabels(database, chatId);
  const previousIds = new Set(previous.map((label) => label.id));
  if (
    previous.some(
      (label) =>
        label.builtin && !config.labels.some((next) => next.id === label.id),
    ) ||
    config.labels.some((label) => label.id && !previousIds.has(label.id))
  )
    throw new InvalidLabelConfigurationError(
      "Reload the project before editing its labels.",
    );
  const next: ProjectLabel[] = config.labels.map((label, position) => ({
    ...label,
    id: label.id ?? `custom-${randomUUID()}`,
    builtin: Boolean(label.id && isBuiltinLabel(label.id)),
    position,
  }));
  if (
    next.length === previous.length &&
    next.every((label, index) => {
      const old = previous[index]!;
      return (
        label.id === old.id &&
        label.name === old.name &&
        label.symbol === old.symbol &&
        label.enabled === old.enabled &&
        label.position === old.position
      );
    })
  )
    return;
  const remove = database.prepare(
    "DELETE FROM project_labels WHERE chat_id=? AND id=? AND builtin=0",
  );
  for (const label of previous)
    if (!next.some((entry) => entry.id === label.id))
      remove.run(chatId, label.id);
  // Temporary unique names/positions allow swaps while retaining surviving assignments.
  database
    .prepare(
      "UPDATE project_labels SET name_key='__reordering__' || id, position=position+100 WHERE chat_id=? AND id NOT IN ('pin','attention')",
    )
    .run(chatId);
  const update = database.prepare(
    "UPDATE project_labels SET name=?, name_key=?, symbol=?, enabled=?, position=? WHERE chat_id=? AND id=?",
  );
  for (const label of next) {
    if (previousIds.has(label.id))
      update.run(
        label.name,
        labelNameKey(label.name),
        label.symbol,
        +label.enabled,
        label.position,
        chatId,
        label.id,
      );
    else insertProjectLabel(database, chatId, label);
  }
  database
    .prepare(
      "UPDATE chats SET label_configuration_revision=label_configuration_revision+1 WHERE id=? AND label_configuration_revision=?",
    )
    .run(chatId, config.revision);
}
