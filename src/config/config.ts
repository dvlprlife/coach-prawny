// Central config for the two swappable seams: recognition and engine.
// Migrating to a backend later = flip a mode here and set the URL.
// Nothing in the components changes.

export type SeamMode = "client" | "server";

export interface AppConfig {
  recognition: {
    // Whether to show the image-input UI at all (upload button + paste hint).
    // The seam behind it is fully wired - paste/upload both reach
    // recognizeBoard() - but recognizeBoard() is still a stub that throws, so
    // exposing the UI would advertise a feature that cannot work. Kept as a
    // flag rather than deleting the code, since recognition is postponed, not
    // abandoned: flip this to true when there's a real implementation behind it.
    enabled: boolean;
    mode: SeamMode;
    // Only used when mode === "server". e.g. "https://api.coachprawny.com/recognize"
    serverUrl?: string;
  };
  engine: {
    mode: SeamMode;
    // Only used when mode === "server". e.g. "https://api.coachprawny.com/analyze"
    serverUrl?: string;
    // How many best moves to return (Stockfish MultiPV).
    multiPv: number;
    // Search depth. 15-20 is plenty for move suggestions and stays fast.
    depth: number;
  };
}

export const config: AppConfig = {
  recognition: {
    enabled: false, // Hidden: recognizeBoard() is still a stub. Wiring is intact.
    mode: "client", // No auto-detect yet; the client impl is a stub for now.
  },
  engine: {
    mode: "client", // Stockfish WASM in a Web Worker.
    multiPv: 3,
    depth: 18,
  },
};
