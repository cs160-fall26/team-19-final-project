/**
 * Hands-on editing for generated designs. The design runs in a sandboxed
 * iframe, so the editor is a script injected into the page itself; it talks to
 * the app only through postMessage.
 */

export const EDITOR_MESSAGE = {
  /** Frame → app: the edit history changed; carries canUndo and canRedo. */
  changed: "wml:changed",
  /** App → frame: step back or forward through the edit history. */
  undo: "wml:undo",
  redo: "wml:redo",
  /** App → frame: an editing key pressed while the focus was in the app. */
  key: "wml:key",
  /** App → frame: send back the edited page. */
  requestHtml: "wml:get-html",
  /** Frame → app: the edited page, with editor traces removed. */
  html: "wml:html",
} as const;

// Runs inside the design. Kept dependency-free and ES2017-safe.
const EDITOR_SCRIPT = String.raw`
(function () {
  var SELECTED = "data-wml-selected";
  var selected = null;
  var drag = null;

  var style = document.createElement("style");
  style.id = "wml-editor-style";
  style.textContent =
    "html.wml-editing, html.wml-editing * { cursor: default; user-select: none; -webkit-user-drag: none; }" +
    "html.wml-editing [data-layer]:hover { outline: 1px dashed rgba(0,0,0,.4); outline-offset: 2px; }" +
    "[" + SELECTED + "] { outline: 2px solid #CCFF00 !important; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(0,0,0,.25) !important; cursor: move !important; }" +
    "[data-wml-text] { cursor: text !important; user-select: text !important; -webkit-user-select: text !important; outline: 2px dashed #CCFF00 !important; }";
  document.head.appendChild(style);
  document.documentElement.classList.add("wml-editing");

  // Edit history. Each entry can be applied in either direction; elements are
  // kept by reference, since editing never recreates them.
  var undoStack = [];
  var redoStack = [];

  function changed() {
    parent.postMessage({ type: "wml:changed", canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }, "*");
  }

  function record(entry) {
    undoStack.push(entry);
    redoStack = [];
    changed();
  }

  function styleOf(el) {
    return { translate: el.style.getPropertyValue("translate"), display: el.style.getPropertyValue("display") };
  }

  function setStyle(el, state) {
    ["translate", "display"].forEach(function (prop) {
      if (state[prop]) el.style.setProperty(prop, state[prop]);
      else el.style.removeProperty(prop);
    });
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }

  function apply(entry, backwards) {
    if (entry.kind === "style") {
      setStyle(entry.el, backwards ? entry.before : entry.after);
    } else if (entry.kind === "remove") {
      if (backwards) entry.parent.insertBefore(entry.el, entry.next);
      else entry.el.remove();
    } else if (entry.kind === "text") {
      entry.el.innerHTML = backwards ? entry.before : entry.after;
    }
  }

  function undo() {
    stopEditingText();
    var entry = undoStack.pop();
    if (!entry) return;
    select(null);
    apply(entry, true);
    redoStack.push(entry);
    changed();
  }

  function redo() {
    stopEditingText();
    var entry = redoStack.pop();
    if (!entry) return;
    select(null);
    apply(entry, false);
    undoStack.push(entry);
    changed();
  }

  // Clicks pick the nearest named layer; Alt/Option-click picks exactly what is under the pointer.
  function pick(el, exact) {
    if (!(el instanceof Element)) return null;
    if (el === document.body || el === document.documentElement) return null;
    if (exact) return el;
    return el.closest("[data-layer]") || el;
  }

  function select(el) {
    if (selected) selected.removeAttribute(SELECTED);
    selected = el;
    if (el) el.setAttribute(SELECTED, "");
  }

  function offset(el) {
    var parts = (el.style.translate || "0px 0px").split(" ");
    return { x: parseFloat(parts[0]) || 0, y: parseFloat(parts[1]) || 0 };
  }

  function moveBy(el, dx, dy) {
    var before = styleOf(el);
    // translate does not apply to inline boxes.
    if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
    var o = offset(el);
    el.style.translate = Math.round(o.x + dx) + "px " + Math.round(o.y + dy) + "px";
    // A run of arrow-key nudges on one element undoes as a single step.
    var last = undoStack[undoStack.length - 1];
    var now = Date.now();
    if (last && last.kind === "style" && last.nudge && last.el === el && now - last.at < 1000 && redoStack.length === 0) {
      last.after = styleOf(el);
      last.at = now;
      changed();
    } else {
      record({ kind: "style", el: el, before: before, after: styleOf(el), nudge: true, at: now });
    }
  }

  // The element whose text is being edited, if any.
  var textEl = null;
  var textBefore = "";
  var markupBefore = "";

  function stopEditingText() {
    if (!textEl) return;
    var el = textEl;
    textEl = null;
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-wml-text");
    if (el.textContent !== textBefore) {
      record({ kind: "text", el: el, before: markupBefore, after: el.innerHTML });
    }
  }

  function hasOwnText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3 && node.nodeValue.trim()) return true;
    }
    return false;
  }

  // Only the element that directly holds the clicked text becomes editable,
  // never a container of other pieces: editing a container would let its
  // children be dragged into its text.
  function textTarget(el) {
    while (el && el instanceof Element && el !== document.body) {
      if (hasOwnText(el)) return el;
      if (el.children.length > 0) return null;
      el = el.parentElement;
    }
    return null;
  }

  function inEditedText(node) {
    return textEl !== null && node instanceof Node && textEl.contains(node);
  }

  document.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    if (inEditedText(e.target)) return;
    stopEditingText();
    var el = pick(e.target, e.altKey);
    select(el);
    if (!el) return;
    e.preventDefault();
    var o = offset(el);
    drag = { el: el, startX: e.clientX, startY: e.clientY, x: o.x, y: o.y, moved: false, before: styleOf(el) };
    document.documentElement.setPointerCapture && document.documentElement.setPointerCapture(e.pointerId);
  }, true);

  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    if (getComputedStyle(drag.el).display === "inline") drag.el.style.display = "inline-block";
    drag.el.style.translate = Math.round(drag.x + dx) + "px " + Math.round(drag.y + dy) + "px";
  }, true);

  document.addEventListener("pointerup", function () {
    if (drag && drag.moved) {
      record({ kind: "style", el: drag.el, before: drag.before, after: styleOf(drag.el) });
    }
    drag = null;
  }, true);

  // Links and buttons in the design should not navigate or submit while editing.
  document.addEventListener("click", function (e) {
    if (!inEditedText(e.target)) e.preventDefault();
  }, true);

  // The browser's own drag-and-drop would move elements into other elements
  // (for example into a heading). Moving is done only by the drag above.
  ["dragstart", "dragover", "drop"].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); }, true);
  });

  // Text edits are plain typing only: nothing can be dropped or pasted in as markup.
  document.addEventListener("beforeinput", function (e) {
    if (!inEditedText(e.target)) { e.preventDefault(); return; }
    if (e.inputType === "insertFromDrop" || e.inputType === "deleteByDrag") e.preventDefault();
  }, true);

  document.addEventListener("dblclick", function (e) {
    var el = textTarget(e.target);
    if (!el) return;
    if (el instanceof SVGElement && !(el instanceof SVGTextElement || el instanceof SVGTSpanElement)) return;
    e.preventDefault();
    stopEditingText();
    select(null);
    textEl = el;
    textBefore = el.textContent;
    markupBefore = el.innerHTML;
    el.setAttribute("data-wml-text", "");
    // plaintext-only keeps pasted text from bringing in markup.
    el.setAttribute("contenteditable", "plaintext-only");
    if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
    el.focus();
  }, true);

  document.addEventListener("keydown", function (e) {
    var mod = e.metaKey || e.ctrlKey;
    var key = e.key.toLowerCase();
    // While typing, the browser's own undo works inside the text.
    if (mod && !textEl && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (textEl) {
      if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        stopEditingText();
      }
      return;
    }
    if (handleKey(e.key, e.shiftKey)) e.preventDefault();
  }, true);

  // Keys that act on the selected piece; also used for keys the app forwards.
  function handleKey(key, shift) {
    if (!selected) return false;
    var step = shift ? 10 : 1;
    var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[key]) {
      moveBy(selected, moves[key][0], moves[key][1]);
      return true;
    }
    if (key === "Delete" || key === "Backspace") {
      var gone = selected;
      select(null);
      var entry = { kind: "remove", el: gone, parent: gone.parentNode, next: gone.nextSibling };
      gone.remove();
      record(entry);
      return true;
    }
    if (key === "Escape") {
      select(null);
      return true;
    }
    return false;
  }

  window.addEventListener("message", function (e) {
    if (!e.data) return;
    if (e.data.type === "wml:undo") { undo(); return; }
    if (e.data.type === "wml:redo") { redo(); return; }
    if (e.data.type === "wml:key") { if (!textEl) handleKey(e.data.key, e.data.shiftKey); return; }
    if (e.data.type !== "wml:get-html") return;
    stopEditingText();
    var copy = document.documentElement.cloneNode(true);
    copy.classList.remove("wml-editing");
    if (!copy.getAttribute("class")) copy.removeAttribute("class");
    ["#wml-editor-style", "#wml-editor-script"].forEach(function (id) {
      var node = copy.querySelector(id);
      if (node) node.remove();
    });
    copy.querySelectorAll("[" + SELECTED + "]").forEach(function (n) { n.removeAttribute(SELECTED); });
    copy.querySelectorAll("[data-wml-text]").forEach(function (n) {
      n.removeAttribute("data-wml-text");
      n.removeAttribute("contenteditable");
    });
    parent.postMessage({ type: "wml:html", requestId: e.data.requestId, html: "<!DOCTYPE html>\n" + copy.outerHTML }, "*");
  });
})();
`;

/** The design with the editor script added at the end of the page. */
export function withEditor(html: string): string {
  const tag = `<script id="wml-editor-script">${EDITOR_SCRIPT}</script>`;
  const end = html.toLowerCase().lastIndexOf("</body>");
  return end === -1 ? html + tag : html.slice(0, end) + tag + html.slice(end);
}

/** Steps an editing frame back or forward through its edit history. */
export function sendEditorCommand(
  frame: HTMLIFrameElement | null,
  command: "undo" | "redo",
) {
  // The sandboxed frame has an opaque origin, so "*" is the only target that reaches it.
  frame?.contentWindow?.postMessage({ type: EDITOR_MESSAGE[command] }, "*");
}

/** Keys the editor acts on when the focus is in the app rather than the design. */
export const EDITOR_KEYS = new Set([
  "Delete",
  "Backspace",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

export function sendEditorKey(
  frame: HTMLIFrameElement | null,
  key: string,
  shiftKey: boolean,
) {
  frame?.contentWindow?.postMessage({ type: EDITOR_MESSAGE.key, key, shiftKey }, "*");
}

/** Asks an editing frame for its page; resolves with the cleaned HTML. */
export function readEditedHtml(frame: HTMLIFrameElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = frame.contentWindow;
    if (!target) {
      reject(new Error("The design is not loaded."));
      return;
    }
    const requestId = `${Date.now()}-${Math.random()}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The design did not respond. Try again."));
    }, 5000);
    function onMessage(event: MessageEvent) {
      if (event.source !== target) return;
      const data = event.data as { type?: string; requestId?: string; html?: unknown };
      if (data?.type !== EDITOR_MESSAGE.html || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (typeof data.html === "string") resolve(data.html);
      else reject(new Error("The design sent back nothing."));
    }
    window.addEventListener("message", onMessage);
    // The sandboxed frame has an opaque origin, so "*" is the only target that reaches it.
    target.postMessage({ type: EDITOR_MESSAGE.requestHtml, requestId }, "*");
  });
}
