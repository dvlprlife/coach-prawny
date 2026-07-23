// THE ENGINE SEAM.
//
// Public analyze(fen) that dispatches to the client Stockfish worker or a future
// server endpoint based on config. Also enriches raw UCI moves with SAN
// (human-readable) using chess.js, so the UI gets "Nf3" not "g1f3".
//
// Both paths are async/promise-shaped, so moving the engine server-side later
// is a config flip + a fetch, not a refactor.

import { Chess } from "chess.js";
import { config } from "../config/config";
import type { AnalysisResult, EngineMove, Fen } from "../config/types";
import { getSideToMove } from "./fen";
import { StockfishEngine } from "./stockfishWorker";

// The in-flight-or-settled init, not the engine itself: callers await the same
// promise, so a second analyze() during startup can't grab a half-initialized
// engine and start sending it `position`/`go` before it has answered "uciok".
let enginePromise: Promise<StockfishEngine> | null = null;
let currentEngine: StockfishEngine | null = null;

// Lazily create + init the client engine. workerUrl is injected by the caller
// (App wires it from the Vite asset URL) to keep this module bundler-agnostic.
export async function getClientEngine(workerUrl: string): Promise<StockfishEngine> {
  if (!enginePromise) {
    const engine = new StockfishEngine(workerUrl);
    // Claimed at construction, not after init resolves: retire() identifies the
    // current engine by this, and leaving it null while a replacement is still
    // initializing would let a late retire() of the OLD engine evict the NEW
    // one's promise - orphaning a live Stockfish worker with nothing to dispose it.
    currentEngine = engine;
    enginePromise = engine.init().then(
      () => engine,
      (error: unknown) => {
        retire(engine);
        throw error;
      }
    );
  }
  return enginePromise;
}

// Evict a dead engine from the cache so the next analyze() builds a fresh worker
// and the app heals itself. Without this, one failure would be terminal: every
// later call would await the same corpse and only a page reload would clear it.
function retire(engine: StockfishEngine) {
  if (currentEngine !== engine) return; // a newer engine already replaced it
  enginePromise = null;
  currentEngine = null;
  engine.dispose();
}

export async function analyze(
  fen: Fen,
  workerUrl: string,
  multiPv: number = config.engine.multiPv,
  depth: number = config.engine.depth
): Promise<AnalysisResult> {
  let moves: EngineMove[];
  if (config.engine.mode === "server") {
    moves = await analyzeOnServer(fen, multiPv, depth);
  } else {
    const engine = await getClientEngine(workerUrl);
    try {
      moves = await engine.analyze(fen, multiPv, depth);
    } catch (error) {
      if (engine.dead) retire(engine);
      throw error;
    }
  }

  return { fen, moves: addSan(fen, toWhitePerspective(fen, moves)) };
}

// UCI scores are always from the SIDE TO MOVE's point of view, so a raw "+1.2"
// means "White is better" after 1.e4 but "Black is better" after 1...e5 - the
// same number flipping meaning every half-move. Negate Black-to-move scores so
// the sign is anchored to White the way Chess.com and Lichess show it: positive
// favours White, negative favours Black, whoever happens to be on move.
//
// Move ORDER is untouched - the engine still ranks best-first for the side to
// move, so with Black to move rank 1 is simply the most negative.
function toWhitePerspective(fen: Fen, moves: EngineMove[]): EngineMove[] {
  if (getSideToMove(fen) === "w") return moves;
  return moves.map((m) => ({
    ...m,
    evalCp: m.evalCp == null ? m.evalCp : -m.evalCp,
    mateIn: m.mateIn == null ? m.mateIn : -m.mateIn,
  }));
}

// Convert each UCI first-move into SAN for display.
function addSan(fen: Fen, moves: EngineMove[]): EngineMove[] {
  return moves.map((m) => {
    try {
      const chess = new Chess(fen);
      const from = m.move.slice(0, 2);
      const to = m.move.slice(2, 4);
      const promotion = m.move.length > 4 ? m.move.slice(4) : undefined;
      const result = chess.move({ from, to, promotion });
      return { ...m, san: result ? result.san : m.move };
    } catch {
      return { ...m, san: m.move };
    }
  });
}

// ---- server engine implementation (ready for the flag flip) ----
async function analyzeOnServer(
  fen: Fen,
  multiPv: number,
  depth: number
): Promise<EngineMove[]> {
  const url = config.engine.serverUrl;
  if (!url) throw new Error("engine.serverUrl is not set in config.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fen, multiPv, depth }),
  });
  if (!res.ok) throw new Error(`Engine server error: ${res.status}`);
  const data = await res.json();
  return data.moves as EngineMove[];
}
