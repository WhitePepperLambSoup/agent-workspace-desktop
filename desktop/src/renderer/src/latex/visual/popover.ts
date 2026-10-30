// Floating editor used by the visual editor's node views: one or more
// fields (LaTeX source, caption, width …) with an optional live preview.
// Plain DOM so it can be opened from ProseMirror node views.
import { setHtml } from "./math";

export interface PopoverField {
  key: string;
  label?: string;
  value: string;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
}

export interface PopoverOptions {
  anchor: HTMLElement;
  title: string;
  fields: PopoverField[];
  /** Render a preview of the current values (HTML string). */
  preview?: (values: Record<string, string>) => string;
  onSave: (values: Record<string, string>) => void;
  onCancel?: () => void;
  saveLabel: string;
  cancelLabel: string;
  /** Extra buttons (e.g. "Delete"). */
  actions?: { label: string; danger?: boolean; run: () => void }[];
}

let current: { close: (save: boolean) => void } | null = null;

export function closePopover(save = true) {
  current?.close(save);
}

export function isPopoverOpen(): boolean {
  return current !== null;
}

export function openPopover(opts: PopoverOptions): void {
  closePopover(true);
  const root = document.createElement("div");
  root.className = "vis-popover";
  root.setAttribute("role", "dialog");
  const title = document.createElement("div");
  title.className = "vis-popover-title";
  title.textContent = opts.title;
  root.appendChild(title);

  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  for (const f of opts.fields) {
    const wrap = document.createElement("label");
    wrap.className = "vis-popover-field";
    if (f.label) {
      const l = document.createElement("span");
      l.textContent = f.label;
      wrap.appendChild(l);
    }
    const input = f.multiline ? document.createElement("textarea") : document.createElement("input");
    input.className = `input vis-popover-input${f.mono ? " mono" : ""}`;
    input.value = f.value;
    input.spellcheck = false;
    if (f.placeholder) input.placeholder = f.placeholder;
    input.dataset.key = f.key;
    if (input instanceof HTMLTextAreaElement) {
      input.rows = Math.min(14, Math.max(3, f.value.split("\n").length + 1));
    }
    inputs[f.key] = input;
    wrap.appendChild(input);
    root.appendChild(wrap);
  }

  const preview = document.createElement("div");
  preview.className = "vis-popover-preview";
  if (opts.preview) root.appendChild(preview);
  const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
  const refresh = () => {
    if (!opts.preview) return;
    try {
      setHtml(preview, opts.preview(values()));
    } catch {
      preview.textContent = "";
    }
  };

  const bar = document.createElement("div");
  bar.className = "vis-popover-actions";
  for (const a of opts.actions ?? []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn-sm${a.danger ? " btn-danger" : ""} vis-popover-extra`;
    b.textContent = a.label;
    b.addEventListener("click", () => {
      close(false, true);
      a.run();
    });
    bar.appendChild(b);
  }
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  bar.appendChild(spacer);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-sm vis-popover-cancel";
  cancel.textContent = opts.cancelLabel;
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn btn-sm btn-primary vis-popover-save";
  save.textContent = opts.saveLabel;
  bar.append(cancel, save);
  root.appendChild(bar);

  // inside the app's shell, which carries the colour mode the tokens follow
  (opts.anchor.closest("[data-color-mode]") ?? document.body).appendChild(root);
  // position under the anchor, kept inside the window
  const r = opts.anchor.getBoundingClientRect();
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  root.style.top = `${top}px`;
  root.style.left = `${left}px`;

  let closed = false;
  function close(doSave: boolean, silent = false) {
    if (closed) return;
    closed = true;
    current = null;
    document.removeEventListener("pointerdown", onOutside, true);
    root.remove();
    if (silent) return;
    if (doSave) opts.onSave(values());
    else opts.onCancel?.();
  }
  function onOutside(e: PointerEvent) {
    if (!root.contains(e.target as Node)) close(true);
  }
  setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  save.addEventListener("click", () => close(true));
  cancel.addEventListener("click", () => close(false));
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !(e.target instanceof HTMLTextAreaElement))) {
      e.preventDefault();
      close(true);
    }
  });
  for (const el of Object.values(inputs)) el.addEventListener("input", refresh);
  refresh();
  current = { close };
  const first = Object.values(inputs)[0];
  first?.focus();
  if (first && "select" in first) first.select();
}
