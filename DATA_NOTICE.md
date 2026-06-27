# Bundled game data — Commander Keen 4 (shareware)

This repository bundles the data files for **Commander Keen 4: "Secret of the
Oracle"** under `web/public/data/ck4/`, so the GitHub Pages demo is playable
without the visitor supplying their own copy of the game.

## Why this is allowed

Commander Keen 4 is the **shareware** episode of the *Goodbye Galaxy* trilogy.
It was released by id Software / Apogee Software Productions as
freely-redistributable shareware and may be distributed at no charge provided it
is distributed **unmodified**. The bundled files were extracted
(UNLZEXE‑decompressed and chunk‑ripped) from the **official Keen 4 shareware
v1.4 distribution**.

- Copyright (c) 1991 id Software, Inc. — distributed by Apogee Software Productions.
- Source distribution: the original unmodified shareware package
  (`README.DOC`, `ORDER.FRM`, `CATALOG.EXE`, `KEEN4E.EXE`,
  `EGAGRAPH/GAMEMAPS/AUDIO.CK4`) — its `README.DOC` and `ORDER.FRM` are included
  unmodified under `web/public/data/ck4/` for provenance / ordering information.

The game **data** (graphics, maps, audio) remains the property of id Software /
Apogee and is **not** covered by this project's source-code license.

## What is NOT included

**Commander Keen 5 and 6 data is intentionally omitted.** Keen 5 (registered) and
Keen 6 are *not* shareware and must not be redistributed. They still appear in the
episode selector but stay disabled unless a user supplies their own data locally
(drop files under `dos/` and run `npm run extract`).

## Engine / source code

The browser engine (`web/public/engine/keen*.{js,wasm}`) and all source under
`engine/`, `web/`, and `KEEN4-6/` are this project's own code, licensed
GPL-2.0-or-later (see source headers). They contain **no** game data.
