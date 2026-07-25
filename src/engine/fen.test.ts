// Unit tests for the FEN helpers. These lock down invariants that have each
// broken in a real, hard-to-spot way before - see the comments in fen.ts for the
// full reasoning behind them:
//   - normalizeFen prunes castling rights the placement can't support, because
//     Stockfish silently wedges (no info, no bestmove, no error) on a FEN whose
//     castling field is wholly unsupported.
//   - normalizeFen infers "b" when the placement leaves Black in check and the
//     side to move was omitted, because Stockfish reports zero legal moves for
//     the illegal "w" reading.
//   - setSideToMove clears the en-passant square when it flips, because an ep
//     target only makes sense for the side to move and chess.js rejects one on
//     the wrong rank.
// Pure string in, string out - no DOM, no worker, no engine.

import { describe, it, expect } from "vitest";
import {
  STARTING_FEN,
  normalizeFen,
  validateFen,
  getSideToMove,
  setSideToMove,
  getCastlingRights,
  setCastlingRight,
  castlingIsPossible,
} from "./fen";

// Kings on their home squares, no rooks anywhere: every castling right is
// unsupportable. This is what setup mode produces once you drag the rooks off.
const NO_ROOKS = "4k3/8/8/8/8/8/8/4K3";
// Same, but White still has the h1 rook, so only "K" survives a prune.
const WHITE_H1_ROOK_ONLY = "4k3/8/8/8/8/8/8/4K2R";
// Black king on a8 is in check from Ra1; White's king on h1 is not in check.
const BLACK_IN_CHECK = "k7/8/8/8/8/8/8/R6K";

describe("normalizeFen", () => {
  it("leaves a complete, supportable FEN untouched", () => {
    expect(normalizeFen(STARTING_FEN)).toBe(STARTING_FEN);
  });

  // Note the "-" castling default: a placement-only paste is deliberately NOT
  // credited with castling rights, even from the starting placement, because
  // guessing them from piece positions would invent rights the user never
  // stated. So this does NOT round-trip to STARTING_FEN.
  it("pads a placement-only input with defaults, assuming no castling rights", () => {
    const placement = STARTING_FEN.split(" ")[0];
    expect(normalizeFen(placement)).toBe(`${placement} w - - 0 1`);
  });

  it("never infers castling rights from the placement", () => {
    expect(getCastlingRights(normalizeFen(STARTING_FEN.split(" ")[0]))).toEqual({
      K: false,
      Q: false,
      k: false,
      q: false,
    });
  });

  it("pads only the missing trailing fields, keeping the ones supplied", () => {
    const placement = STARTING_FEN.split(" ")[0];
    expect(normalizeFen(`${placement} b`)).toBe(`${placement} b - - 0 1`);
  });

  it("collapses surrounding and repeated whitespace", () => {
    expect(normalizeFen(`  ${STARTING_FEN.replace(/ /g, "   ")}  `)).toBe(STARTING_FEN);
  });

  // The castling wedge: the whole reason this pruning exists.
  it("drops every castling right when no rook is on a home square", () => {
    expect(normalizeFen(`${NO_ROOKS} w KQkq - 0 1`)).toBe(`${NO_ROOKS} w - - 0 1`);
  });

  it("keeps only the rights the placement can still support", () => {
    expect(normalizeFen(`${WHITE_H1_ROOK_ONLY} w KQkq - 0 1`)).toBe(
      `${WHITE_H1_ROOK_ONLY} w K - 0 1`
    );
  });

  it("normalizes surviving rights into KQkq order", () => {
    expect(normalizeFen(`${STARTING_FEN.split(" ")[0]} w qkQK - 0 1`)).toBe(STARTING_FEN);
  });

  // Filtering a malformed field here would launder an invalid FEN into a
  // plausible one and silently analyze the wrong position.
  it("leaves a castling field containing non-standard characters alone", () => {
    for (const field of ["KQkg", "HAha", "AHah"]) {
      expect(normalizeFen(`${NO_ROOKS} w ${field} - 0 1`)).toBe(
        `${NO_ROOKS} w ${field} - 0 1`
      );
    }
  });

  it("leaves an explicit '-' castling field alone", () => {
    expect(normalizeFen(`${NO_ROOKS} w - - 0 1`)).toBe(`${NO_ROOKS} w - - 0 1`);
  });

  // Side-to-move inference: only when the field was omitted entirely.
  it("infers 'b' when 'w' would leave Black in check and 'b' would not", () => {
    expect(normalizeFen(BLACK_IN_CHECK)).toBe(`${BLACK_IN_CHECK} b - - 0 1`);
  });

  it("does not override an explicitly supplied side to move", () => {
    expect(normalizeFen(`${BLACK_IN_CHECK} w`)).toBe(`${BLACK_IN_CHECK} w - - 0 1`);
  });

  it("defaults to 'w' when neither side is in check", () => {
    expect(getSideToMove(normalizeFen(NO_ROOKS))).toBe("w");
  });
});

describe("validateFen", () => {
  it("accepts the starting position", () => {
    expect(validateFen(STARTING_FEN)).toEqual({ valid: true });
  });

  it("rejects garbage and reports an error message", () => {
    const result = validateFen("not a fen");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects the malformed castling fields normalizeFen deliberately preserves", () => {
    expect(validateFen(`${NO_ROOKS} w KQkg - 0 1`).valid).toBe(false);
  });
});

describe("getSideToMove", () => {
  it("reads the second field", () => {
    expect(getSideToMove(STARTING_FEN)).toBe("w");
    expect(getSideToMove(`${NO_ROOKS} b - - 0 1`)).toBe("b");
  });

  it("falls back to 'w' when the field is missing or unrecognized", () => {
    expect(getSideToMove(NO_ROOKS)).toBe("w");
    expect(getSideToMove(`${NO_ROOKS} x - - 0 1`)).toBe("w");
  });
});

describe("setSideToMove", () => {
  // A legal ep position: Black just played e7-e5, so e6 is capturable by White.
  const WITH_EP = "rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2";

  it("clears the en-passant square when the side flips", () => {
    expect(setSideToMove(WITH_EP, "b")).toBe(
      "rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 2"
    );
  });

  it("produces a FEN chess.js still accepts after flipping", () => {
    expect(validateFen(setSideToMove(WITH_EP, "b")).valid).toBe(true);
  });

  // The no-op guard runs BEFORE the ep clearing, so an unchanged side must
  // return the input byte-for-byte - commitFen's "nothing changed" check
  // depends on it to keep the move log alive.
  it("returns the FEN byte-for-byte unchanged when already that side", () => {
    expect(setSideToMove(WITH_EP, "w")).toBe(WITH_EP);
  });

  it("returns the input unchanged when there is no side-to-move field", () => {
    expect(setSideToMove(NO_ROOKS, "b")).toBe(NO_ROOKS);
  });

  it("flips without disturbing castling rights or the clocks", () => {
    expect(setSideToMove(STARTING_FEN, "b")).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"
    );
  });
});

describe("getCastlingRights", () => {
  it("reads all four rights from the starting position", () => {
    expect(getCastlingRights(STARTING_FEN)).toEqual({ K: true, Q: true, k: true, q: true });
  });

  it("reports every right as false for '-'", () => {
    expect(getCastlingRights(`${NO_ROOKS} w - - 0 1`)).toEqual({
      K: false,
      Q: false,
      k: false,
      q: false,
    });
  });

  it("reports every right as false when the field is absent", () => {
    expect(getCastlingRights(NO_ROOKS)).toEqual({
      K: false,
      Q: false,
      k: false,
      q: false,
    });
  });
});

describe("setCastlingRight", () => {
  const placement = STARTING_FEN.split(" ")[0];

  it("adds a right and normalizes the field into KQkq order", () => {
    expect(setCastlingRight(`${placement} w q - 0 1`, "K", true)).toBe(
      `${placement} w Kq - 0 1`
    );
  });

  it("removes a right", () => {
    expect(setCastlingRight(STARTING_FEN, "Q", false)).toBe(`${placement} w Kkq - 0 1`);
  });

  it("writes '-' once the last right is removed", () => {
    let fen = `${placement} w K - 0 1`;
    fen = setCastlingRight(fen, "K", false);
    expect(fen).toBe(`${placement} w - - 0 1`);
  });

  it("is a no-op for a right that is already in the requested state", () => {
    expect(setCastlingRight(STARTING_FEN, "K", true)).toBe(STARTING_FEN);
  });

  it("returns the input unchanged when there is no castling field", () => {
    expect(setCastlingRight(`${NO_ROOKS} w`, "K", true)).toBe(`${NO_ROOKS} w`);
  });
});

describe("castlingIsPossible", () => {
  it("accepts all four rights in the starting position", () => {
    for (const right of ["K", "Q", "k", "q"] as const) {
      expect(castlingIsPossible(STARTING_FEN, right)).toBe(true);
    }
  });

  it("works on a bare placement as well as a full FEN", () => {
    expect(castlingIsPossible(STARTING_FEN.split(" ")[0], "K")).toBe(true);
  });

  it("rejects a right whose rook has left home", () => {
    const noH1Rook = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1";
    expect(castlingIsPossible(noH1Rook, "K")).toBe(false);
    expect(castlingIsPossible(noH1Rook, "Q")).toBe(true);
  });

  it("rejects both of a colour's rights when its king has left home", () => {
    const noWhiteKing = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR";
    expect(castlingIsPossible(noWhiteKing, "K")).toBe(false);
    expect(castlingIsPossible(noWhiteKing, "Q")).toBe(false);
    expect(castlingIsPossible(noWhiteKing, "k")).toBe(true);
    expect(castlingIsPossible(noWhiteKing, "q")).toBe(true);
  });

  it("rejects everything when no rooks are on the board", () => {
    for (const right of ["K", "Q", "k", "q"] as const) {
      expect(castlingIsPossible(NO_ROOKS, right)).toBe(false);
    }
  });

  // A same-coloured piece standing on the rook's home square is not a rook.
  it("does not mistake another piece on the rook square for a rook", () => {
    expect(castlingIsPossible("4k3/8/8/8/8/8/8/4K2N", "K")).toBe(false);
  });
});
