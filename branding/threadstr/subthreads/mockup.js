/* global document, window */
// Sample-only interaction model. No API, storage, or production data access.
const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 15h2a8 8 0 0 0 8-7"/>',
  pin: '<path d="m15 4 5 5-3 1-4 4v4l-3-3-6 6 6-6-3-3h4l4-4z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
  restore: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
  label: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
  all: '<path d="M5 5h14M5 12h14M5 19h14"/>',
  file: '<path d="M14 2H5v20h14V7zM14 2v5h5"/>',
  link: '<path d="m10 13 4-4M8 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0M16 9l2-2a3.5 3.5 0 0 0-5-5l-5 5" transform="translate(2 2)"/>',
};
const icon = (name, className = "") =>
  `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.branch}</svg>`;
const defaults = () => ({
  labels: [
    "Pin",
    "Attention",
    "Todo",
    "Decision",
    "Open question",
    "Risk",
    "Milestone",
  ],
  collapse: true,
});
const note = (id, text, time, extra = {}) => ({ id, text, time, ...extra });
const threads = [
  {
    id: "main",
    title: "Website redesign",
    root: "main",
    accent: "ocean",
    messages: [
      note(
        "scope",
        "The redesign needs to make the product easier to understand. Let’s focus on navigation, pricing, and a clearer first impression.",
        "09:40",
        { tag: "Decision" },
      ),
      note(
        "feedback",
        "People understand the product after a demo. The website should get them there before they book one.",
        "09:52",
        { sender: "Maya" },
      ),
      note(
        "source-pricing",
        "We need to reconsider pricing before launch. A smaller entry plan might work, but I want to compare the options before we change the main page.",
        "10:14",
        { tag: "Open question" },
      ),
      note(
        "schedule",
        "Keep the Friday review focused on the overall direction. Navigation ideas and pricing research can develop separately.",
        "10:28",
        { tag: "Todo" },
      ),
    ],
  },
  {
    id: "launch",
    title: "Product launch",
    root: "launch",
    accent: "moss",
    pinned: true,
    messages: [
      note(
        "launch-note",
        "The launch checklist is ready for review.",
        "09:15",
        { tag: "Todo" },
      ),
    ],
  },
  {
    id: "reading",
    title: "Reading notes",
    root: "reading",
    accent: "amber",
    messages: [
      note(
        "reading-note",
        "Keep a few useful references here for the next project.",
        "08:30",
      ),
    ],
  },
  {
    id: "navigation",
    title: "Navigation ideas",
    root: "main",
    kind: "independent",
    pinned: true,
    messages: [
      note(
        "nav-1",
        "Try a shorter navigation: Product, Pricing, Resources. Move the secondary links to the footer.",
        "09:45",
        { tag: "Todo" },
      ),
    ],
  },
  {
    id: "pricing",
    title: "Pricing experiment",
    root: "main",
    kind: "continued",
    origin: { thread: "main", message: "source-pricing" },
    messages: [
      note(
        "pricing-1",
        "Compare two starting points: a simple two-tier offer, or a small entry plan with optional extras.",
        "10:18",
      ),
      note(
        "pricing-2",
        "The entry plan should feel complete. Avoid making basic reporting an add-on.",
        "10:24",
        { sender: "Maya" },
      ),
      note(
        "pricing-3",
        "Next: sketch both pricing tables and compare the first-year cost for a team of five.",
        "10:31",
        { tag: "Todo" },
      ),
    ],
  },
  {
    id: "feedback1",
    title: "Client feedback",
    root: "main",
    kind: "independent",
    messages: [
      note(
        "f1",
        "First review: the product story needs one clear example near the top.",
        "09:30",
      ),
    ],
  },
  {
    id: "feedback2",
    title: "Client feedback 2",
    root: "main",
    kind: "independent",
    messages: [
      note(
        "f2",
        "Second review: make the transition from product benefits to pricing easier to follow.",
        "09:35",
      ),
    ],
  },
  {
    id: "feedback3",
    title: "Client feedback 3",
    root: "main",
    kind: "independent",
    messages: [
      note(
        "f3",
        "Third review: keep the language direct and show the product earlier.",
        "09:40",
      ),
    ],
  },
  {
    id: "content",
    title: "Content inventory",
    root: "main",
    kind: "independent",
    messages: [
      note("c1", "List the pages to keep, combine, and rewrite.", "08:20"),
    ],
  },
  {
    id: "handoff",
    title: "Design handoff",
    root: "main",
    kind: "independent",
    messages: [],
  },
  {
    id: "sketches",
    title: "Early sketches",
    root: "main",
    kind: "independent",
    archived: true,
    messages: [
      note("s1", "Saved the first layout studies for reference.", "08:10"),
    ],
  },
].map((thread) => ({ ...defaults(), ...thread }));
let active = "main";
let expanded = true;
let expandedRoot = "main";
let showAll = false;
let scene = "sidebar";
let featured = null;
let located = null;
let pendingOrigin = null;
let dialogOpener = null;
let messageAction = null;
let editing = false;
let filter = "All";
let nextId = 1;
const drafts = new Map();
const sections = { pinned: true, projects: true, archive: true };
const find = (id) => threads.find((thread) => thread.id === id);
const current = () => find(active);
const noteLabels = (message) =>
  message.tags ?? (message.tag ? [message.tag] : []);
const parent = (thread) => find(thread.root);
const children = (root) =>
  threads.filter((thread) => thread.root === root && thread.id !== root);
const sortedChildren = (root) =>
  children(root)
    .filter((thread) => !thread.archived)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
const say = (text) => {
  $("#announcement").textContent = text;
};
function pinButton(thread) {
  return `<button type="button" class="project-pin-button" data-pin="${thread.id}" aria-label="${thread.pinned ? "Unpin" : "Pin"} ${escape(thread.title)}" aria-pressed="${Boolean(thread.pinned)}" title="${thread.pinned ? "Unpin" : "Pin"}">${icon("pin")}</button>`;
}
function rootRow(thread) {
  const isExpanded = thread.id === expandedRoot && expanded;
  const hasChildren = children(thread.id).length > 0;
  const list = sortedChildren(thread.id);
  return `<li><div class="project-row ${active === thread.id ? "project-row--active" : ""}" data-accent="${thread.accent}">
    <button class="project-item ${hasChildren ? "project-item--parent" : ""}" type="button" data-project="${thread.id}" ${hasChildren ? `aria-expanded="${isExpanded}" aria-controls="children-${thread.id}"` : ""} ${active === thread.id ? 'aria-current="page"' : ""}>
      <span class="project-item-copy"><strong>${escape(thread.title)}</strong><small>${escape(thread.messages.at(-1)?.text ?? "No messages yet")}</small></span>
    </button>${pinButton(thread)}</div>
    ${hasChildren ? `<ul class="subthread-list" id="children-${thread.id}" ${isExpanded ? "" : "hidden"} data-accent="${thread.accent}">${(showAll ? list : list.slice(0, 5)).map(childRow).join("")}${list.length > 5 ? `<li><button class="subthread-list-action" type="button" id="show-all-${thread.id}" data-show-all="${thread.id}" aria-expanded="${showAll}">${showAll ? "Show less" : "Show all"}</button></li>` : ""}</ul>` : ""}</li>`;
}
function childRow(thread) {
  return `<li class="project-row subthread-row ${active === thread.id ? "project-row--active" : ""}"><button class="project-item" type="button" data-thread="${thread.id}" ${active === thread.id ? 'aria-current="page"' : ""} title="${escape(thread.title)}"><span class="project-item-copy"><strong>${escape(thread.title)}</strong></span></button>${pinButton(thread)}</li>`;
}
function section(name, label, contents) {
  return `<section class="project-section"><button class="rail-section-label" type="button" data-section="${name}" aria-expanded="${sections[name]}" aria-controls="section-${name}"><span class="rail-section-title">${icon("down")}${label}</span></button><ul class="project-items" id="section-${name}" ${sections[name] ? "" : "hidden"}>${contents}</ul></section>`;
}
function renderRail() {
  const roots = threads.filter((thread) => thread.id === thread.root);
  const archived = threads.filter((thread) => thread.archived);
  $("#project-list").innerHTML =
    section(
      "pinned",
      "Pinned",
      roots
        .filter((thread) => thread.pinned)
        .map(rootRow)
        .join(""),
    ) +
    section(
      "projects",
      "Projects",
      roots
        .filter((thread) => !thread.pinned)
        .map(rootRow)
        .join(""),
    ) +
    section(
      "archive",
      "Archive",
      archived
        .map(
          (thread) =>
            `<li class="project-row archive-child ${active === thread.id ? "project-row--active" : ""}" data-accent="${parent(thread).accent}"><button class="project-item" type="button" data-thread="${thread.id}"><span class="project-item-copy"><strong>${escape(thread.title)}</strong><small>${escape(parent(thread).title)}</small></span></button><button class="project-pin-button archive-restore" data-restore="${thread.id}" aria-label="Restore ${escape(thread.title)}" title="Restore">${icon("restore")}</button></li>`,
        )
        .join(""),
    );
}
function header(thread, comparison = false, rootOverride = null) {
  const root = rootOverride ?? parent(thread);
  return `<div class="chat-header-inner"><div class="chat-heading"><h1>${thread.id !== root.id ? `<a class="title-parent" href="#${root.id}" title="${escape(root.title)}">${escape(root.title)}</a><span class="title-divider" aria-hidden="true">/</span>` : ""}<span class="title-current" title="${escape(thread.title)}">${escape(thread.title)}</span></h1></div>
    <button type="button" class="header-subthread-button" data-action="create-independent" aria-label="New subthread" title="New subthread" ${comparison ? "disabled" : ""}>${icon("branch")}</button>
    <button type="button" class="project-search-toggle" data-action="search" aria-label="Search messages" title="Search messages" aria-expanded="${!$("#search").hidden}" ${comparison ? "disabled" : ""}>${icon("search")}</button>
    <button type="button" class="button button-quiet edit-project-button" data-action="edit" ${comparison ? "disabled" : ""}>${icon("edit")}<span>Edit</span></button></div>`;
}
function renderHeader() {
  $("#chat-header").innerHTML = header(current());
  $("#chat").dataset.accent = parent(current()).accent;
  $("#preview-shell").dataset.accent = parent(current()).accent;
}
function renderFilters() {
  const thread = current();
  const labels = ["All", "Files", "Links", ...thread.labels];
  $("#filters").innerHTML =
    `<div class="history-filter-inner">${labels.map((label) => `<button type="button" data-filter="${escape(label)}" class="history-filter-button ${label === filter ? "history-filter-button--active" : ""}" aria-pressed="${label === filter}"><span class="history-filter-icon">${icon({ All: "all", Files: "file", Links: "link", Pin: "pin" }[label] ?? "label")}</span><span class="history-filter-label">${escape(label)}</span><span class="history-filter-count">${label === "All" ? thread.messages.length : thread.messages.filter((message) => noteLabels(message).includes(label)).length}</span></button>`).join("")}</div>`;
}
function origin(thread) {
  if (thread.kind === "independent")
    return '<div class="message-date-separator subthread-event">Independent subthread</div>';
  if (!thread.origin) return "";
  const source = find(thread.origin.thread);
  const sourceMessage = source?.messages.some(
    (message) => message.id === thread.origin.message,
  );
  return `<div class="message-date-separator subthread-event">Subthread from ${source ? `<a href="#${source.id}${sourceMessage ? `/${thread.origin.message}` : ""}">${escape(source.title)}</a>${sourceMessage ? "" : " · Original message deleted"}` : "a deleted conversation"}</div>`;
}
function messageHTML(message, thread, searching = false) {
  const branches = threads.filter(
    (item) =>
      item.origin?.thread === thread.id && item.origin.message === message.id,
  );
  const text = escape(message.text).replace(/\n/g, "<br>");
  return `<li><div class="message-row ${message.sender ? "message-row--participant" : "message-row--own"} ${featured === message.id ? "message-row--featured" : ""} ${located === message.id ? "message-row--located" : ""}" data-message="${message.id}"><div class="message-stack">
    ${searching ? `<a href="#${thread.id}/${message.id}" class="result-origin">${escape(thread.title)}</a>` : ""}
    <article class="message-bubble" id="note-${message.id}">${message.sender ? `<p class="message-sender" data-sender-color="iris">${escape(message.sender)}</p>` : ""}<div class="note-body">${text}</div><div class="message-footer">${noteLabels(
      message,
    )
      .map((label) => `<span class="message-label">${escape(label)}</span>`)
      .join(
        "",
      )}<time class="message-time">${message.time}</time></div></article>
    <div class="message-actions" role="group" aria-label="Message actions at ${message.time}">
      <button class="message-action" type="button" data-note-action="labels" data-note="${thread.id}/${message.id}" aria-label="Change labels" title="Change labels">${icon("label")}</button>
      <button class="message-action" type="button" data-continue="${thread.id}/${message.id}" aria-label="Continue in subthread" title="Continue in subthread">${icon("branch")}</button>
      <button class="message-action" type="button" data-note-action="copy" data-note="${thread.id}/${message.id}" aria-label="Copy message" title="Copy message">${icon("copy")}</button>
      <button class="message-action" type="button" data-note-action="edit" data-note="${thread.id}/${message.id}" aria-label="Edit message" title="Edit message">${icon("edit")}</button>
      <button class="message-action message-action--danger" type="button" data-note-action="delete" data-note="${thread.id}/${message.id}" aria-label="Delete message" title="Delete message">${icon("trash")}</button>
    </div>
    </div></div>${!searching && branches.length ? `<div class="message-date-separator subthread-event">Continued in ${branches.map((branch) => `<a href="#${branch.id}">${escape(branch.title)}</a>`).join(" · ")}</div>` : ""}</li>`;
}
function renderHistory() {
  const thread = current();
  const query = $("#search").hidden
    ? ""
    : $("#search-input").value.trim().toLowerCase();
  const scope =
    query && $("#search-project").checked
      ? threads.filter((item) => item.root === thread.root)
      : [thread];
  const matches = scope.flatMap((owner) =>
    owner.messages
      .filter(
        (message) =>
          (!query ||
            `${message.text} ${message.sender ?? ""}`
              .toLowerCase()
              .includes(query)) &&
          (filter === "All" || noteLabels(message).includes(filter)),
      )
      .map((message) => ({ message, owner })),
  );
  $("#search-count").textContent = query ? `${matches.length} found` : "";
  $("#history").innerHTML =
    `<div class="message-timeline"><div class="message-date-separator">30 October 2026</div>${!query ? origin(thread) : ""}${thread.archived ? '<div class="message-date-separator subthread-event preview-archive-banner">Archived subthread · <a href="#restore">Restore</a></div>' : ""}<ol class="message-list">${matches.map(({ message, owner }) => messageHTML(message, owner, Boolean(query && $("#search-project").checked))).join("")}</ol>${matches.length ? "" : `<p class="preview-empty">${query ? "No matching messages." : filter !== "All" ? `No ${escape(filter.toLowerCase())} messages.` : ""}</p>`}</div>`;
}
function render() {
  renderRail();
  renderHeader();
  renderFilters();
  renderHistory();
  $("#message-input").value = drafts.get(active) ?? "";
  $("#message-input").placeholder =
    current().id === current().root
      ? "Add a note to this project…"
      : `Add a note to ${current().title}…`;
  $("#send-button").disabled = !$("#message-input").value.trim();
}
function openThread(id, message = null) {
  if (!find(id)) return;
  active = id;
  located = message;
  featured = null;
  editing = false;
  filter = "All";
  $("#edit-workspace").hidden = true;
  $("#chat").hidden = false;
  $("#search").hidden = true;
  $("#chat").classList.remove("workspace-chat--search");
  if (id !== current().root && !current().archived) {
    expandedRoot = current().root;
    expanded = true;
    if (
      sortedChildren(current().root).findIndex((thread) => thread.id === id) >=
      5
    )
      showAll = true;
  }
  render();
  if (message) $("#note-" + message)?.scrollIntoView({ block: "center" });
  else $("#history").scrollTop = 0;
  say(`${current().title} opened`);
}
function openProject(id) {
  expanded = active === id && !editing ? !expanded : true;
  expandedRoot = id;
  showAll = false;
  openThread(id);
}
function create(originValue = null) {
  pendingOrigin = originValue;
  dialogOpener = document.activeElement;
  $("#create-title").textContent = originValue
    ? "Continue in subthread"
    : "New subthread";
  $("#subthread-name").value = "";
  const owner = originValue ? find(originValue.thread) : parent(current());
  $("#create-origin").textContent = originValue
    ? `From ${owner.title} · ${owner.messages.find((message) => message.id === originValue.message).time}`
    : `In ${owner.title}`;
  $("#create-dialog").showModal();
}
function renderTitles() {
  $("#main-title-preview").innerHTML =
    `<header class="chat-header">${header(find("main"), true)}</header>`;
  $("#child-title-preview").innerHTML =
    `<header class="chat-header">${header(find("pricing") ?? children("main")[0], true)}</header>`;
  const longRoot = {
    ...find("main"),
    title:
      "Website redesign — customer experience, positioning, and the next stage of the product launch",
  };
  const longChild = {
    ...find("pricing"),
    id: "long-title-preview",
    root: "main",
    title:
      "Pricing experiment — comparing entry plans, team subscriptions, and annual billing alternatives",
  };
  $("#long-title-preview").innerHTML =
    `<header class="chat-header">${header(longChild, true, longRoot)}</header>`;
}
function openMessageAction(action, noteRef, opener) {
  const [threadId, messageId] = noteRef.split("/");
  const owner = find(threadId);
  const message = owner.messages.find((item) => item.id === messageId);
  if (action === "copy") {
    window.navigator.clipboard
      .writeText(message.text)
      .then(() => {
        opener.title = "Copied";
        say("Message copied");
      })
      .catch(() => say("Clipboard is unavailable in this preview."));
    return;
  }
  messageAction = { action, owner, message, opener };
  const titles = {
    labels: "Change labels",
    edit: "Edit message",
    delete: "Delete message?",
  };
  const content =
    action === "labels"
      ? `<div class="project-label-options">${owner.labels.map((label) => `<label class="project-label-option"><span class="edit-label-name">${escape(label)}</span><input type="checkbox" name="message-label" value="${escape(label)}" ${noteLabels(message).includes(label) ? "checked" : ""}/></label>`).join("")}</div>`
      : action === "edit"
        ? `<label class="field-label" for="edit-message-text">Message</label><textarea class="text-input mock-message-editor" id="edit-message-text" required>${escape(message.text)}</textarea>`
        : '<p class="field-help">Delete this message from the sample conversation? Reloading restores the preview.</p>';
  $("#message-form").innerHTML =
    `<h2 id="message-dialog-title">${titles[action]}</h2>${content}<div class="dialog-actions"><button class="button button-quiet" type="button" data-action="cancel-message">Cancel</button><button class="button ${action === "delete" ? "button-danger" : "button-primary"}" type="submit">${action === "delete" ? "Delete message" : "Save changes"}</button></div>`;
  $("#message-dialog").showModal();
}
function setScene(value) {
  scene = value;
  document
    .querySelectorAll("[data-scene]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scene === value),
      ),
    );
  $("#preview-shell").hidden = value === "titles";
  $("#title-comparison").hidden = value !== "titles";
  if (value === "titles") {
    renderTitles();
    return;
  }
  expandedRoot = "main";
  expanded = true;
  showAll = false;
  openThread(value === "subthread" ? (find("pricing")?.id ?? "main") : "main");
  if (value === "source") {
    featured = "source-pricing";
    renderHistory();
  }
}
function editView() {
  editing = true;
  const thread = current();
  $("#chat").hidden = true;
  $("#edit-workspace").hidden = false;
  $("#edit-workspace").setAttribute(
    "aria-label",
    thread.kind ? "Edit subthread" : "Edit project",
  );
  $("#edit-workspace").innerHTML =
    `<form class="project-edit-form project-settings-fields" id="edit-form"><div class="project-edit-actions"><button type="button" class="button button-quiet" data-action="back">Back to ${thread.kind ? "subthread" : "project"}</button><button class="button button-primary" type="submit">Save changes</button></div>
    ${thread.kind ? `<a class="edit-parent-link" href="#${thread.root}">${escape(parent(thread).title)}</a>` : ""}<label class="field-label" for="edit-name">${thread.kind ? "Subthread" : "Project"} name</label><input class="text-input" id="edit-name" maxlength="100" required value="${escape(thread.title)}" />
    ${thread.kind ? "" : `<fieldset class="accent-fieldset"><legend>Project accent</legend><div class="accent-options">${["coral", "amber", "moss", "ocean", "iris", "slate"].map((accent) => `<label class="accent-option" data-accent="${accent}" title="${accent}"><input type="radio" name="accent" value="${accent}" ${thread.accent === accent ? "checked" : ""} aria-label="${accent}"/><span class="accent-swatch"></span></label>`).join("")}</div></fieldset>`}
    <fieldset><legend>Message labels</legend><div class="project-label-options">${defaults()
      .labels.map(
        (label) =>
          `<label class="project-label-option"><span class="edit-label-symbol">${label === "Pin" ? "⌖" : label === "Attention" ? "!" : "◇"}</span><span class="edit-label-name">${label}</span><input type="checkbox" name="labels" value="${label}" ${thread.labels.includes(label) ? "checked" : ""} ${["Pin", "Attention"].includes(label) ? "disabled" : ""}/></label>`,
      )
      .join(
        "",
      )}<label class="project-label-option"><span class="edit-label-symbol">☆</span><input class="edit-custom-name" id="custom-label" aria-label="Custom label name" maxlength="8" placeholder="Label name" value="${escape(thread.customLabel ?? "")}"/><input type="checkbox" id="custom-enabled" aria-label="Enable custom label" ${thread.customLabel ? "checked" : ""}/></label></div><p class="field-help">Turning a label off keeps it on existing messages.</p></fieldset>
    <fieldset class="project-message-display-fieldset"><legend>Message display</legend><label class="project-message-display-option"><span>Collapse long messages by default</span><input type="checkbox" id="collapse-messages" ${thread.collapse ? "checked" : ""}/></label><p class="field-help">You can still expand or collapse each message.</p></fieldset>
    ${thread.kind ? `<div class="project-lifecycle-actions"><button type="button" class="button button-quiet" data-action="archive">${thread.archived ? "Restore" : "Archive"} subthread</button><p class="field-help">Archiving keeps all messages and files.</p><button type="button" class="button button-danger" data-action="delete">Delete subthread</button></div>` : ""}</form>`;
  $("#edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#edit-name").value.trim();
    if (!name) return;
    thread.title = name;
    thread.labels = [
      ...document.querySelectorAll('input[name="labels"]:checked'),
    ].map((input) => input.value);
    thread.customLabel = $("#custom-label").value.trim();
    if (thread.customLabel && $("#custom-enabled").checked)
      thread.labels.push(thread.customLabel);
    thread.collapse = $("#collapse-messages").checked;
    if (!thread.kind)
      thread.accent = document.querySelector(
        'input[name="accent"]:checked',
      ).value;
    openThread(thread.id);
    say("Changes saved in this preview");
  });
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const link = event.target.closest('a[href^="#"]');
  if (link) {
    event.preventDefault();
    if (link.hash === "#restore") {
      current().archived = false;
      openThread(active);
      return;
    }
    const [id, message] = link.hash.slice(1).split("/");
    if (scene === "titles") setScene("sidebar");
    if (find(id)?.id === find(id)?.root) {
      expandedRoot = id;
      expanded = true;
    }
    openThread(id, message);
    return;
  }
  if (!button) return;
  const data = button.dataset;
  if (data.scene) {
    setScene(data.scene);
    return;
  }
  if (data.section) {
    sections[data.section] = !sections[data.section];
    renderRail();
    $(`[data-section="${data.section}"]`).focus();
  }
  if (data.project) {
    openProject(data.project);
    $(`[data-project="${data.project}"]`).focus();
  }
  if (data.thread) {
    openThread(data.thread);
    $(`[data-thread="${data.thread}"]`)?.focus();
  }
  if (data.showAll) {
    showAll = !showAll;
    renderRail();
    $(`#show-all-${data.showAll}`).focus();
  }
  if (data.pin) {
    const thread = find(data.pin);
    thread.pinned = !thread.pinned;
    renderRail();
    $(`[data-pin="${data.pin}"]`)?.focus();
    say(`${thread.title} ${thread.pinned ? "pinned" : "unpinned"}`);
  }
  if (data.restore) {
    find(data.restore).archived = false;
    openThread(data.restore);
  }
  if (data.continue) {
    const [thread, message] = data.continue.split("/");
    create({ thread, message });
  }
  if (data.noteAction) openMessageAction(data.noteAction, data.note, button);
  if (data.action === "cancel-message") $("#message-dialog").close();
  if (data.filter) {
    filter = data.filter;
    renderFilters();
    renderHistory();
    [...document.querySelectorAll("[data-filter]")]
      .find((item) => item.dataset.filter === data.filter)
      ?.focus();
  }
  if (data.action === "create-independent") create();
  if (data.action === "search") {
    $("#search").hidden = !$("#search").hidden;
    $("#chat").classList.toggle("workspace-chat--search", !$("#search").hidden);
    renderHeader();
    renderHistory();
    if (!$("#search").hidden) $("#search-input").focus();
    else $('[data-action="search"]').focus();
  }
  if (data.action === "edit") editView();
  if (data.action === "back") openThread(active);
  if (data.action === "archive") {
    const thread = current();
    thread.archived = !thread.archived;
    thread.pinned = false;
    openThread(thread.archived ? thread.root : thread.id);
  }
  if (data.action === "delete") {
    $("#delete-dialog").returnValue = "";
    $("#delete-dialog").showModal();
  }
});
$("#create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const title = $("#subthread-name").value.trim();
  if (!title) return;
  const root = parent(current()).id;
  const id = `new-${nextId++}`;
  threads.push({
    ...defaults(),
    labels: [...parent(current()).labels],
    collapse: parent(current()).collapse,
    id,
    root,
    title,
    kind: pendingOrigin ? "continued" : "independent",
    origin: pendingOrigin,
    messages: [],
  });
  $("#create-dialog").close();
  expanded = true;
  openThread(id);
  $("#message-input").focus();
});
$("#message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const { action, owner, message } = messageAction;
  if (action === "labels")
    message.tags = [
      ...noteLabels(message).filter((label) => !owner.labels.includes(label)),
      ...[
        ...document.querySelectorAll('input[name="message-label"]:checked'),
      ].map((input) => input.value),
    ];
  if (action === "edit") {
    const text = $("#edit-message-text").value.trim();
    if (!text) return;
    message.text = text;
  }
  if (action === "delete")
    owner.messages.splice(owner.messages.indexOf(message), 1);
  $("#message-dialog").close();
  renderRail();
  renderFilters();
  renderHistory();
  $("#message-input").focus();
});
$("#message-dialog").addEventListener("close", () => {
  if (messageAction?.opener.isConnected) messageAction.opener.focus();
});
$("#cancel-create").addEventListener("click", () =>
  $("#create-dialog").close(),
);
$("#create-dialog").addEventListener("close", () => {
  if (dialogOpener?.isConnected) dialogOpener.focus();
});
$("#delete-dialog").addEventListener("close", () => {
  if ($("#delete-dialog").returnValue !== "delete") return;
  const root = current().root;
  threads.splice(
    threads.findIndex((thread) => thread.id === active),
    1,
  );
  openThread(root);
});
$("#preview-theme").addEventListener("change", (event) => {
  document.documentElement.dataset.theme = event.target.value;
});
$("#search-input").addEventListener("input", renderHistory);
$("#search-project").addEventListener("change", renderHistory);
$("#message-input").addEventListener("input", () => {
  drafts.set(active, $("#message-input").value);
  $("#send-button").disabled = !$("#message-input").value.trim();
});
$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#message-input").value.trim();
  if (!text) return;
  current().messages.push(note(`sample-${nextId++}`, text, "10:40"));
  drafts.delete(active);
  render();
  $("#message-input").focus();
});
$("#message-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#search-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("#search").hidden = true;
    $("#chat").classList.remove("workspace-chat--search");
    renderHeader();
    renderHistory();
    $('[data-action="search"]').focus();
  }
});
const entry = new window.URLSearchParams(window.location.search).get("view");
setScene(
  ["sidebar", "source", "subthread", "titles"].includes(entry)
    ? entry
    : "sidebar",
);
