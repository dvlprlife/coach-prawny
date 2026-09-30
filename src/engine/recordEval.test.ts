import { describe, expect, it } from "vitest";
import { isCompleteResult, isScored, recordEval } from "./recordEval";
import type { AnalysisResult, EngineMove, MoveLogEntry } from "../config/types";

const A = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const B = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

function line(rank: number, move: string, evalCp: number | null, mateIn: number | null = null): EngineMove {
  return { rank, move, evalCp, mateIn, pv: [move], depth: 18 };
}

function result(fen: string, moves: EngineMove[]): AnalysisResult {
  return { fen, moves };
}

describe("recordEval", () => {
  const entries: MoveLogEntry[] = [{ fen: A }, { fen: B, san: "e4" }];

  it("writes the rank-1 line onto the given index only", () => {
    const next = recordEval(entries, 1, result(B, [line(2, "d7d5", 40), line(1, "e7e5", 30)]));
    expect(next).not.toBeNull();
    expect(next![1]).toEqual({ fen: B, san: "e4", evalCp: 30, mateIn: null, bestUci: "e7e5" });
    expect(next![0]).toBe(entries[0]);
    // A new array, not a mutation - it runs inside a setState updater.
    expect(next).not.toBe(entries);
    expect(entries[1].evalCp).toBeUndefined();
  });

  it("refuses a result for a different position", () => {
    expect(recordEval(entries, 0, result(B, [line(1, "e7e5", 30)]))).toBeNull();
  });

  it("refuses an index past the end of the log", () => {
    expect(recordEval(entries, 5, result(B, [line(1, "e7e5", 30)]))).toBeNull();
  });

  it("has nothing to write for a position with no lines (mate or stalemate)", () => {
    expect(recordEval(entries, 1, result(B, []))).toBeNull();
  });

  it("skips a write that would change nothing", () => {
    const scored: MoveLogEntry[] = [
      { fen: A },
      { fen: B, evalCp: 30, mateIn: null, bestUci: "e7e5" },
    ];
    expect(recordEval(scored, 1, result(B, [line(1, "e7e5", 30)]))).toBeNull();
  });

  it("records a mate score", () => {
    const next = recordEval(entries, 1, result(B, [line(1, "d8h4", null, -1)]));
    expect(next![1]).toMatchObject({ evalCp: null, mateIn: -1, bestUci: "d8h4" });
  });
});

describe("isScored", () => {
  it("counts either score field", () => {
    expect(isScored({ fen: A })).toBe(false);
    expect(isScored({ fen: A, evalCp: null, mateIn: null })).toBe(false);
    expect(isScored({ fen: A, evalCp: 0 })).toBe(true);
    expect(isScored({ fen: A, evalCp: null, mateIn: 2 })).toBe(true);
  });
});

describe("isCompleteResult", () => {
  // A (White to move), B (Black to move). Scores are on White's scale, as
  // analyzeEngine delivers them.
  const at = (depth: number, l: EngineMove): EngineMove => ({ ...l, depth });

  it("accepts a rank-1 line at the requested depth", () => {
    expect(isCompleteResult(result(A, [at(18, line(1, "e2e4", 30))]), 18)).toBe(true);
    expect(isCompleteResult(result(A, [at(20, line(1, "e2e4", 30))]), 18)).toBe(true);
  });

  it("rejects a shallow result", () => {
    expect(isCompleteResult(result(A, [at(15, line(1, "e2e4", 30))]), 18)).toBe(false);
  });

  it("accepts a shallow mate in one for the side to move - it is exact", () => {
    expect(isCompleteResult(result(A, [at(15, line(1, "d1d8", null, 1))]), 18)).toBe(true);
    // Black mating in one is -1 on White's scale.
    expect(isCompleteResult(result(B, [at(1, line(1, "d8h4", null, -1))]), 18)).toBe(true);
  });

  it("does not accept a shallow mate the side to move is on the wrong end of", () => {
    // White to move and mated next move: not the capped case.
    expect(isCompleteResult(result(A, [at(15, line(1, "h2h3", null, -1))]), 18)).toBe(false);
    expect(isCompleteResult(result(B, [at(15, line(1, "h7h6", null, 1))]), 18)).toBe(false);
  });

  it("does not accept a shallow longer mate", () => {
    expect(isCompleteResult(result(A, [at(15, line(1, "b3b8", null, 2))]), 18)).toBe(false);
  });

  it("judges by rank 1, whatever order the lines arrive in", () => {
    const res = result(A, [at(18, line(2, "c1b1", -1100)), at(15, line(1, "d1d8", null, 1))]);
    expect(isCompleteResult(res, 18)).toBe(true);
  });

  it("rejects a result with no lines", () => {
    expect(isCompleteResult(result(A, []), 18)).toBe(false);
  });
});
