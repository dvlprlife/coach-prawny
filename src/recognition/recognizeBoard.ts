// THE RECOGNITION SEAM.
//
// This is the clean boundary that lets recognition move server-side later
// without touching any component. Everything downstream only knows this
// signature: image in, FEN out.
//
// MVP: there is no auto-detection yet (you chose "paste FEN first"), so the
// client implementation is a deliberate stub that throws. The UI catches it
// and tells the user to enter a FEN manually. When you build auto-detect,
// this is the ONLY file whose implementation changes.

import { config } from "../config/config";
import type { RecognitionResult } from "../config/types";

// Public interface. Components call this and never know what's behind it.
export async function recognizeBoard(image: Blob): Promise<RecognitionResult> {
  if (config.recognition.mode === "server") {
    return recognizeOnServer(image);
  }
  return recognizeOnClient(image);
}

// ---- client implementation (stub for the MVP) ----
async function recognizeOnClient(_image: Blob): Promise<RecognitionResult> {
  // FUTURE: run an in-browser ONNX/TFLite model here.
  //   1. detect the board + 64 squares (corner detection)
  //   2. classify each square (13 classes: 6 white, 6 black, empty)
  //   3. assemble the FEN string
  // Reference pipelines to adapt: tensorflow_chessbot, chesscog.
  throw new NotImplementedError(
    "Auto-detection isn't available yet. Enter a FEN manually for now."
  );
}

// ---- server implementation (ready for when you flip the flag) ----
async function recognizeOnServer(image: Blob): Promise<RecognitionResult> {
  const url = config.recognition.serverUrl;
  if (!url) {
    throw new Error("recognition.serverUrl is not set in config.");
  }
  const body = new FormData();
  body.append("image", image);
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) {
    throw new Error(`Recognition server error: ${res.status}`);
  }
  return (await res.json()) as RecognitionResult;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
