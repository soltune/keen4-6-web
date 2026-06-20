#!/usr/bin/env bash
# ===========================================================================
# link.sh — link the per-episode wasm objects into a loadable Emscripten
# module for the browser shell.
#
#   bash engine/port/link.sh [4|5|6]     (default 4)
#
# Produces web/public/engine/keen<ep>.{js,wasm,data}. The engine keeps its DOS
# control flow (main() runs the whole game and blocks on busy-waits), so we
# link with ASYNCIFY: the busy-waits call CKWEB_Yield()->emscripten_sleep(),
# which suspends the wasm stack, lets the browser present a frame / pump input,
# then resumes. TimeCount is advanced from the wall clock in ck_web.c.
#
# Game data is staged with fully UPPERCASE names (MEMFS is case-sensitive and
# the engine opens EGADICT.CK4 / GAMEMAPS.CK4 / ... ) and preloaded at MEMFS /.
# ===========================================================================
set -u
cd "$(dirname "$0")/../.." || exit 1
source ~/emsdk/emsdk_env.sh >/dev/null 2>&1

ep="${1:-4}"
OUT=web/public/engine
mkdir -p "$OUT"

# --- stage data with uppercase names (EGADICT.ck4 -> EGADICT.CK4) ----------
DATA="engine/build/data$ep"
rm -rf "$DATA"; mkdir -p "$DATA"
# Prefer the v1.4 data set (matches the reconstruction's GFXE_CK*.H chunk layout)
# if extracted; fall back to web/public/data otherwise.
SRC="web/public/data/ck$ep"
[ -d "engine/build/data_v14/ck$ep" ] && SRC="engine/build/data_v14/ck$ep"
echo "data source: $SRC"
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  b=$(basename "$f" | tr '[:lower:]' '[:upper:]')
  cp "$f" "$DATA/$b"
done
echo "staged data:"; ls "$DATA"

# --- link ------------------------------------------------------------------
EXPORTS="['_main','_malloc','_free']"
RUNTIME="['ccall','cwrap','callMain','FS','HEAPU8','HEAPU32','HEAPF32']"

emcc engine/build/game/*_ck"$ep".o -o "$OUT/keen$ep.js" \
  -O1 \
  -sASYNCIFY \
  -sASYNCIFY_STACK_SIZE=131072 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 \
  -sSTACK_SIZE=5242880 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME="KeenModule$ep" \
  -sEXPORT_ES6=1 \
  -sINVOKE_RUN=0 \
  -sFORCE_FILESYSTEM=1 \
  -lidbfs.js \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS="$RUNTIME" \
  --preload-file "$DATA"@/ \
  2>&1 | tail -25

echo "---"
ls -la "$OUT"/keen$ep.* 2>/dev/null
