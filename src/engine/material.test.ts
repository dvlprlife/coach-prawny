// Unit tests for material accounting. The interesting cases are all about the
// gap between the two quantities: `balance` is read off the pieces actually
// standing on the board and is always right, while `captured` is inferred by
// diffing against a standard starting complement and therefore has two ways to
// lie - promotions (a piece appeared without one being taken) and free
// placement (more of a piece than a game starts with). Most of what follows
// pins those two down.

import { describe, it, expect } from "vitest";
import {
  readMaterial,
  capturedTotal,
  MATERIAL_ORDER,
  PIECE_VALUE,
  type PieceCount,
} from "./material";
import { STARTING_FEN } from "./fen";

// A full complement is worth 39: 8 pawns + 2 knights + 2 bishops + 2 rooks + a
// queen. Spelled out so a change to PIECE_VALUE fails loudly here.
const FULL_SIDE = 39;

const NOTHING: PieceCount = { p: 0, n: 0, b: 0, r: 0, q: 0 };

describe("readMaterial - starting position", () => {
  it("reports no captures and a level balance", () => {
    const m = readMaterial(STARTING_FEN);
    expect(m.white.captured).toEqual(NOTHING);
    expect(m.black.captured).toEqual(NOTHING);
    expect(m.balance).toBe(0);
  });

  it("values a full complement at 39 per side", () => {
    const m = readMaterial(STARTING_FEN);
    expect(m.white.points).toBe(FULL_SIDE);
    expect(m.black.points).toBe(FULL_SIDE);
  });

  it("agrees with the sum of its own piece values", () => {
    const total = MATERIAL_ORDER.reduce(
      (sum, piece) =>
        sum + PIECE_VALUE[piece] * (piece === "p" ? 8 : piece === "q" ? 1 : 2),
      0
    );
    expect(total).toBe(FULL_SIDE);
  });
});

describe("readMaterial - ordinary captures", () => {
  // 1. e4 d5 2. exd5 - White is a pawn up.
  const PAWN_UP = "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";

  it("credits the capture to the side that made it", () => {
    const m = readMaterial(PAWN_UP);
    expect(m.white.captured.p).toBe(1);
    expect(capturedTotal(m.white.captured)).toBe(1);
    expect(capturedTotal(m.black.captured)).toBe(0);
  });

  it("puts the balance in White's favour", () => {
    const m = readMaterial(PAWN_UP);
    expect(m.balance).toBe(1);
    expect(m.white.points).toBe(FULL_SIDE);
    expect(m.black.points).toBe(FULL_SIDE - 1);
  });

  it("reads a negative balance when Black is ahead", () => {
    // Black has an extra rook's worth: White is missing one.
    const m = readMaterial("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1");
    expect(m.balance).toBe(-5);
    expect(m.black.captured.r).toBe(1);
    expect(m.white.captured).toEqual(NOTHING);
  });
});

describe("readMaterial - promotions", () => {
  // White has promoted a pawn: two queens and seven pawns, Black untouched.
  // The naive diff would claim Black captured a pawn. It did not.
  const PROMOTED = "rnbqkbnr/pppppppp/8/8/8/7Q/PPPPPPP1/RNBQKBNR b KQkq - 0 1";

  it("does not invent a captured pawn when one has promoted", () => {
    const m = readMaterial(PROMOTED);
    expect(m.black.captured.p).toBe(0);
    expect(capturedTotal(m.black.captured)).toBe(0);
  });

  it("never reports a negative count for the surplus piece", () => {
    const m = readMaterial(PROMOTED);
    expect(m.black.captured.q).toBe(0);
  });

  it("still shows the promotion as material gained", () => {
    // A pawn (1) left the board and a queen (9) arrived: +8.
    const m = readMaterial(PROMOTED);
    expect(m.balance).toBe(8);
    expect(m.white.points).toBe(FULL_SIDE + 8);
  });

  it("counts a capture alongside a promotion independently", () => {
    // White promoted (2 queens, 7 pawns) AND is missing a knight.
    const m = readMaterial("rnbqkbnr/pppppppp/8/8/8/7Q/PPPPPPP1/R1BQKBNR b KQkq - 0 1");
    expect(m.black.captured.n).toBe(1);
    expect(m.black.captured.p).toBe(0);
  });
});

describe("readMaterial - free placement", () => {
  it("clamps a surplus rather than reporting a negative capture", () => {
    // Set up mode allows a third black rook. Nothing was captured to produce it.
    const m = readMaterial("rnbqkbnr/pppppppp/8/8/8/r7/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(m.white.captured.r).toBe(0);
    expect(m.white.captured.p).toBe(0);
    expect(capturedTotal(m.white.captured)).toBe(0);
  });

  it("still reports the balance correctly for a position that never started standard", () => {
    // Balance needs no baseline, so it stays trustworthy where captured does not.
    const m = readMaterial("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    expect(m.balance).toBe(9);
  });

  it("treats a bare-kings position as level", () => {
    const m = readMaterial("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(m.white.points).toBe(0);
    expect(m.black.points).toBe(0);
    expect(m.balance).toBe(0);
  });
});

describe("readMaterial - parsing", () => {
  it("ignores kings entirely", () => {
    // Kings are on both boards below; only the queen differs, so the whole
    // difference must come from her.
    const withKings = readMaterial("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    expect(withKings.balance).toBe(PIECE_VALUE.q);
  });

  it("accepts a bare placement field with no other FEN fields", () => {
    const m = readMaterial("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
    expect(m.balance).toBe(0);
    expect(m.white.points).toBe(FULL_SIDE);
  });

  it("tolerates surrounding whitespace", () => {
    const m = readMaterial(`  ${STARTING_FEN}  `);
    expect(m.white.points).toBe(FULL_SIDE);
  });
});

describe("capturedTotal", () => {
  it("counts every piece across all types", () => {
    expect(capturedTotal({ p: 3, n: 1, b: 0, r: 2, q: 1 })).toBe(7);
  });

  it("is zero for an empty count", () => {
    expect(capturedTotal(NOTHING)).toBe(0);
  });
});
