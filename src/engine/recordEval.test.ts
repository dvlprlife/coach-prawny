import { describe, expect, it } from "vitest";
import { isScored, recordEval } from "./recordEval";
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
