/* ===========================================================================
   Episode selector (goal requirement #1): pick CK4 / CK5 / CK6 on load.

   Detects whether each episode's extracted data is present under public/data/
   and shows status. Returns the chosen EpisodeDef. Navigable by mouse/touch and
   keyboard (arrows + Enter).
   =========================================================================== */

import { DATA_BASE, EPISODES, type EpisodeDef } from "../config";

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
        <p class="subtitle">Galaxy Trilogy — エピソードを選択してください</p>
        <div class="episode-grid" role="listbox" aria-label="Episode"></div>
        <p class="hint">
          操作: <kbd>←</kbd><kbd>→</kbd> 選択 / <kbd>Enter</kbd> 決定 ・
          ゲーム中: <kbd>Ctrl</kbd> ジャンプ <kbd>Alt</kbd> ポゴ <kbd>Space</kbd> 発射 ・
          <kbd>F</kbd> フルスクリーン<br />
          データ未配置のエピソードは「デモ(モック)」で起動します。
        </p>
      </div>`;
    const grid = overlay.querySelector<HTMLElement>(".episode-grid")!;

    const buttons: HTMLButtonElement[] = EPISODES.map((ep) => {
      const btn = document.createElement("button");
      btn.className = "episode";
      btn.type = "button";
      btn.dataset.id = ep.id;
      btn.innerHTML = `
        <div class="num">${ep.number}</div>
        <div class="name">${ep.title}</div>
        <div class="status">確認中…</div>`;
      btn.addEventListener("click", () => done(ep));
      grid.appendChild(btn);
      // Async data presence badge.
      void hasData(ep).then((ok) => {
        const s = btn.querySelector<HTMLElement>(".status")!;
        s.textContent = ok ? "● データ検出" : "○ データ未配置 (デモ)";
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
