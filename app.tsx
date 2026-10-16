// bb-plugin-expand-thinking — frontend entry.
//
// A content script that opens every reasoning row ("Thought" / "Thinking…")
// in the thread timeline as it mounts. BB keeps reasoning expansion in an
// in-memory React map with no public setting, so the only lever is clicking
// the row header the same way a person would. Once opened, BB remembers the
// row's state itself, so virtualized remounts stay open.
//
// Because this leans on BB's internal DOM, it also checks itself on every
// load. If a BB update breaks an assumption, it shows a small banner with a
// copyable prompt describing the failure, so an agent can fix the selectors.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const PLUGIN_SOURCE = "https://github.com/ShamanicArts/bb-plugin-expand-thinking; `bb plugin list` shows the local checkout";

// --- DOM assumptions (update these when BB changes) ------------------------
// Every timeline row is wrapped in an element carrying its row id.
const ROW_SELECTOR = "[data-timeline-row-id]";
// Generic timeline rows render their header toggle inside this group.
const HEADER_SELECTOR = '[class~="group/timeline-row"] button[aria-expanded]';
// Reasoning headers read "Thought" + duration, or "Thinking…" while streaming.
const REASONING_LABEL = /^\s*(Thought|Thinking)(?![a-z])/;

const TOGGLE_VERIFY_MS = 1500;
const MISS_CONFIRM_MS = 2000;
const DISMISS_STORAGE_KEY = "bb-plugin-expand-thinking:dismissed";

type Failure = { check: string; summary: string; details: string };

function isReasoningHeader(el: Element): el is HTMLButtonElement {
  return el instanceof HTMLButtonElement && REASONING_LABEL.test(el.textContent ?? "");
}

/** A visible leaf element reading exactly like a reasoning header, if any. */
function visibleReasoningLabel(): Element | null {
  const result = document.evaluate(
    `//*[not(*) and (normalize-space()="Thought" or normalize-space()="Thinking…")]`,
    document.body,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  for (let i = 0; i < result.snapshotLength; i++) {
    const node = result.snapshotItem(i);
    if (node instanceof HTMLElement && node.offsetParent !== null) return node;
  }
  return null;
}

function rowKey(header: Element): string | null {
  return header.closest(ROW_SELECTOR)?.getAttribute("data-timeline-row-id") ?? null;
}

/** Fingerprint of the running BB frontend build; changes on every update. */
function buildFingerprint(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script?.src.split("/").pop() ?? "unknown";
}

function fixPrompt(failure: Failure): string {
  return [
    `My BB plugin "Expand Thinking" (${PLUGIN_SOURCE}; logic in app.tsx) auto-expands reasoning`,
    `("Thought" / "Thinking…") rows in the BB thread timeline. Its self-check failed, most likely`,
    `because a BB update changed the timeline DOM.`,
    ``,
    `Failed check: ${failure.check} — ${failure.summary}`,
    `Details: ${failure.details}`,
    `BB frontend build: ${buildFingerprint()}`,
    `Time: ${new Date().toISOString()}`,
    ``,
    `The script assumes:`,
    `- timeline rows match ${ROW_SELECTOR}`,
    `- the reasoning row header is ${HEADER_SELECTOR}, with text matching ${REASONING_LABEL}`,
    `- clicking that header flips aria-expanded to "true"`,
    ``,
    `Please inspect the current BB frontend bundle (app/dist/assets inside the BB install; find it`,
    `via \`readlink -f "$(command -v bb)"\` — do NOT run filesystem-wide searches). Search the bundles`,
    `for \`operationKind===\\\`reasoning\\\`\` and \`reasoningExpansionKey\` to find the reasoning row`,
    `renderer. Update the selectors/logic in app.tsx, run \`bb plugin build\` in the plugin dir, then`,
    `\`bb plugin reload expand-thinking\`, and confirm thinking rows open by default again.`,
  ].join("\n");
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function showBanner(failure: Failure, signal: AbortSignal): void {
  const signature = `${buildFingerprint()}|${failure.check}`;
  if (localStorage.getItem(DISMISS_STORAGE_KEY) === signature) return;
  if (document.getElementById("bb-expand-thinking-banner")) return;

  const banner = document.createElement("div");
  banner.id = "bb-expand-thinking-banner";
  banner.setAttribute("role", "alert");
  banner.style.cssText = [
    "position:fixed", "right:16px", "bottom:16px", "z-index:2147483000", "max-width:420px",
    "padding:12px 14px", "border-radius:10px", "font:12px/1.45 system-ui,sans-serif",
    "background:var(--popover, var(--canvas, #1c1c1c))", "color:var(--popover-foreground, var(--ink, #eee))",
    "border:1px solid var(--destructive-text, #e5484d)", "box-shadow:0 8px 30px rgba(0,0,0,.35)",
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;margin-bottom:4px";
  title.textContent = "Expand Thinking stopped working with this BB build";
  const body = document.createElement("div");
  body.style.cssText = "opacity:.85;margin-bottom:10px";
  body.textContent = `${failure.summary}. Copy the fix prompt and hand it to an agent.`;

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
  const button = (label: string, primary: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = [
      "cursor:pointer", "padding:4px 10px", "border-radius:6px", "font:inherit",
      "border:1px solid var(--border, #444)",
      primary ? "background:var(--primary, #3b82f6);color:var(--primary-foreground, #fff)" : "background:transparent;color:inherit",
    ].join(";");
    return b;
  };
  const copy = button("Copy fix prompt", true);
  copy.addEventListener("click", () => {
    void copyText(fixPrompt(failure)).then(() => (copy.textContent = "Copied"));
  }, { signal });
  const dismiss = button("Dismiss", false);
  dismiss.addEventListener("click", () => {
    localStorage.setItem(DISMISS_STORAGE_KEY, signature);
    banner.remove();
  }, { signal });

  actions.append(dismiss, copy);
  banner.append(title, body, actions);
  document.body.append(banner);
  signal.addEventListener("abort", () => banner.remove());
}

function startExpander(signal: AbortSignal): void {
  // Rows the user collapsed by hand stay collapsed. Rows without an id
  // (e.g. a live "Thinking…" indicator) are tracked by element instead.
  const userCollapsedRows = new Set<string>();
  const userCollapsedElements = new WeakSet<Element>();
  const attempts = new WeakMap<Element, number>();
  const missSince = new Map<string, number>();
  const timers = new Set<number>();
  let labelOrphanSince: number | null = null;
  let failed = false;
  let scheduled = false;

  const fail = (failure: Failure) => {
    if (failed) return;
    failed = true;
    console.warn("[expand-thinking]", failure);
    showBanner(failure, signal);
  };

  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!signal.aborted) fn();
    }, ms);
    timers.add(id);
  };

  const isUserCollapsed = (header: Element) => {
    const key = rowKey(header);
    return key !== null ? userCollapsedRows.has(key) : userCollapsedElements.has(header);
  };

  const expand = (header: HTMLButtonElement) => {
    const tries = attempts.get(header) ?? 0;
    if (tries >= 2) return;
    attempts.set(header, tries + 1);
    header.click(); // isTrusted=false, so the click tracker below ignores it
    later(TOGGLE_VERIFY_MS, () => {
      if (!header.isConnected || isUserCollapsed(header)) return;
      if (header.getAttribute("aria-expanded") !== "false") return;
      // A no-op click causes no DOM mutation, so nothing would rescan: retry here.
      if (tries + 1 < 2) {
        expand(header);
      } else {
        fail({
          check: "toggle-noop",
          summary: "Clicking a thinking row header no longer expands it",
          details: `header text "${header.textContent?.trim().slice(0, 60)}", row ${rowKey(header) ?? "(none)"}, aria-expanded stayed "false" after two clicks`,
        });
      }
    });
  };

  const scan = () => {
    scheduled = false;
    if (signal.aborted) return;
    try {
      const rows = document.querySelectorAll(ROW_SELECTOR);
      if (rows.length === 0) {
        // Being on a thread URL proves nothing (another panel can cover the
        // timeline). Only treat it as drift when thinking labels are actually
        // on screen but no row wrapper matches.
        const label = visibleReasoningLabel();
        if (label === null) {
          labelOrphanSince = null;
          return;
        }
        labelOrphanSince ??= Date.now();
        if (Date.now() - labelOrphanSince >= MISS_CONFIRM_MS) {
          fail({
            check: "timeline-missing",
            summary: "Thinking rows are on screen, but the timeline row wrapper isn't recognisable",
            details: `"${label.textContent?.trim()}" is visible on ${location.pathname} but no elements match ${ROW_SELECTOR}; label parent HTML starts: ${label.parentElement?.outerHTML.slice(0, 400)}`,
          });
        } else {
          later(MISS_CONFIRM_MS, schedule);
        }
        return;
      }
      labelOrphanSince = null;

      for (const header of document.querySelectorAll(HEADER_SELECTOR)) {
        if (!isReasoningHeader(header)) continue;
        if (header.getAttribute("aria-expanded") !== "false" || isUserCollapsed(header)) continue;
        expand(header);
      }

      // Selector drift: a short row that reads like a reasoning header but
      // isn't built the way we expect. A reasoning row with nothing to show
      // yet legitimately renders a plain div header (no button), so only flag
      // rows missing the row group, or carrying a toggle we don't recognise.
      const now = Date.now();
      const seen = new Set<string>();
      for (const row of rows) {
        const id = row.getAttribute("data-timeline-row-id");
        if (id === null) continue;
        const text = row.textContent?.trim() ?? "";
        if (text.length >= 60 || !REASONING_LABEL.test(text)) continue;
        const hasRowGroup = row.querySelector('[class~="group/timeline-row"]') !== null;
        const hasKnownToggle = [...row.querySelectorAll(HEADER_SELECTOR)].some(isReasoningHeader);
        const hasUnknownToggle = !hasKnownToggle && row.querySelector('[aria-expanded]') !== null;
        if (hasRowGroup && !hasUnknownToggle) continue;
        seen.add(id);
        const since = missSince.get(id) ?? now;
        missSince.set(id, since);
        if (now - since >= MISS_CONFIRM_MS) {
          fail({
            check: "header-missing",
            summary: "Thinking rows render, but their expand toggle isn't where the plugin expects",
            details: `row ${id} text "${text}": ${hasRowGroup ? "has an aria-expanded toggle not matching" : "has no group/timeline-row element for"} ${HEADER_SELECTOR}; row HTML starts: ${row.outerHTML.slice(0, 400)}`,
          });
        }
      }
      for (const id of missSince.keys()) if (!seen.has(id)) missSince.delete(id);
      if (missSince.size > 0) later(MISS_CONFIRM_MS, schedule);
    } catch (error) {
      fail({
        check: "script-error",
        summary: "The expand script threw an error",
        details: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
      });
    }
  };

  function schedule() {
    if (scheduled || signal.aborted) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  // Capture phase on document runs before React's root listener, so
  // aria-expanded still holds the pre-click state here.
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const header = event.target.closest(HEADER_SELECTOR);
    if (header === null || !isReasoningHeader(header)) return;
    const collapsing = header.getAttribute("aria-expanded") === "true";
    const key = rowKey(header);
    if (key !== null) {
      if (collapsing) userCollapsedRows.add(key);
      else userCollapsedRows.delete(key);
    } else if (collapsing) {
      userCollapsedElements.add(header);
    } else {
      userCollapsedElements.delete(header);
    }
  }, { capture: true, signal });

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-expanded"],
  });
  schedule();

  signal.addEventListener("abort", () => {
    observer.disconnect();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  });
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "expand-thinking",
    mount({ signal }) {
      startExpander(signal);
    },
  });
});
