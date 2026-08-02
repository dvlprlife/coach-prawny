// Material accounting, read straight off a FEN. No engine involved - this is
// the one part of an evaluation a learner can verify by counting, and it is
// correct the instant the position changes rather than after a search lands.
//
// Two quantities come out of here and they are NOT derived the same way:
//
//   balance  - the difference in value between the pieces actually standing on
//              the board. Always correct, for any position whatsoever.
//   captured - which pieces each side has taken. This cannot be read from a
//              position alone; it only exists relative to what the position
//              started from. We assume a standard starting complement, because
//              the alternative is showing nothing at all for a pasted FEN, and
//              a pasted FEN is usually a real game. Where the assumption does
//              not hold the display can simply be switched off.
//
// Two ways the assumption can produce nonsense, both handled below:
//   - promotions. A side with two queens and seven pawns has not had a pawn
//     captured in exchange for a queen appearing; a naive diff says otherwise.
//   - free placement. Set up mode allows three rooks or nine pawns, which diffs
//     to a negative number of captures.

import type { Fen } from "../config/types";

// Kings are deliberately absent: both sides always have exactly one, so a king
// contributes nothing to either quantity and giving it a value would only
// invite it into the arithmetic.
export type MaterialPiece = "p" | "n" | "b" | "r" | "q";

// Most valuable first - the order captured pieces are displayed in.
export const MATERIAL_ORDER: MaterialPiece[] = ["q", "r", "b", "n", "p"];

export const PIECE_VALUE: Record<MaterialPiece, number> = {
  q: 9,
  r: 5,
  b: 3,
  n: 3,
  p: 1,
};

// What each side starts a standard game with. The baseline `captured` is
// measured against; see the header note on why assuming it is the right call.
const STARTING_COMPLEMENT: Record<MaterialPiece, number> = {
  p: 8,
  n: 2,
  b: 2,
  r: 2,
  q: 1,
};

export type PieceCount = Record<MaterialPiece, number>;

export interface MaterialSide {
  // Pieces THIS side has taken from the other. Never negative.
  captured: PieceCount;
  // Value of this side's own pieces still on the board.
  points: number;
}

export interface Material {
  white: MaterialSide;
  black: MaterialSide;
  // White's points minus Black's: positive favours White, matching the sign
  // convention the engine evaluations already use everywhere else in the app.
  balance: number;
}

function emptyCount(): PieceCount {
  return { p: 0, n: 0, b: 0, r: 0, q: 0 };
}

// Tally the placement field by colour. Uppercase is White, lowercase Black.
// Digits, rank separators and both kings fall through the `in` guard, so this
// needs no separate skip list.
function countPieces(fen: Fen): { w: PieceCount; b: PieceCount } {
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  const w = emptyCount();
  const b = emptyCount();
  for (const ch of placement) {
    const type = ch.toLowerCase() as MaterialPiece;
    if (!(type in PIECE_VALUE)) continue;
    if (ch === ch.toUpperCase()) w[type]++;
    else b[type]++;
  }
  return { w, b };
}

function points(count: PieceCount): number {
  return MATERIAL_ORDER.reduce(
    (total, piece) => total + count[piece] * PIECE_VALUE[piece],
    0
  );
}

// How many of this side's pawns must have promoted, inferred from holding more
// of a piece than a game starts with. Undercounts by design: promote to a queen
// after the original queen is captured and the total is back to one, so nothing
// here can tell that apart from an unpromoted position. That failure is the
// harmless direction - it costs at most one over-reported captured pawn, where
// the alternative would invent captures that never happened on every promotion.
function promotedPawns(count: PieceCount): number {
  let extra = 0;
  for (const piece of MATERIAL_ORDER) {
    if (piece === "p") continue;
    extra += Math.max(0, count[piece] - STARTING_COMPLEMENT[piece]);
  }
  return extra;
}

// What is missing from `count` relative to a full starting complement - i.e.
// what the side facing it has captured.
//
// Pawns are discounted by the number that promoted: those left the board
// without being taken. Every count is clamped at zero, which is what keeps a
// free-placement surplus (three rooks) from reading as a negative capture.
function capturedFrom(count: PieceCount): PieceCount {
  const promoted = promotedPawns(count);
  const out = emptyCount();
  for (const piece of MATERIAL_ORDER) {
    const missing = STARTING_COMPLEMENT[piece] - count[piece];
    out[piece] = Math.max(0, piece === "p" ? missing - promoted : missing);
  }
  return out;
}

// Accepts a full FEN or a bare placement field - only the first field is read,
// so this works on whatever the FEN box currently holds.
export function readMaterial(fen: Fen): Material {
  const { w, b } = countPieces(fen);
  const whitePoints = points(w);
  const blackPoints = points(b);
  return {
    // A side's captures are the OTHER side's missing pieces.
    white: { captured: capturedFrom(b), points: whitePoints },
    black: { captured: capturedFrom(w), points: blackPoints },
    balance: whitePoints - blackPoints,
  };
}

// Total number of pieces in a count - used to decide whether a row has
// anything to draw.
export function capturedTotal(count: PieceCount): number {
  return MATERIAL_ORDER.reduce((total, piece) => total + count[piece], 0);
}
