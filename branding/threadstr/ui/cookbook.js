/* global document, getComputedStyle, CSS */

const root = document.documentElement;
const accents = ["coral", "amber", "moss", "ocean", "iris", "slate"];
const featuredTokens = [
  ["history", "Workspace"],
  ["paper", "Group / participant"],
  ["rail", "Sidebar"],
  ["field", "Composer"],
  ["control", "Icon control"],
  ["selection", "Selection / hover"],
  ["ink", "Primary text"],
  ["muted", "Secondary text"],
  ["focus", "Focus"],
  ["button-primary", "Primary action"],
  ["critical", "Critical"],
  ["line", "Structural divider"],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderPalette() {
  const styles = getComputedStyle(root);
  const value = (name) => styles.getPropertyValue(`--${name}`).trim();
  const colors = document.querySelector("#cb-colors");
  colors.replaceChildren();
  for (const [name, label] of featuredTokens) {
    const card = element("div", "cb-color");
    const swatch = element("i", "cb-color-sample");
    swatch.style.background = value(name);
    swatch.setAttribute("aria-hidden", "true");
    card.append(
      swatch,
      element("b", "", label),
      element("code", "", `--${name}`),
      element("code", "", value(name)),
    );
    colors.append(card);
  }
  const accentGrid = document.querySelector("#cb-accents");
  accentGrid.replaceChildren();
  for (const accent of accents) {
    const item = element("div");
    const identity = element("i");
    identity.style.background = value(accent);
    identity.title = `Identity: ${value(accent)}`;
    const action = element("i", "", "✓");
    action.style.background = value(`${accent}-action`);
    action.title = `Action fill: ${value(`${accent}-action`)}`;
    item.append(
      identity,
      action,
      element("b", "", accent[0].toUpperCase() + accent.slice(1)),
    );
    accentGrid.append(item);
  }
  const table = document.querySelector("#cb-all-tokens");
  table.replaceChildren();
  const colorTokens = Array.from(styles)
    .filter(
      (name) =>
        name.startsWith("--") &&
        CSS.supports("color", styles.getPropertyValue(name).trim()),
    )
    .sort();
  for (const name of colorTokens) {
    const row = element("div", "cb-token-row");
    const swatch = element("i");
    const color = styles.getPropertyValue(name).trim();
    swatch.style.background = color;
    swatch.setAttribute("aria-hidden", "true");
    row.append(swatch, element("code", "", name), element("span", "", color));
    table.append(row);
  }
}

document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", () => {
    root.dataset.theme = input.value;
    renderPalette();
  });
});

function swatchOptions(containerId, groupName) {
  const container = document.getElementById(containerId);
  for (const accent of accents) {
    const label = element("label", "accent-option");
    label.dataset.accent = accent;
    const input = element("input");
    input.type = "radio";
    input.name = groupName;
    input.value = accent;
    input.checked = accent === "ocean";
    input.defaultChecked = input.checked;
    input.setAttribute("aria-label", accent[0].toUpperCase() + accent.slice(1));
    const swatch = element("span", "accent-swatch");
    swatch.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m20 6-11 11-5-5");
    svg.append(path);
    swatch.append(svg);
    label.append(input, swatch);
    container.append(label);
    input.addEventListener("change", () => {
      const surface = container.closest("[data-accent]");
      if (surface) surface.dataset.accent = accent;
    });
  }
}
swatchOptions("cb-swatch-options", "project-accent");
swatchOptions("cb-create-swatches", "create-accent");

const settingsForm = document.querySelector("#cb-settings-form");
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#cb-save-status").textContent =
    "Saved-state preview. No project data was changed.";
});
document.querySelector("#cb-reset").addEventListener("click", () => {
  settingsForm.reset();
  settingsForm.closest("[data-accent]").dataset.accent = "ocean";
  document.querySelector("#cb-save-status").textContent = "";
  document.querySelector("#cb-action-status").textContent = "";
});
document.querySelectorAll("[data-demo-action]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#cb-action-status").textContent =
      button.dataset.demoAction;
  });
});
document.querySelector("#cb-expand").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "Show less ⌃" : "Show more ⌄";
  document
    .querySelector("#cb-long-message")
    .classList.toggle("message-body-viewport--collapsed", !expanded);
});
const composer = document.querySelector("#cb-composer");
const message = document.querySelector("#cb-message");
const send = document.querySelector("#cb-send");
message.addEventListener("input", () => {
  send.disabled = !message.value.trim();
});
composer.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!message.value.trim()) return;
  composer.dataset.sendFeedback = "preview";
  document.querySelector("#cb-send-status").textContent =
    "Submission feedback preview. This pulse does not confirm persistence.";
});
composer.addEventListener("animationend", () => {
  delete composer.dataset.sendFeedback;
});
document.querySelector("#cb-focus-demo").addEventListener("click", () => {
  document.querySelector("#cb-focus-field").focus();
});
const dialog = document.querySelector("#cb-create-dialog");
document.querySelector("#cb-dialog-open").addEventListener("click", () => {
  dialog.showModal();
});
renderPalette();
