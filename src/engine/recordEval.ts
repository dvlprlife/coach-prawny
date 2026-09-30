// Writing a search result onto the move log - the one place it happens, shared
// by the live analysis (App's onResult) and the whole-game sweep
// (useGameSweep), so the two can't drift into scoring moves differently.

import { getSideToMove } from "./fen";
import type { AnalysisResult, MoveLogEntry } from "../config/types";

// A position counts as scored once its evaluation has been recorded. Either
// field will do: a forced mate has mateIn and a null evalCp.
export function isScored(entry: MoveLogEntry): boolean {
  return entry.evalCp != null || entry.mateIn != null;
}

// Whether a finished search can be recorded as the position's score: its
// rank-1 line reached the requested depth, OR the side to move mates in one.
// The second is the one shallow result expected - the engine caps a mate-in-one
// search after a grace period (MATE_IN_ONE_GRACE_MS) - and it is still exact:
// `mate 1` and the mating move are final from the first depth. Scores here are
// already on White's scale (analyzeEngine), so Black mating in one is -1.
export function isCompleteResult(result: AnalysisResult, depth: number): boolean {
  const best = result.moves.find((m) => m.rank === 1);
  if (!best) return false;
  if (best.depth >= depth) return true;
  return best.mateIn === (getSideToMove(result.fen) === "w" ? 1 : -1);
}

// Returns a new entries array with `result`'s rank-1 line recorded on
// `entries[index]`, or null when there is nothing to write:
// - the entry isn't the position the result is for (the log moved on while
//   the search ran - writing it would score the wrong move);
// - the result has no rank-1 line (a checkmate or stalemate position);
// - the entry already holds exactly these numbers (re-analyzing a position
//   after stepping away and back), so a write would only cost a re-render.
//
// Pure, so it is safe inside a setState updater that StrictMode runs twice.
export function recordEval(
  entries: MoveLogEntry[],
  index: number,
  result: AnalysisResult
): MoveLogEntry[] | null {
  const entry = entries[index];
  if (!entry || entry.fen !== result.fen) return null;
  const best = result.moves.find((m) => m.rank === 1);
  if (!best) return null;
  if (
    entry.evalCp === best.evalCp &&
    entry.mateIn === best.mateIn &&
    entry.bestUci === best.move
  ) {
    return null;
  }
  const next = entries.slice();
  next[index] = {
    ...entry,
    evalCp: best.evalCp,
    mateIn: best.mateIn,
    bestUci: best.move,
  };
  return next;
}
