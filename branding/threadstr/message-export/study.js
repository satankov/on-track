/* global document, window, navigator, Blob, URL, setTimeout */
// Fictional, paired editorial samples. This study is not a general Markdown converter.
const notes = [
  {
    day: 16,
    time: "09:10",
    sender: "Maya",
    label: "Decision",
    md: "Use the **east entrance** on Mill Lane. The front steps are closed for repairs.",
    txt: "Use the east entrance on Mill Lane. The front steps are closed for repairs.",
  },
  {
    day: 16,
    time: "09:12",
    txt: "Ask the landlord about the deposit separately.",
  },
  {
    day: 16,
    time: "09:18",
    label: "Action",
    md: "Before the van arrives:\n\n- [x] Reserve the loading bay until 10:00.\n- [ ] Leave the lift key with reception.",
    txt: "Before the van arrives:\n\n[x] Reserve the loading bay until 10:00.\n[ ] Leave the lift key with reception.",
  },
  {
    day: 17,
    time: "08:05",
    sender: "Maya",
    label: "Update",
    files: 1,
    txt: "Reception has the key. Meet the driver at 09:30.",
  },
  { day: 17, time: "08:12", txt: "Put the spare packing tape in my bag." },
];
const checked = new Set([0, 2, 3]);
const into = (id) => document.getElementById(id);
const radios = [...document.querySelectorAll('[name="format"]')];
let selecting = true;
let lastPick;
let opener = 0;
let artifact;
function element(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function number(n, noun) {
  return n + " " + noun + (n === 1 ? "" : "s");
}
function setOutput() {
  const textMode = radios[1].checked;
  const ext = textMode ? "txt" : "md";
  const selection = notes.filter((_, i) => checked.has(i));
  if (!selection.length) return;
  const parts = [];
  function line(content, kind, marker = "", end = "") {
    const span = element("span", kind);
    if (marker) span.append(element("span", "syntax", marker));
    span.append(content);
    if (end) span.append(element("span", "syntax", end));
    parts.push(span);
  }
  const gap = () => parts.push(element("span", "doc-gap", "\n\n"));
  line("Riverside Move / Move day", "doc-title", textMode ? "" : "# ");
  gap();
  line(
    number(selection.length, "selected message") + " · Times in Europe/London",
    "doc-detail",
  );
  let day = 0;
  for (const note of selection) {
    if (day !== note.day) {
      day = note.day;
      gap();
      line(day + " November 2026", "doc-day", textMode ? "" : "## ");
    }
    gap();
    const labels =
      into("labels").checked && note.label ? " · " + note.label : "";
    line(
      note.time + " · " + (note.sender || "Notebook owner") + labels,
      "doc-byline",
      textMode ? "" : "**",
      textMode ? "" : "**",
    );
    gap();
    line(textMode ? note.txt : (note.md ?? note.txt), "");
    if (note.files) {
      gap();
      line(number(note.files, "attachment") + " omitted.", "doc-detail");
    }
  }
  parts.push("\n");
  into("manual-copy").hidden = true;
  into("preview").hidden = false;
  into("preview").replaceChildren(...parts);
  const filename =
    "riverside-move_move-day_2026-11-" + selection[0].day + "." + ext;
  artifact = {
    text: into("preview").textContent,
    filename,
    type: textMode ? "text/plain" : "text/markdown",
  };
  into("title").textContent = "Export " + number(selection.length, "message");
  into("filename").textContent = filename;
  into("download").textContent = "Download ." + ext;
  into("notice").textContent = "";
}
function drawTimeline() {
  const target = into("timeline");
  target.replaceChildren();
  let currentDay, list;
  notes.forEach((note, i) => {
    if (note.day !== currentDay) {
      currentDay = note.day;
      const group = element("section", "message-day");
      list = element("ul", "message-list");
      group.append(
        element("h2", "message-date-separator", note.day + " November 2026"),
        list,
      );
      target.append(group);
    }
    const row = element(
      "li",
      "message-row message-row--" + (note.sender ? "participant" : "own"),
    );
    if (selecting) {
      row.dataset.selected = String(checked.has(i));
      const label = element("label", "message-selection-check");
      const input = element("input");
      input.type = "checkbox";
      input.checked = checked.has(i);
      input.setAttribute(
        "aria-label",
        "Select " + note.time + " message: " + note.txt.split("\n")[0],
      );
      input.addEventListener("click", (event) => {
        if (event.shiftKey && lastPick !== undefined) {
          for (let j = Math.min(lastPick, i); j <= Math.max(lastPick, i); j++)
            checked.add(j);
        } else if (input.checked) checked.add(i);
        else checked.delete(i);
        lastPick = i;
        syncChecks();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === " " && event.shiftKey && lastPick !== undefined) {
          event.preventDefault();
          for (let j = Math.min(lastPick, i); j <= Math.max(lastPick, i); j++)
            checked.add(j);
          lastPick = i;
          syncChecks();
        }
      });
      label.append(input);
      row.append(label);
    }
    const stack = element("div", "message-stack");
    const bubble = element("article", "message-bubble");
    if (note.sender) bubble.append(element("p", "message-sender", note.sender));
    bubble.append(element("p", "note-body", note.txt));
    if (note.files)
      bubble.append(element("p", "field-help", "Attached: east-entrance.jpg"));
    const meta = element("div", "message-meta");
    if (note.label) meta.append(element("span", "message-label", note.label));
    meta.append(element("span", "message-time", note.time));
    bubble.append(meta);
    stack.append(bubble);
    if (!selecting) {
      const menu = element("details");
      const more = element("summary", "", "More");
      more.id = "more-" + i;
      const select = element(
        "button",
        "button button-quiet",
        "Select messages",
      );
      select.onclick = () => {
        opener = lastPick = i;
        checked.add(i);
        selecting = true;
        drawTimeline();
        const checkbox = document.querySelectorAll("#timeline input")[i];
        checkbox.focus({ preventScroll: true });
      };
      menu.append(more, select);
      stack.append(menu);
    }
    row.append(stack);
    list.append(row);
  });
  syncChecks();
  into("selection").hidden = !selecting;
  into("draft").hidden = selecting;
}
function syncChecks() {
  document.querySelectorAll("#timeline input").forEach((input, i) => {
    input.checked = checked.has(i);
    input.closest("li").dataset.selected = String(input.checked);
  });
  into("count").textContent = checked.size + " selected";
  into("open").disabled = !checked.size;
}
function showExport() {
  if (!checked.size) return;
  setOutput();
  into("chat").hidden = true;
  into("export").hidden = false;
  into("title").focus();
}
function back() {
  into("export").hidden = true;
  into("chat").hidden = false;
  into("open").focus({ preventScroll: true });
}
function cancel() {
  checked.clear();
  lastPick = undefined;
  selecting = false;
  drawTimeline();
  into("more-" + opener).focus({ preventScroll: true });
}
into("all").onclick = () => {
  notes.forEach((_, i) => checked.add(i));
  syncChecks();
};
into("open").onclick = showExport;
into("back").onclick = back;
into("cancel").onclick = cancel;
radios.forEach((r) => (r.onchange = setOutput));
into("labels").onchange = setOutput;
into("copy").onclick = async () => {
  const current = artifact;
  try {
    await navigator.clipboard.writeText(current.text);
    if (current === artifact && !into("export").hidden)
      into("notice").textContent = "Text copied.";
  } catch {
    if (current === artifact && !into("export").hidden) {
      into("notice").textContent =
        "Clipboard unavailable. The preview text is selected; copy it manually.";
      const field = into("manual-copy");
      field.value = current.text;
      into("preview").hidden = true;
      field.hidden = false;
      field.focus();
      field.select();
    }
  }
};
into("download").onclick = () => {
  let url;
  try {
    url = URL.createObjectURL(
      new Blob([artifact.text], { type: artifact.type + ";charset=utf-8" }),
    );
    const a = element("a");
    a.href = url;
    a.download = artifact.filename;
    document.body.append(a);
    try {
      a.click();
    } finally {
      a.remove();
    }
    into("notice").textContent = "Download requested.";
  } catch {
    into("notice").textContent =
      "Couldn’t start the download. Try again or use Copy text.";
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!into("export").hidden) back();
  else if (selecting) cancel();
});
drawTimeline();
setOutput();
if (window.location.hash === "#selection") back();
if (window.location.hash === "#history") {
  back();
  cancel();
}
