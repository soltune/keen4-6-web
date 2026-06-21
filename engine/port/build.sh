#!/usr/bin/env bash
# ===========================================================================
# build.sh — proven Emscripten compile recipe for the Keen 4-6 native port.
#
# Compiles the ported engine sources in engine/game/ (a patched working copy of
# KEEN4-6/; the original tree stays pristine) to wasm objects, per episode, and
# reports OK / ERR=<n> for each translation unit.
#
# Key toolchain facts learned during bring-up (do not re-derive):
#   * emcc treats UPPERCASE .C as C++ -> MUST pass `-x c`.
#   * clang 6.x defaults to a C std where true/false/bool are keywords, which
#     breaks `typedef enum {false,true} boolean;` -> pin `-std=gnu99`.
#   * The engine's state-table function pointers trip
#     -Wincompatible-function-pointer-types (benign; types are identical aka
#     `void(struct objstruct*)`) -> `-Wno-incompatible-function-pointer-types`.
#   * DOS headers (<DOS.H>,<ALLOC.H>,<MEM.H>,<IO.H>,<PROCESS.H>,<BIOS.H>,
#     <CONIO.H>,<SYS\STAT.H>) are satisfied by stubs in engine/port/inc/.
#   * far/near/huge/_seg/cdecl/interrupt + MK_FP/FP_SEG/FP_OFF are neutralised
#     by the force-included engine/port/inc/ck_dos_compat.h.
#   * CK_*.C include the per-episode ID_HEADS.H, so each is compiled ONCE PER
#     EPISODE with that episode's -I dir (matches the original .PRJ builds).
#
# Usage: engine/port/build.sh [4|5|6]   (default: report all three)
# ===========================================================================
set -u
cd "$(dirname "$0")/../.." || exit 1   # repo root
source ~/emsdk/emsdk_env.sh >/dev/null 2>&1

CFLAGS=(
  -c -x c -std=gnu99
  -Wno-incompatible-function-pointer-types
  -Wno-incompatible-pointer-types
  -Wno-implicit-int -Wno-implicit-function-declaration
  -Wno-nonportable-include-path
  -DTHREEBYTEGRSTARTS
  -include engine/port/inc/ck_dos_compat.h
  -Iengine/port/inc -Iengine/game
)
OUT=engine/build/game
mkdir -p "$OUT"

# Shared engine translation units (compiled per-episode).
CORE=(CK_MAIN CK_GAME CK_PLAY CK_STATE CK_KEEN CK_KEEN2 CK_TEXT CK_DEMO)
PLATFORM=(ID_MM ID_CA ID_VW ID_RF ID_IN ID_SD ID_US_1 ID_US_2)
# Web-only support TUs (no DOS-original counterpart): the argc/errlist/Borland
# shims and the embedded OPL2 FM synth. Compiled once per episode too.
SUPPORT=(engine/platform/id_platform.c engine/platform/opl2.c engine/platform/nukedopl/opl3.c engine/platform/id_us_a.c engine/platform/id_rf_a.c engine/platform/ck_web.c engine/platform/ck_rewind.c)

compile() { # $1=src  $2=episodeDir  $3=objsuffix
  local src=$1 ep=$2 obj="$OUT/$(basename "${1%.C}")_$3.o"
  if emcc "${CFLAGS[@]}" -Iengine/game/"$ep" "$src" -o "$obj" 2>/tmp/ck_build.err; then
    local e; e=$(grep -c ' error:' /tmp/ck_build.err)
    if [ "$e" -eq 0 ]; then printf '  %-26s OK\n' "$(basename "$src")"; return 0; fi
    printf '  %-26s ERR=%s\n' "$(basename "$src")" "$e"; return 1
  else
    local e; e=$(grep -c ' error:' /tmp/ck_build.err)
    printf '  %-26s ERR=%s\n' "$(basename "$src")" "$e"; return 1
  fi
}

# Pick the source for an ID_* module: a finished web reimplementation in
# engine/platform/<lower>.c takes precedence over the DOS original in
# engine/game/.
platform_src() { # $1 = module (e.g. ID_MM)
  local low; low=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  if [ -f "engine/platform/$low.c" ]; then echo "engine/platform/$low.c";
  else echo "engine/game/$1.C"; fi
}

build_episode() { # $1 = 4|5|6
  local ep="KEEN$1" k="K$1"
  echo "===== Episode CK$1 ====="
  echo "-- platform (ID_*) --"
  for f in "${PLATFORM[@]}"; do compile "$(platform_src "$f")" "$ep" "ck$1"; done
  echo "-- support --"
  for f in "${SUPPORT[@]}"; do compile "$f" "$ep" "ck$1"; done
  echo "-- game core (CK_*) --"
  for f in "${CORE[@]}";     do compile "engine/game/$f.C" "$ep" "ck$1"; done
  echo "-- episode actors (${k}_*) --"
  for f in "${k}_ACT1" "${k}_ACT2" "${k}_ACT3" "${k}_SPEC"; do
    compile "engine/game/$ep/$f.C" "$ep" "ck$1"
  done
}

if [ "${1:-}" ]; then build_episode "$1"; else for e in 4 5 6; do build_episode "$e"; done; fi
