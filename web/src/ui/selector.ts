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
    return res.ok;
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
        <h1 class="title">COMMANDER KEEN</h1>
        <p class="subtitle">Galaxy Trilogy — Select an episode</p>
        <div class="episode-grid" role="listbox" aria-label="Episode"></div>
        <p class="hint">
          Menu: <kbd>←</kbd><kbd>→</kbd> Select / <kbd>Enter</kbd> Confirm ·
          In game: <kbd>Ctrl</kbd> Jump <kbd>Alt</kbd> Pogo <kbd>Space</kbd> Fire ·
          <kbd>F</kbd> Fullscreen<br />
          Episodes without data start in demo (mock) mode.
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
      // Async data presence badge.
      void hasData(ep).then((ok) => {
        const s = btn.querySelector<HTMLElement>(".status")!;
        s.textContent = ok ? "● Data found" : "○ No data (demo)";
        s.className = `status ${ok ? "ok" : "missing"}`;
      });
      return btn;
    });

    let focus = Math.max(0, EPISODES.findIndex((e) => e.id === initialId));
    const updateFocus = () => buttons[focus]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        focus = (focus + 1) % buttons.length;
        updateFocus();
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        focus = (focus - 1 + buttons.length) % buttons.length;
        updateFocus();
        e.preventDefault();
      } else if (e.key === "Enter" || e.key === " ") {
        // Let a focused Export/Import button handle its own activation.
        if (document.activeElement instanceof HTMLElement &&
            document.activeElement.classList.contains("save-btn")) return;
        done(EPISODES[focus]);
        e.preventDefault();
      }
    };

    function done(ep: EpisodeDef) {
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
