// Naming a single move in the log: "3. Nf3", "5... d5", "Start".
//
// Used by the notes panel, which pins each note to a move and has to say which
// one. The numbering is read straight off the PREVIOUS entry's FEN rather than
// walked forward from the top of the list: chess.js writes every FEN in the
// log, so its side-to-move and fullmove fields already carry the answer, and a
// log that started mid-game from a pasted PGN is right for free. A forward walk
// would have to re-derive both and would be a second place for the numbering to
// drift out of step with the move log's own.

import { getSideToMove } from "./fen";
import type { MoveLogEntry } from "../config/types";

// What entry 0 is called. It's the position the log started from, not a move,
// so it has no number - but a note can still be pinned to it.
export const START_LABEL = "Start";

// The FEN's fullmove field (the 6th), which counts from 1 and increments after
// Black moves. Defaults to 1 for a FEN missing or mangling the field, matching
// how the rest of the app treats a partial FEN as "assume the normal start".
export function getFullmoveNumber(fen: string): number {
  const field = fen.split(/\s+/)[5];
  const parsed = parseInt(field ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// The move that produced `entries[index]`, named the way a move log names it.
// Black's moves get the "..." lead-in so a note reads unambiguously on its own,
// away from the two-column grid that would otherwise show whose move it is.
export function moveLabel(entries: MoveLogEntry[], index: number): string {
  if (index <= 0 || index >= entries.length) return START_LABEL;
  const entry = entries[index];
  const san = entry.san;
  if (!san) return START_LABEL;

  // The position BEFORE the move is what numbers it: its side-to-move is who
  // played, and its fullmove counter is the number they played under.
  const prev = entries[index - 1].fen;
  const number = getFullmoveNumber(prev);
  return getSideToMove(prev) === "w" ? `${number}. ${san}` : `${number}... ${san}`;
}
