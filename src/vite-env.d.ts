/// <reference types="vite/client" />

// Vite's `?url` suffix imports an asset's URL as a string (kept for future use).
declare module "*?url" {
  const url: string;
  export default url;
}
