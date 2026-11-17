/* global document, getComputedStyle, CSS */

const root = document.documentElement;
const accentNames = {
  coral: "Coral",
  amber: "Amber",
  moss: "Moss",
  ocean: "Ocean",
  iris: "Iris",
  slate: "Slate",
  "coral-gradient": "Guava",
  "amber-gradient": "Honey",
  "moss-gradient": "Jade",
  "ocean-gradient": "Lagoon",
  "iris-gradient": "Orchid",
  "slate-gradient": "Periwinkle",
};
const accents = Object.keys(accentNames);
const featuredTokens = [
  ["history", "Workspace"],
  ["paper", "Group / participant"],
  ["rail", "Sidebar"],
  ["field", "Composer"],
  ["control", "Icon control"],
  ["selection", "Selection / hover"],
  ["ink", "Primary text"],
  ["muted", "Secondary text"],
  ["focus", "Control focus"],
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
  const notes = {
    coral: "The glaze samples are ready.",
    amber: "Try the new espresso blend.",
    moss: "Plant the basil this weekend.",
    ocean: "Save this take for the chorus.",
    iris: "Keep the last frame a little longer.",
    slate: "The prototype fits the workbench.",
  };
  for (const accent of accents) {
    const item = element("figure");
    item.dataset.accent = accent;
    const message = element(
      "div",
      "message-bubble",
      notes[accent.split("-")[0]],
    );
    const identity = element("span", "cb-identity-sample", "✓");
    identity.setAttribute("aria-hidden", "true");
    const caption = element("figcaption");
    caption.append(
      identity,
      element("b", "", accentNames[accent]),
      element("span", "cb-action-sample send-button", "Add"),
    );
    item.append(message, caption);
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

function swatchOptions(containerId, groupName, selected) {
  const container = document.getElementById(containerId);
  for (const accent of accents) {
    const label = element("label", "accent-option");
    label.dataset.accent = accent;
    label.title = accentNames[accent];
    const input = element("input");
    input.type = "radio";
    input.name = groupName;
    input.value = accent;
    input.checked = accent === selected;
    input.defaultChecked = input.checked;
    input.setAttribute("aria-label", accentNames[accent]);
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
      container
        .closest("fieldset")
        .querySelector(".accent-selection-name").textContent =
        accentNames[accent];
      const surface = container.closest("[data-accent]");
      if (surface) surface.dataset.accent = accent;
    });
  }
}
swatchOptions("cb-swatch-options", "project-accent", "ocean");
swatchOptions("cb-create-swatches", "create-accent", "coral");

const settingsForm = document.querySelector("#cb-settings-form");
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#cb-save-status").textContent =
    "Saved-state preview. No project data was changed.";
});
document.querySelector("#cb-reset").addEventListener("click", () => {
  settingsForm.reset();
  settingsForm.querySelector(".accent-selection-name").textContent =
    accentNames.ocean;
  settingsForm.closest("[data-accent]").dataset.accent = "ocean";
  document.querySelector("#cb-save-status").textContent = "";
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
document.querySelector("#cb-rail-create").addEventListener("click", () => {
  dialog.showModal();
});
renderPalette();

const railRow = document.querySelector('[data-project-row="navigation"]');
const railStrip = railRow.querySelector(".project-shortcuts");
const disclosure = railRow.querySelector(".project-shortcuts-disclosure");
const alertButton = railStrip.querySelector('[data-project-action="alert"]');

let inputMethod = "keyboard";
document.addEventListener(
  "pointerdown",
  (event) => {
    inputMethod = event.pointerType;
  },
  true,
);
document.addEventListener(
  "keydown",
  () => {
    inputMethod = "keyboard";
  },
  true,
);

function showShortcuts(open) {
  railRow.dataset.shortcutsOpen = String(open);
  railStrip.hidden = !open;
  disclosure.setAttribute("aria-expanded", String(open));
  const icon =
    alertButton.getAttribute("aria-pressed") === "true" && !open
      ? alertButton.firstElementChild
      : document.querySelector("#cb-message-actions [aria-haspopup] svg");
  disclosure.replaceChildren(icon.cloneNode(true));
}
railRow.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "mouse") showShortcuts(true);
});
railRow.addEventListener("pointerleave", (event) => {
  if (
    event.pointerType === "mouse" &&
    !(inputMethod === "keyboard" && railRow.contains(document.activeElement))
  ) {
    showShortcuts(false);
  }
});
railRow.querySelector(".project-item").addEventListener("focus", () => {
  if (inputMethod === "keyboard") showShortcuts(true);
});
railRow.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !railRow.contains(event.relatedTarget))
    showShortcuts(false);
});
document.addEventListener("pointerdown", (event) => {
  if (!railStrip.hidden && !railRow.contains(event.target))
    showShortcuts(false);
});
railRow.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    railRow.querySelector(".project-item").focus();
    showShortcuts(false);
  }
});
disclosure.addEventListener("click", () => {
  const opening = railStrip.hidden;
  showShortcuts(opening);
  if (opening) alertButton.focus();
});
railStrip.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("aria-pressed")) {
    button.setAttribute(
      "aria-pressed",
      String(button.getAttribute("aria-pressed") !== "true"),
    );
    if (button === alertButton) {
      alertButton.firstElementChild.className =
        button.getAttribute("aria-pressed") === "true"
          ? "attention-dot attention-dot--today"
          : "attention-dot attention-dot--earlier";
    }
  } else {
    document.querySelector("#cb-shortcuts-status").textContent =
      `${button.title} Navigation ideas — specimen only.`;
  }
});

const conversation = document.querySelector(".cb-conversation");
document
  .querySelector("#cb-message-time")
  .addEventListener("change", (event) => {
    conversation.dataset.messageTime = event.target.checked
      ? "always"
      : "on-interaction";
  });
conversation.querySelectorAll(".message-row").forEach((row) => {
  row.tabIndex = -1;
  row.addEventListener("pointerup", (event) => {
    const touch = event.pointerType === "touch";
    conversation.toggleAttribute("data-touch-interaction", touch);
    if (touch && !event.target.closest("button, input")) row.focus();
  });
});
const toolbar = document.querySelector("#cb-message-actions");
const messageRow = toolbar.closest(".message-row");
const actions = toolbar.querySelectorAll(".message-action");
function showPopup(trigger, open) {
  const popup = document.getElementById(trigger.getAttribute("aria-controls"));
  popup.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  const container = trigger.parentElement;
  container.classList.toggle("message-popup--open", open);
  if (open) {
    const bounds = popup.getBoundingClientRect();
    container.style.setProperty(
      "--popup-gap-left",
      `${bounds.left - trigger.getBoundingClientRect().left}px`,
    );
    container.style.setProperty("--popup-gap-width", `${bounds.width}px`);
  }
}
let popupMethod;
actions.forEach((trigger) => {
  trigger.addEventListener("click", () => {
    popupMethod = inputMethod;
    const open = trigger.getAttribute("aria-expanded") !== "true";
    actions.forEach((button) => showPopup(button, open && button === trigger));
    if (open && trigger.hasAttribute("aria-haspopup")) {
      toolbar.querySelector('[role="menuitem"]').focus();
    }
  });
});
messageRow.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && popupMethod === "mouse") {
    actions.forEach((trigger) => showPopup(trigger, false));
  }
});
function closeOutside(event) {
  if (event.type === "focusin" && event.target === messageRow) return;
  if (!toolbar.contains(event.target))
    actions.forEach((trigger) => showPopup(trigger, false));
}
document.addEventListener("pointerdown", closeOutside);
document.addEventListener("focusin", closeOutside);
toolbar.addEventListener("keydown", (event) => {
  popupMethod = "keyboard";
  const trigger = toolbar.querySelector('[aria-expanded="true"]');
  if (!trigger) return;
  if (event.key === "Escape") {
    showPopup(trigger, false);
    trigger.focus();
  } else if (event.target.matches('[role="menuitem"]')) {
    const items = [...toolbar.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(event.target);
    const next = {
      Home: 0,
      End: items.length - 1,
      ArrowUp: (index + items.length - 1) % items.length,
      ArrowDown: (index + 1) % items.length,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      items[next].focus();
    }
  }
});
toolbar.querySelector('[role="menu"]').addEventListener("click", (event) => {
  const item = event.target.closest('[role="menuitem"]');
  if (!item) return;
  document.querySelector("#cb-message-status").textContent =
    `${item.textContent} — specimen only.`;
  const trigger = toolbar.querySelector("[aria-haspopup]");
  showPopup(trigger, false);
  if (item.hasAttribute("data-select-specimen")) startSelectionSpecimen();
  else trigger.focus();
});

const selection = document.querySelector("#message-selection");
const selectedHistory = selection.querySelector("#cb-selection-history");
const destinationView = selection.querySelector("#cb-selection-picker");
const destinationForm = selection.querySelector("form");
const destinationList = destinationForm.querySelector("ul");
const destinationSearch = destinationForm.querySelector('[type="search"]');
const destinationSubmit = destinationForm.querySelector('[type="submit"]');
const destinationNames = [
  ["Product launch", ["Checklist", "Design"]],
  ["Delivery notes", []],
];
let chosenDestination = "";
const expandedProjects = new Map();
for (const [project, children] of destinationNames) {
  for (const name of [project, ...children]) {
    const child = name !== project;
    const row = element(
      "li",
      "project-row" + (child ? " project-row--subthread" : ""),
    );
    row.dataset.accent = "ocean";
    row.dataset.project = project;
    const label = child ? project + " / " + name : project;
    const button = element("button", "project-item");
    button.type = "button";
    button.setAttribute("aria-label", label);
    const content = element("span", "project-item-copy");
    content.append(element("strong", "", name));
    button.append(content);
    row.append(button);
    destinationList.append(row);
    button.addEventListener("click", () => {
      if (!child && children.length)
        expandedProjects.set(
          project,
          chosenDestination !== project ||
            button.getAttribute("aria-expanded") !== "true",
        );
      chosenDestination = label;
      updateDestinationSpecimen();
    });
  }
}
function updateDestinationSpecimen() {
  const query = destinationSearch.value.trim().toLocaleLowerCase();
  let visible = false;
  let selectedVisible = false;
  for (const row of destinationList.children) {
    const project = row.dataset.project;
    const button = row.querySelector("button");
    const name = button.getAttribute("aria-label");
    const children = destinationNames.find(([title]) => title === project)[1];
    const matchesChild = children.some((child) =>
      (project + " / " + child).toLocaleLowerCase().includes(query),
    );
    const expanded =
      expandedProjects.get(project) ??
      (Boolean(query) || chosenDestination.startsWith(project + " / "));
    const matches = name.toLocaleLowerCase().includes(query);
    row.hidden =
      name === project ? !matches && !matchesChild : !matches || !expanded;
    if (name === project && matchesChild)
      button.setAttribute("aria-expanded", String(expanded));
    else button.removeAttribute("aria-expanded");
    const selected = chosenDestination === name;
    row.classList.toggle("project-row--active", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (!row.hidden) {
      visible = true;
      if (selected) selectedVisible = true;
    }
  }
  destinationForm.querySelector(".field-help").hidden = visible;
  destinationSubmit.disabled = !selectedVisible;
}
destinationSearch.addEventListener("input", () => {
  expandedProjects.clear();
  updateDestinationSpecimen();
});
const selectionStatus = selection.querySelector("#cb-selection-status");
const selectionCount = selection.querySelector("#cb-selection-count");
const choices = [...selectedHistory.querySelectorAll('input[type="checkbox"]')];
let batchCommand = "";
let rangeAnchor = 0;
function updateSelectionSpecimen() {
  const count = choices.filter((choice) => choice.checked).length;
  const deleting = batchCommand === "Delete";
  for (const choice of choices) {
    choice.closest(".message-row").dataset.selected = String(choice.checked);
    choice.disabled = deleting;
  }
  const amount = count + (count === 1 ? " message" : " messages");
  for (const action of selectedHistory.querySelectorAll("button[data-batch]")) {
    action.disabled =
      ["Copy", "Move", "Delete"].includes(action.dataset.batch) && count === 0;
    action.hidden =
      deleting && ["all", "Copy", "Move"].includes(action.dataset.batch);
    if (action.dataset.batch === "Delete")
      action.textContent = deleting ? "Delete " + amount : "Delete";
  }
  selectionCount.textContent = deleting
    ? "Delete " + amount + " from Website?"
    : count + " selected";
  return amount;
}
for (const [index, choice] of choices.entries()) {
  function pickRange() {
    for (const member of choices.slice(
      Math.min(index, rangeAnchor),
      Math.max(index, rangeAnchor) + 1,
    ))
      member.checked = true;
  }
  choice.addEventListener("click", (event) => {
    if (event.shiftKey) pickRange();
    else rangeAnchor = index;
    selectionStatus.textContent = "";
    updateSelectionSpecimen();
  });
  choice.addEventListener("keydown", (event) => {
    if (event.key !== " " || !event.shiftKey) return;
    event.preventDefault();
    pickRange();
    updateSelectionSpecimen();
  });
  choice.closest(".message-row").addEventListener("click", (event) => {
    if (choice.disabled || !event.shiftKey || event.target.closest("label"))
      return;
    pickRange();
    updateSelectionSpecimen();
  });
}
selection.addEventListener("click", (event) => {
  const action = event.target.closest("[data-batch]")?.dataset.batch;
  if (!action) return;
  selectionStatus.textContent = "";
  if (action === "back" || action === "cancel") {
    selectedHistory.hidden = false;
    destinationView.hidden = true;
    if (action === "cancel" && batchCommand !== "Delete")
      choices.forEach((choice) => {
        choice.checked = false;
      });
    batchCommand = "";
    updateSelectionSpecimen();
    choices[0].focus();
  } else if (action === "all") {
    for (const choice of choices) choice.checked = true;
    updateSelectionSpecimen();
  } else if (action === "Delete") {
    if (batchCommand === "Delete") {
      selectionStatus.textContent = "Deletion confirmed in this specimen.";
      batchCommand = "";
    } else batchCommand = "Delete";
    updateSelectionSpecimen();
  } else {
    batchCommand = action;
    const title = action + " " + updateSelectionSpecimen();
    selectedHistory.hidden = true;
    destinationView.hidden = false;
    destinationForm.reset();
    chosenDestination = "";
    expandedProjects.clear();
    updateDestinationSpecimen();
    destinationForm.querySelector("h3").textContent = title;
    destinationSubmit.textContent = title;
    destinationSearch.focus();
  }
});
destinationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  destinationForm.querySelector("[data-batch=back]").click();
  selectionStatus.textContent = "Selected " + chosenDestination + ".";
});
function startSelectionSpecimen() {
  selectedHistory.hidden = false;
  destinationView.hidden = true;
  batchCommand = "";
  selection.scrollIntoView();
  choices[0].checked = true;
  rangeAnchor = 0;
  updateSelectionSpecimen();
  choices[0].focus();
}

const pictureViewer = document.querySelector("#cb-picture-viewer");
document
  .querySelector("#cb-picture-open")
  .addEventListener("click", () => pictureViewer.showModal());
document
  .querySelector("#cb-picture-close")
  .addEventListener("click", () => pictureViewer.close());
