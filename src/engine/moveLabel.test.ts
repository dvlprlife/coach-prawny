// Unit tests for move labelling. The thing worth pinning down is that the
// number and the side both come from the position BEFORE the move, not after
// it - reading them off the wrong entry is off by one for White and by a whole
// move number for Black, and both mistakes still produce plausible-looking
// labels.

import { describe, it, expect } from "vitest";
import { moveLabel, getFullmoveNumber, START_LABEL } from "./moveLabel";
import { STARTING_FEN } from "./fen";
import type { MoveLogEntry } from "../config/types";

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
const AFTER_NF3 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";

// A log opening on Black to move at move 12, the shape a pasted PGN produces
// when the game didn't start from the initial position.
const MIDGAME = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b - - 5 12";
const MIDGAME_AFTER = "r1bq1rk1/pp3ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 13";

const GAME: MoveLogEntry[] = [
  { fen: STARTING_FEN },
  { fen: AFTER_E4, san: "e4" },
  { fen: AFTER_E5, san: "e5" },
  { fen: AFTER_NF3, san: "Nf3" },
];

describe("getFullmoveNumber", () => {
  it("reads the fullmove field", () => {
    expect(getFullmoveNumber(STARTING_FEN)).toBe(1);
    expect(getFullmoveNumber(AFTER_E5)).toBe(2);
    expect(getFullmoveNumber(MIDGAME)).toBe(12);
  });

  it("falls back to 1 for a FEN missing or mangling the field", () => {
    expect(getFullmoveNumber("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")).toBe(1);
    expect(getFullmoveNumber("")).toBe(1);
    expect(getFullmoveNumber(STARTING_FEN.replace(/1$/, "banana"))).toBe(1);
    // A zero or negative counter is nonsense; 1 is the safer read.
    expect(getFullmoveNumber(STARTING_FEN.replace(/1$/, "0"))).toBe(1);
  });
});

describe("moveLabel", () => {
  it("numbers a White move with a single dot", () => {
    expect(moveLabel(GAME, 1)).toBe("1. e4");
    expect(moveLabel(GAME, 3)).toBe("2. Nf3");
  });

  it("numbers a Black move with the ... lead-in", () => {
    expect(moveLabel(GAME, 2)).toBe("1... e5");
  });

  it("keeps White and Black on the same move number", () => {
    // 1. e4 and 1... e5 are both move 1 - taking the number from the position
    // AFTER e5 would call it move 2.
    expect(moveLabel(GAME, 1).startsWith("1.")).toBe(true);
    expect(moveLabel(GAME, 2).startsWith("1...")).toBe(true);
  });

  it("names the root entry Start", () => {
    expect(moveLabel(GAME, 0)).toBe(START_LABEL);
  });

  it("numbers from a log that began mid-game", () => {
    const pasted: MoveLogEntry[] = [
      { fen: MIDGAME },
      { fen: MIDGAME_AFTER, san: "b6" },
    ];
    expect(moveLabel(pasted, 1)).toBe("12... b6");
  });

  it("falls back to Start rather than throwing on an out-of-range index", () => {
    expect(moveLabel(GAME, 99)).toBe(START_LABEL);
    expect(moveLabel(GAME, -1)).toBe(START_LABEL);
    expect(moveLabel([], 0)).toBe(START_LABEL);
  });

  it("falls back to Start for an entry carrying no move", () => {
    // Shouldn't happen past index 0, but an unnamed entry is not a move and
    // labelling it "2. undefined" would be worse than saying so.
    expect(moveLabel([{ fen: STARTING_FEN }, { fen: AFTER_E4 }], 1)).toBe(START_LABEL);
  });
});
