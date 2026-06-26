/// <reference types="vite/client" />

// Raw text imports (Vite `?raw`). Used to embed GLSL shader sources verbatim,
// preserving their original license headers.
declare module "*.glsl?raw" {
  const src: string;
  export default src;
}
