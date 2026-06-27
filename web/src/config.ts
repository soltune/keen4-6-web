/* ===========================================================================
   Episode catalogue (CK4 / CK5 / CK6).

   `ext` matches the original data file extension (.CK4 etc.). `dataFiles` are
   the runtime assets the engine needs; they are produced by tools/extract.mjs
   into web/public/data/<id>/ from the user's own game copies.
   =========================================================================== */

export interface EpisodeDef {
  id: "ck4" | "ck5" | "ck6";
  ext: "ck4" | "ck5" | "ck6";
  title: string;
  subtitle: string;
  number: 4 | 5 | 6;
  /** Files expected under public/data/<id>/ once extraction has run. */
  dataFiles: string[];
}

/** Core data files every Galaxy episode needs (main blobs + ripped headers). */
function galaxyFiles(ext: string): string[] {
  return [
    `EGAGRAPH.${ext}`,
    `GAMEMAPS.${ext}`,
    `AUDIO.${ext}`,
    // headers/dicts ripped out of the (LZEXE-decompressed) executable:
    `EGAHEAD.${ext}`,
    `EGADICT.${ext}`,
    `MAPHEAD.${ext}`,
    `AUDIOHEAD.${ext}`,
    `AUDIODICT.${ext}`,
  ];
}

export const EPISODES: EpisodeDef[] = [
  {
    id: "ck4",
    ext: "ck4",
    number: 4,
    title: "Secret of the Oracle",
    subtitle: "Commander Keen 4",
    dataFiles: galaxyFiles("ck4"),
  },
  {
    id: "ck5",
    ext: "ck5",
    number: 5,
    title: "The Armageddon Machine",
    subtitle: "Commander Keen 5",
    dataFiles: galaxyFiles("ck5"),
  },
  {
    id: "ck6",
    ext: "ck6",
    number: 6,
    title: "Aliens Ate My Babysitter",
    subtitle: "Commander Keen 6",
    dataFiles: galaxyFiles("ck6"),
  },
];

export function episodeById(id: string): EpisodeDef | undefined {
  return EPISODES.find((e) => e.id === id);
}

/** Base path (relative) where extracted data lives. */
export const DATA_BASE = "data";
