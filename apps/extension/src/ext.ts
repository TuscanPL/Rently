/**
 * The extension API: Firefox's promise-based `browser`, else Chrome's `chrome`
 * (promise-based in MV3 too). The calls we make have the same shape in both.
 */
export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome
