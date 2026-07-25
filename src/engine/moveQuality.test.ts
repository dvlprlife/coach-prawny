// Unit tests for the move-quality scoring. The subtle part is that every
// evaluation is on WHITE's scale (analyzeEngine normalizes them), so a drop in
// the number is a loss for White but a GAIN for Black - and getting that flip
// backwards would silently praise blunders and condemn good moves. Most of
// what follows pins that sign convention down.

import { describe, it, expect } from "vitest";
import {
  toScore,
  assessMove,
  assessEntry,
  QUALITY_GLYPH,
  QUALITY_LABEL,
  type MoveQuality,
} from "./moveQuality";
import { STARTING_FEN } from "./fen";
import type { MoveLogEntry } from "../config/types";

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("toScore", () => {
  it("passes a centipawn evaluation through unchanged", () => {
    expect(toScore(35, null)).toBe(35);
    expect(toScore(-120, null)).toBe(-120);
    expect(toScore(0, null)).toBe(0);
  });

  it("returns null when the position was never analyzed", () => {
    expect(toScore(null, null)).toBeNull();
    expect(toScore(undefined, undefined)).toBeNull();
  });

  it("scores a mate far above any material evaluation", () => {
    expect(toScore(null, 3)).toBeGreaterThan(50_000);
    expect(toScore(null, -3)).toBeLessThan(-50_000);
  });

  it("scores a faster mate higher than a slower one", () => {
    expect(toScore(null, 2)!).toBeGreaterThan(toScore(null, 7)!);
    // ...and for Black, "higher" means further from zero in the other direction.
    expect(toScore(null, -2)!).toBeLessThan(toScore(null, -7)!);
  });

  it("prefers mate over a large material edge", () => {
    expect(toScore(null, 9)!).toBeGreaterThan(toScore(5000, null)!);
  });

  it("lets mate take precedence when both fields are set", () => {
    expect(toScore(20, 4)).toBe(toScore(null, 4));
  });
});

describe("assessMove — sign convention", () => {
  it("treats a drop in the score as a loss for White", () => {
    const a = assessMove({ scoreBefore: 30, scoreAfter: -500, mover: "w" });
    expect(a).toEqual({ quality: "blunder", lossCp: 530 });
  });

  it("treats the same drop as a GAIN for Black", () => {
    const a = assessMove({ scoreBefore: 30, scoreAfter: -500, mover: "b" });
    expect(a!.lossCp).toBe(-530);
    expect(a!.quality).toBe("best");
  });

  it("treats a rise in the score as a loss for Black", () => {
    const a = assessMove({ scoreBefore: -30, scoreAfter: 500, mover: "b" });
    expect(a).toEqual({ quality: "blunder", lossCp: 530 });
  });
});

describe("assessMove — banding", () => {
  const bands: Array<[number, MoveQuality]> = [
    [0, "best"],
    [10, "best"],
    [11, "good"],
    [49, "good"],
    [50, "inaccuracy"],
    [119, "inaccuracy"],
    [120, "mistake"],
    [299, "mistake"],
    [300, "blunder"],
    [1200, "blunder"],
  ];

  for (const [loss, quality] of bands) {
    it(`scores a ${loss}cp loss as ${quality}`, () => {
      const a = assessMove({ scoreBefore: 0, scoreAfter: -loss, mover: "w" });
      expect(a).toEqual({ quality, lossCp: loss });
    });
  }

  it("counts an improvement as best, not as a negative-loss oddity", () => {
    const a = assessMove({ scoreBefore: 0, scoreAfter: 300, mover: "w" });
    expect(a!.quality).toBe("best");
    expect(a!.lossCp).toBe(-300);
  });

  it("marks the engine's own top choice best regardless of the numbers", () => {
    const a = assessMove({
      scoreBefore: 0,
      scoreAfter: -400,
      mover: "w",
      playedBest: true,
    });
    expect(a!.quality).toBe("best");
  });
});

describe("assessMove — missing analysis", () => {
  it("declines to judge when the position before was not analyzed", () => {
    expect(assessMove({ scoreBefore: null, scoreAfter: 10, mover: "w" })).toBeNull();
  });

  it("declines to judge when the position after was not analyzed", () => {
    expect(assessMove({ scoreBefore: 10, scoreAfter: null, mover: "w" })).toBeNull();
  });
});

describe("assessMove — already-decided positions", () => {
  it("does not call it a blunder when the game was already won and still is", () => {
    const a = assessMove({ scoreBefore: 2000, scoreAfter: 1400, mover: "w" });
    expect(a!.quality).toBe("good");
    expect(a!.lossCp).toBe(600);
  });

  it("does not call it a blunder when the game was already lost and still is", () => {
    const a = assessMove({ scoreBefore: -2000, scoreAfter: -2600, mover: "w" });
    expect(a!.quality).toBe("good");
  });

  it("still flags a move that throws a decided game away", () => {
    // Winning by a lot, then not winning at all: the sign changed, so the
    // damping must not apply.
    const a = assessMove({ scoreBefore: 2000, scoreAfter: -100, mover: "w" });
    expect(a!.quality).toBe("blunder");
  });

  it("still flags giving up a forced mate, however won the position stays", () => {
    const a = assessMove({
      scoreBefore: toScore(null, 3),
      scoreAfter: 1500,
      mover: "w",
    });
    expect(a!.quality).toBe("blunder");
  });

  it("does not flag converting one mate into a slightly slower mate", () => {
    const a = assessMove({
      scoreBefore: toScore(null, 3),
      scoreAfter: toScore(null, 4),
      mover: "w",
    });
    expect(a!.quality).toBe("best");
  });

  it("applies the forced-mate exception from Black's side too", () => {
    const a = assessMove({
      scoreBefore: toScore(null, -3),
      scoreAfter: -1500,
      mover: "b",
    });
    expect(a!.quality).toBe("blunder");
  });
});

describe("assessEntry", () => {
  const root: MoveLogEntry = { fen: STARTING_FEN, evalCp: 30, mateIn: null };

  it("reads the mover from the previous position rather than assuming White", () => {
    const previous: MoveLogEntry = { fen: AFTER_E4, evalCp: 30, mateIn: null };
    const played: MoveLogEntry = {
      fen: STARTING_FEN,
      san: "??",
      from: "e7",
      to: "e5",
      evalCp: 400,
      mateIn: null,
    };
    // Black was on move, so the score RISING is Black's loss.
    expect(assessEntry(previous, played)).toEqual({ quality: "blunder", lossCp: 370 });
  });

  it("marks a move best when it matches the previous entry's engine choice", () => {
    const previous: MoveLogEntry = { ...root, bestUci: "e2e4" };
    const played: MoveLogEntry = {
      fen: AFTER_E4,
      san: "e4",
      from: "e2",
      to: "e4",
      evalCp: -200,
      mateIn: null,
    };
    expect(assessEntry(previous, played)!.quality).toBe("best");
  });

  it("does not mark a different move best", () => {
    const previous: MoveLogEntry = { ...root, bestUci: "e2e4" };
    const played: MoveLogEntry = {
      fen: AFTER_E4,
      san: "a4",
      from: "a2",
      to: "a4",
      evalCp: -200,
      mateIn: null,
    };
    // 30 -> -200 from White's side is a 230cp loss, which bands as a mistake.
    expect(assessEntry(previous, played)).toEqual({ quality: "mistake", lossCp: 230 });
  });

  it("returns null when either entry is unscored", () => {
    const unscored: MoveLogEntry = { fen: AFTER_E4 };
    expect(assessEntry(root, unscored)).toBeNull();
    expect(assessEntry(unscored, root)).toBeNull();
  });
});

describe("display tables", () => {
  it("has a glyph and a label for every quality", () => {
    const all: MoveQuality[] = ["best", "good", "inaccuracy", "mistake", "blunder"];
    for (const q of all) {
      expect(QUALITY_GLYPH[q]).toBeDefined();
      expect(QUALITY_LABEL[q]).toBeTruthy();
    }
  });

  it("leaves ordinary good moves unannotated", () => {
    expect(QUALITY_GLYPH.good).toBe("");
  });
});
