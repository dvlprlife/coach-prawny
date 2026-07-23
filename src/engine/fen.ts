// FEN helpers. chess.js validates before anything reaches the engine, so we
// never silently analyze a malformed position (the classic trap).
//
// A full FEN has 6 space-separated fields, e.g.
//   rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
//   1: piece placement   - rank 8 -> rank 1, "/" per rank, digits = empty squares
//   2: active color      - "w" or "b": whose turn it is
//   3: castling rights   - any of "KQkq" still available, or "-" for none
//   4: en passant target - the square behind a just-moved 2-square pawn, or "-"
//   5: halfmove clock    - moves since the last pawn move/capture (50-move rule)
//   6: fullmove number   - increments after Black's move, starts at 1

import { Chess } from "chess.js";
import type { Fen } from "../config/types";

export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Defaults used to pad fields 2-6 when a user pastes just the piece placement
// (or a partial FEN). "-" for castling/en passant means "assume none" rather
// than guessing rights from piece positions.
const FEN_FIELD_DEFAULTS = ["w", "-", "-", "0", "1"];

export interface FenValidation {
  valid: boolean;
  error?: string;
}

// Fills in any missing trailing fields (2 through 6) with sane defaults so a
// FEN with just the piece placement - or placement plus a few fields - is
// still accepted. Fields present in the input are left untouched.
export function normalizeFen(fen: Fen): Fen {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] ?? "";
  const rest = FEN_FIELD_DEFAULTS.map((fallback, i) => parts[i + 1] ?? fallback);

  // "w" is the default active color, but for some placements that leaves
  // Black already in check while it's marked as White's move - only the side
  // to move is allowed to be in check, so that's not a legal position. Chess.js
  // accepts it anyway (it doesn't validate this), but Stockfish silently
  // reports zero legal moves for it. When the color was omitted and "w" would
  // create that situation while "b" wouldn't, use "b" instead.
  if (parts[1] === undefined && opponentInCheck(placement, "w") && !opponentInCheck(placement, "b")) {
    rest[0] = "b";
  }

  // Drop castling rights the placement can't support. This is not cosmetic:
  // handed a position whose castling field is wholly unsupported (e.g. "KQkq"
  // with no rooks anywhere, which is what setup mode produces after you drag
  // the rooks off), Stockfish silently refuses the search - no `info` lines, no
  // `bestmove`, no error - which hangs whatever is waiting on it. chess.js
  // accepts such a FEN happily, so this is the only place that catches it.
  //
  // Only touch a field made purely of the four standard rights. Anything else -
  // a typo like "KQkg", or a Chess960 Shredder-FEN like "HAha" - is left exactly
  // as-is so validateFen still rejects it downstream. Filtering it here would
  // launder an invalid FEN into a plausible one and analyze the wrong position
  // without ever telling the user.
  if (/^[KQkq]+$/.test(rest[1])) {
    rest[1] =
      CASTLING_ORDER.filter(
        (right) => rest[1].includes(right) && castlingIsPossible(placement, right)
      ).join("") || "-";
  }

  return [placement, ...rest].join(" ");
}

// True if setting `active` as the side to move would leave the OTHER side's
// king in check - an illegal, unreachable position.
function opponentInCheck(placement: string, active: "w" | "b"): boolean {
  const opponent = active === "w" ? "b" : "w";
  try {
    return new Chess(`${placement} ${opponent} - - 0 1`).inCheck();
  } catch {
    return false;
  }
}

export function validateFen(fen: Fen): FenValidation {
  try {
    // chess.js throws on an invalid FEN in recent versions.
    new Chess(fen);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Invalid FEN" };
  }
}

// Side-to-move lives in the FEN's 2nd field ("w" or "b"). The toggle flips it
// without disturbing the rest of the position.
export function getSideToMove(fen: Fen): "w" | "b" {
  const field = fen.split(/\s+/)[1];
  return field === "b" ? "b" : "w";
}

export function setSideToMove(fen: Fen, side: "w" | "b"): Fen {
  const parts = fen.split(/\s+/);
  if (parts.length < 2) return fen;
  // Already this side: return the FEN byte-for-byte unchanged so commitFen's
  // "nothing changed" guard no-ops and the move log survives clicking the
  // already-active toggle.
  if (parts[1] === side) return fen;
  parts[1] = side;
  // An en passant target names the square a pawn the OTHER side just double-
  // stepped past, and it is only ever capturable by the side now to move.
  // Flipping whose turn it is makes that claim meaningless - and chess.js
  // rejects a FEN whose ep square sits on the wrong rank for the side to move
  // ("illegal en-passant square"), so carrying it over would make this toggle
  // fail validation and surface a cryptic error for a plain button click.
  // Clear it, the same reasoning boardToFen uses when a setup edit invalidates it.
  if (parts.length > 3) parts[3] = "-";
  return parts.join(" ");
}

// Castling rights live in the FEN's 3rd field, e.g. "KQkq" - any subset of
// White kingside/queenside and Black kingside/queenside, or "-" for none.
export type CastlingRight = "K" | "Q" | "k" | "q";
const CASTLING_ORDER: CastlingRight[] = ["K", "Q", "k", "q"];

export function getCastlingRights(fen: Fen): Record<CastlingRight, boolean> {
  const field = fen.split(/\s+/)[2] ?? "-";
  return {
    K: field.includes("K"),
    Q: field.includes("Q"),
    k: field.includes("k"),
    q: field.includes("q"),
  };
}

export function setCastlingRight(fen: Fen, right: CastlingRight, enabled: boolean): Fen {
  const parts = fen.split(/\s+/);
  if (parts.length < 3) return fen;
  const rights = { ...getCastlingRights(fen), [right]: enabled };
  parts[2] = CASTLING_ORDER.filter((r) => rights[r]).join("") || "-";
  return parts.join(" ");
}

// Where the king and rook must still be standing for a castling right to mean
// anything. (Standard chess only - Chess960's shuffled home squares would need
// the rights to carry their own file, which this app doesn't support.)
const CASTLING_HOME: Record<
  CastlingRight,
  { king: string; rook: string; kingSquare: string; rookSquare: string }
> = {
  K: { king: "K", rook: "R", kingSquare: "e1", rookSquare: "h1" },
  Q: { king: "K", rook: "R", kingSquare: "e1", rookSquare: "a1" },
  k: { king: "k", rook: "r", kingSquare: "e8", rookSquare: "h8" },
  q: { king: "k", rook: "r", kingSquare: "e8", rookSquare: "a8" },
};

// True if the placement could still support this castling right - i.e. the king
// and the matching rook are both home. It says nothing about whether castling is
// legal *right now* (squares attacked, pieces in between); that's chess.js's job.
// The UI uses it to disable a castling toggle that the position can't honour.
export function castlingIsPossible(fenOrPlacement: Fen, right: CastlingRight): boolean {
  const placement = fenOrPlacement.split(/\s+/)[0] ?? "";
  const home = CASTLING_HOME[right];
  return (
    pieceAt(placement, home.kingSquare) === home.king &&
    pieceAt(placement, home.rookSquare) === home.rook
  );
}

// The piece character standing on a square ("e1"), or "" if it's empty.
// Placement runs rank 8 -> rank 1, with digits standing for runs of empties.
function pieceAt(placement: string, square: string): string {
  const targetFile = square.charCodeAt(0) - "a".charCodeAt(0);
  const row = placement.split("/")[8 - parseInt(square[1], 10)];
  if (!row) return "";

  let file = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) {
      file += parseInt(ch, 10);
    } else {
      if (file === targetFile) return ch;
      file++;
    }
    if (file > targetFile) return "";
  }
  return "";
}
