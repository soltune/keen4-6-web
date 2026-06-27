/* ===========================================================================
   Episode selector (goal requirement #1): pick CK4 / CK5 / CK6 on load.

   Detects whether each episode's extracted data is present under public/data/
   and shows status. Returns the chosen EpisodeDef. Navigable by mouse/touch and
   keyboard (arrows + Enter).
   =========================================================================== */

import { DATA_BASE, EPISODES, type EpisodeDef } from "../config";
import { exportSaveBackup, importSaveBackup } from "../saves";

async function hasData(ep: EpisodeDef): Promise<boolean> {
  try {
    const probe = ep.dataFiles[0];
    const res = await fetch(`${DATA_BASE}/${ep.id}/${probe}`, { method: "HEAD" });
    if (!res.ok) return false;
    // A missing file is often answered with the SPA fallback index.html (HTTP 200,
    // text/html) — by the vite dev server and by some static hosts. Treat an HTML
    // response as "no data" so an absent episode isn't mistaken for an available one.
    return !(res.headers.get("content-type") || "").includes("text/html");
  } catch {
    return false;
  }
}

export function chooseEpisode(initialId?: string): Promise<EpisodeDef> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel">
        <a class="repo-link" href="https://github.com/soltune/keen4-6-web"
           target="_blank" rel="noopener noreferrer"
           title="View source on GitHub" aria-label="View source on GitHub">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <h1 class="title">COMMANDER KEEN</h1>
        <p class="subtitle">Galaxy Trilogy — Select an episode</p>
        <div class="episode-grid" role="listbox" aria-label="Episode"></div>
        <p class="hint">
          Menu: <kbd>←</kbd><kbd>→</kbd> Select / <kbd>Enter</kbd> Confirm ·
          In game: <kbd>Ctrl</kbd> Jump <kbd>Alt</kbd> Pogo <kbd>Space</kbd> Fire ·
          <kbd>F</kbd> Fullscreen<br />
          Only episodes with extracted data can be selected — add yours under <code>dos/</code>, run <code>npm&nbsp;run&nbsp;extract</code>, then reload.
        </p>
        <div class="save-tools">
          <button class="save-btn" type="button" data-act="export">⬇ Export saves</button>
          <button class="save-btn" type="button" data-act="import">⬆ Import saves</button>
          <input class="save-file" type="file" accept="application/json,.json" hidden />
        </div>
        <p class="save-msg" role="status" aria-live="polite"></p>
      </div>`;
    const grid = overlay.querySelector<HTMLElement>(".episode-grid")!;
    wireSaveTools(overlay);

    const buttons: HTMLButtonElement[] = EPISODES.map((ep) => {
      const btn = document.createElement("button");
      btn.className = "episode";
      btn.type = "button";
      btn.dataset.id = ep.id;
      btn.innerHTML = `
        <div class="num">${ep.number}</div>
        <div class="name">${ep.title}</div>
        <div class="status">Checking…</div>`;
      btn.addEventListener("click", () => done(ep));
      grid.appendChild(btn);
      // Async data presence badge. Episodes without data are disabled (greyed
      // out, unclickable, skipped by keyboard nav) — there is no demo mode.
      void hasData(ep).then((ok) => {
        const s = btn.querySelector<HTMLElement>(".status")!;
        s.textContent = ok ? "● Data found" : "○ No data";
        s.className = `status ${ok ? "ok" : "missing"}`;
        btn.disabled = !ok;
        if (!ok) {
          btn.setAttribute("aria-disabled", "true");
          // If focus is sitting on the episode we just disabled, move it to an
          // available one (the initial focus is set before these checks resolve).
          if (buttons[focus] === btn) {
            const next = buttons.findIndex((b) => !b.disabled);
            if (next >= 0) { focus = next; updateFocus(); }
          }
        }
      });
      return btn;
    });

    let focus = Math.max(0, EPISODES.findIndex((e) => e.id === initialId));
    const updateFocus = () => buttons[focus]?.focus();

    // Next selectable (non-disabled) button index in the given direction; stays
    // put if nothing is selectable (all episodes lack data).
    const step = (from: number, dir: number): number => {
      for (let n = 1; n <= buttons.length; n++) {
        const i = ((from + dir * n) % buttons.length + buttons.length) % buttons.length;
        if (!buttons[i].disabled) return i;
      }
      return from;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        focus = step(focus, 1);
        updateFocus();
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        focus = step(focus, -1);
        updateFocus();
        e.preventDefault();
      } else if (e.key === "Enter" || e.key === " ") {
        // Let a focused Export/Import button handle its own activation.
        if (document.activeElement instanceof HTMLElement &&
            document.activeElement.classList.contains("save-btn")) return;
        if (!buttons[focus]?.disabled) done(EPISODES[focus]);
        e.preventDefault();
      }
    };

    function done(ep: EpisodeDef) {
      // Ignore activation of a data-less (disabled) episode.
      if (buttons[EPISODES.indexOf(ep)]?.disabled) return;
      window.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(ep);
    }

    window.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    requestAnimationFrame(updateFocus);
  });
}

/** Wire the Export / Import save-data controls on the selector screen. Works
    with no engine loaded — see saves.ts for the direct-IndexedDB access. */
function wireSaveTools(overlay: HTMLElement): void {
  const exportBtn = overlay.querySelector<HTMLButtonElement>('[data-act="export"]')!;
  const importBtn = overlay.querySelector<HTMLButtonElement>('[data-act="import"]')!;
  const fileInput = overlay.querySelector<HTMLInputElement>(".save-file")!;
  const msgEl = overlay.querySelector<HTMLElement>(".save-msg")!;

  const setMsg = (text: string, kind: "" | "ok" | "err" = "") => {
    msgEl.textContent = text;
    msgEl.className = kind ? `save-msg ${kind}` : "save-msg";
  };

  exportBtn.addEventListener("click", async () => {
    setMsg("Exporting…");
    try {
      const blob = await exportSaveBackup();
      if (!blob) {
        setMsg("No saved games to export yet.", "err");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "keen-saves-backup.json";
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Saves exported to keen-saves-backup.json", "ok");
    } catch (e) {
      setMsg(`Export failed: ${(e as Error).message}`, "err");
    }
  });

  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // let the same file be re-selected later
    if (!file) return;
    setMsg("Importing…");
    try {
      const r = await importSaveBackup(file);
      setMsg(`Restored ${r.written} file(s). Pick an episode to use them.`, "ok");
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`, "err");
    }
  });
}
