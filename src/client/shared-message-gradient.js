/* global HTMLElement, customElements, ResizeObserver, MutationObserver */

// Used by both the React timeline and the standalone UI cookbook.
class SharedMessageGradient extends HTMLElement {
  static observedAttributes = ["active"];

  connectedCallback() {
    this.sync();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.sync();
  }

  disconnectedCallback() {
    this.stopObserving();
  }

  stopObserving() {
    this.resize?.disconnect();
    this.mutations?.disconnect();
    this.resize = undefined;
    this.mutations = undefined;
  }

  sync() {
    this.stopObserving();
    if (!this.hasAttribute("active") || typeof ResizeObserver === "undefined")
      return;

    const align = () => this.align();
    this.resize = new ResizeObserver(align);
    const boxes = ".message-bubble, .message-row, .message-day";
    let observed = new Set();
    this.resize.observe(this);
    const refresh = () => {
      const next = new Set(this.querySelectorAll(boxes));
      let added = false;
      for (const box of observed) {
        if (!next.has(box)) this.resize.unobserve(box);
      }
      for (const box of next) {
        if (!observed.has(box)) {
          this.resize.observe(box);
          added = true;
        }
      }
      observed = next;
      // Newly observed boxes get an initial resize delivery before paint.
      if (!added) align();
    };
    const movesMessages = boxes + ", .thread-continuation, .message-sender";
    const containsLayout = (node) =>
      node.nodeType === 1 &&
      (node.matches(movesMessages) || node.querySelector(movesMessages));
    this.mutations = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === "attributes" ||
            [...record.addedNodes, ...record.removedNodes].some(containsLayout),
        )
      )
        refresh();
    });
    this.mutations.observe(this, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-participant"],
    });
    refresh();
  }

  align() {
    const boxes = [];
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const bubble of this.querySelectorAll(
      ".message-row--own .message-bubble, .project-search-result:not([data-participant])",
    )) {
      const rect = bubble.getBoundingClientRect();
      const { width, height } = rect;
      if (!width || !height) continue;
      // The stack stays put while a newly sent bubble animates into place.
      const origin =
        bubble.closest(".message-stack")?.getBoundingClientRect() ?? rect;
      boxes.push({ bubble, x: origin.left, y: origin.top, width, height });
      left = Math.min(left, origin.left);
      top = Math.min(top, origin.top);
      right = Math.max(right, origin.left + width);
      bottom = Math.max(bottom, origin.top + height);
    }
    const fieldWidth = right - left;
    const fieldHeight = bottom - top;
    for (const { bubble, x, y, width, height } of boxes) {
      // Background position percentages use the difference between box and image sizes.
      // Ratios also keep the field aligned at browser and CSS zoom levels.
      const posX = fieldWidth > width ? (x - left) / (fieldWidth - width) : 0;
      const posY =
        fieldHeight > height ? (y - top) / (fieldHeight - height) : 0;
      bubble.style.setProperty(
        "--message-gradient-size",
        `${(100 * fieldWidth) / width}% ${(100 * fieldHeight) / height}%`,
      );
      bubble.style.setProperty(
        "--message-gradient-position",
        `${100 * posX}% ${100 * posY}%`,
      );
    }
  }
}

customElements.define("shared-message-gradient", SharedMessageGradient);
