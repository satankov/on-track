import { useId, type ReactNode } from "react";
import {
  isEmptyLabelDraft,
  labelConfiguration,
  withLabelPlaceholder,
  type LabelDraft,
} from "./label-drafts.js";
import { useLabelReordering } from "./useLabelReordering.js";
import {
  isBuiltinLabel,
  labelConfigurationSchema,
  type Label,
} from "../domain/labels.js";

export function ProjectLabelsEditor({
  labels,
  onChange,
  glyph,
  showErrors,
  disabled,
}: {
  labels: LabelDraft[];
  onChange: (labels: LabelDraft[]) => void;
  glyph: (label: Label) => ReactNode;
  showErrors: boolean;
  disabled: boolean;
}) {
  const help = useId();
  const sortingHelp = useId();
  const { listRef, picked, preview, status, ...reorder } = useLabelReordering(
    labels,
    onChange,
    disabled,
  );
  const result = labelConfigurationSchema.safeParse(
    labelConfiguration(labels, 0),
  );
  const fieldError = (index: number, field: "name" | "symbol") =>
    (showErrors || Boolean(labels[index]?.[field])) && !result.success
      ? result.error.issues.find(
          (issue) => issue.path[1] === index && issue.path[2] === field,
        )?.message
      : undefined;
  const change = (index: number, values: Partial<LabelDraft>) =>
    onChange(
      withLabelPlaceholder(
        labels.map((label, position) =>
          position === index ? { ...label, ...values } : label,
        ),
        labels[index]!.key,
      ),
    );
  const sourceIndex = labels.findIndex(
    (entry) => entry.key === preview?.source,
  );
  const targetIndex = labels.findIndex(
    (entry) => entry.key === preview?.target,
  );
  return (
    <fieldset
      className="project-label-fieldset"
      aria-describedby={help}
      disabled={disabled}
    >
      <legend>Project labels</legend>
      <div
        className={`project-label-options${preview ? " project-label-options--dragging" : ""}`}
        ref={listRef}
      >
        {labels.slice(2).map((label, offset) => {
          const index = offset + 2;
          const builtin = Boolean(label.id && isBuiltinLabel(label.id));
          const empty = isEmptyLabelDraft(label);
          const dragging = preview?.source === label.key;
          const shift = !preview
            ? 0
            : dragging
              ? preview.offsetY
              : sourceIndex < index && index <= targetIndex
                ? -preview.height
                : targetIndex >= 2 &&
                    targetIndex <= index &&
                    index < sourceIndex
                  ? preview.height
                  : 0;
          const number = labels
            .slice(0, index + 1)
            .filter((entry) => !entry.id || !isBuiltinLabel(entry.id)).length;
          const nameError = fieldError(index, "name");
          const symbolError = fieldError(index, "symbol");
          const description = `${help}${!empty && (nameError || symbolError) ? ` ${label.key}-error` : ""}`;
          return (
            <div
              className={`project-label-edit-slot${dragging ? " project-label-edit-slot--dragging" : ""}`}
              key={label.key}
              data-label-key={label.key}
              data-sortable={!empty}
            >
              <div
                className={`project-label-edit-row${empty ? " project-label-edit-row--empty" : ""}${picked === label.key ? " project-label-edit-row--picked" : ""}${dragging ? " project-label-edit-row--moving" : ""}`}
                style={
                  preview ? { transform: `translateY(${shift}px)` } : undefined
                }
              >
                {empty ? (
                  <span aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    className="project-label-drag-handle"
                    data-label-handle={label.key}
                    aria-label={`Reorder ${label.name || "new label"}`}
                    aria-describedby={sortingHelp}
                    aria-pressed={picked === label.key || dragging}
                    onPointerDown={(event) =>
                      reorder.pointerDown(event, label.key)
                    }
                    onPointerMove={reorder.pointerMove}
                    onPointerUp={reorder.pointerUp}
                    onPointerCancel={reorder.cancel}
                    onLostPointerCapture={reorder.lostCapture}
                    onClick={(event) => reorder.click(event, label.key)}
                    onKeyDown={(event) => reorder.keyDown(event, label.key)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 8h14M5 16h14" />
                    </svg>
                  </button>
                )}
                <div className="project-label-edit-fields">
                  {builtin ? (
                    <>
                      <span className="custom-label-symbol project-label-value">
                        {glyph(label.id!)}
                      </span>
                      <span className="custom-label-name project-label-value">
                        {label.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <label className="custom-label-symbol">
                        <input
                          className="text-input"
                          aria-label={`Label symbol ${number}`}
                          value={label.symbol ?? ""}
                          placeholder="☆"
                          maxLength={64}
                          aria-invalid={Boolean(symbolError)}
                          aria-describedby={description}
                          onChange={(event) =>
                            change(index, {
                              symbol: event.target.value || null,
                            })
                          }
                        />
                      </label>
                      <label className="custom-label-name">
                        <input
                          className="text-input"
                          aria-label={`Label name ${number}`}
                          value={label.name}
                          placeholder="Label name"
                          maxLength={256}
                          aria-invalid={Boolean(nameError)}
                          aria-describedby={description}
                          onChange={(event) =>
                            change(index, { name: event.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  {!empty ? (
                    <label className="project-label-option custom-label-enabled">
                      <input
                        type="checkbox"
                        aria-label={
                          builtin
                            ? label.name
                            : `Enable ${label.name || `custom label ${number}`}`
                        }
                        checked={label.enabled}
                        onChange={(event) =>
                          change(index, { enabled: event.target.checked })
                        }
                      />
                    </label>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </div>
                <div className="project-label-actions">
                  {!builtin && !empty && (
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`${label.id ? "Delete" : "Discard"} ${label.name || "new label"}`}
                      title={`Delete ${label.name || "new label"}`}
                      onClick={(event) => {
                        const previousFocus = document.activeElement;
                        const row = event.currentTarget.closest(
                          ".project-label-edit-slot",
                        );
                        const nextRow =
                          row?.nextElementSibling ??
                          row?.previousElementSibling;
                        const nextControl =
                          nextRow?.querySelector<HTMLElement>("button, input");
                        reorder.cancel();
                        onChange(
                          withLabelPlaceholder(
                            labels.filter((_, i) => i !== index),
                          ),
                        );
                        requestAnimationFrame(() => {
                          if (
                            document.activeElement === previousFocus ||
                            document.activeElement === document.body
                          )
                            nextControl?.focus();
                        });
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {!builtin && !empty && (nameError || symbolError) && (
                  <span
                    id={`${label.key}-error`}
                    className="form-error custom-label-error"
                    role="alert"
                  >
                    {nameError}
                    {nameError && symbolError ? " " : ""}
                    {symbolError}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p id={help} className="field-help">
        Up to 5 custom labels, 8 characters per name, and one optional symbol or
        emoji. Turning a label off keeps it on existing messages.
      </p>
      <p className="field-help">
        Use × or clear both fields to remove a custom label and its message tags
        when you save.
      </p>
      <p className="field-help">Drag rows to reorder.</p>
      <span id={sortingHelp} className="visually-hidden">
        Drag using the handle. Or select a handle, then its destination. Use ↑/↓
        or Home/End on a focused handle. Escape cancels.
      </span>
      <span className="visually-hidden" role="status">
        {status}
      </span>
    </fieldset>
  );
}
