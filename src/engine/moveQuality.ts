// Was the move you just played any good?
//
// The Best-moves panel says what the engine WOULD play; this says how what you
// actually played compares. The measure is standard centipawn loss: the
// evaluation of the position before your move, minus the evaluation after it.
// Play the best move and the two agree, so the loss is ~0; hang a rook and the
// evaluation drops by roughly a rook, so the loss is ~500.
//
// Everything here is pure - scores in, verdict out - so it can be tested
// without an engine, a board or a DOM. The evaluations it consumes come from
// analyzeEngine, already normalized to WHITE's perspective, which is what makes
// the arithmetic below a plain subtraction with one sign flip for Black.

import { getSideToMove } from "./fen";
import type { MoveLogEntry } from "../config/types";

export type MoveQuality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface MoveAssessment {
  quality: MoveQuality;
  lossCp: number; // centipawns given up, from the mover's point of view
}

// Mate collapsed onto the centipawn scale so a mate score and a normal score
// are comparable. Subtracting the distance makes a FASTER mate score higher,
// so converting mate-in-5 into mate-in-4 reads as a tiny gain rather than a
// loss - which is what it is.
const MATE_SCORE = 100_000;
// Any score this large is a forced mate rather than a material evaluation.
const MATE_FLOOR = MATE_SCORE - 1_000;

// Past this margin the game is already decided and further imprecision is
// noise: dropping from +2000 to +1400 is not a blunder in any useful sense.
const DECIDED_CP = 1_000;

// Loss thresholds, in centipawns. Roughly the bands Lichess and Chess.com use.
const BEST_CP = 10;
const GOOD_CP = 50;
const INACCURACY_CP = 120;
const MISTAKE_CP = 300;

// Collapse an evaluation into one comparable number on White's scale. Returns
// null when the position was never analyzed, which is the signal not to judge
// the move at all.
export function toScore(
  evalCp: number | null | undefined,
  mateIn: number | null | undefined
): number | null {
  if (mateIn != null) {
    const distance = Math.abs(mateIn);
    return mateIn >= 0 ? MATE_SCORE - distance : -(MATE_SCORE - distance);
  }
  return evalCp ?? null;
}

export function assessMove(params: {
  scoreBefore: number | null;
  scoreAfter: number | null;
  mover: "w" | "b";
  playedBest?: boolean;
}): MoveAssessment | null {
  const { scoreBefore, scoreAfter, mover, playedBest } = params;
  // One side of the comparison is missing - the position it needs was never
  // analyzed. Saying nothing beats guessing.
  if (scoreBefore == null || scoreAfter == null) return null;

  // Both scores are on White's scale, so White's loss is the drop and Black's
  // is the rise. This single flip is the only place the mover's colour matters.
  const drop = scoreBefore - scoreAfter;
  const lossCp = mover === "w" ? drop : -drop;

  if (playedBest || lossCp <= BEST_CP) return { quality: "best", lossCp };

  const quality = bucket(lossCp);
  // In an already-won or already-lost position, don't cry blunder over a
  // margin that changes nothing.
  if (quality !== "good" && alreadyDecided(scoreBefore, scoreAfter, mover)) {
    return { quality: "good", lossCp };
  }
  return { quality, lossCp };
}

// Convenience wrapper over two adjacent move-log entries: `played` is the entry
// the move produced, `previous` the one it was played from. The mover is
// whoever was on turn in `previous`, read from that FEN rather than assumed, so
// a log that starts mid-game on Black to move works too.
export function assessEntry(
  previous: MoveLogEntry,
  played: MoveLogEntry
): MoveAssessment | null {
  return assessMove({
    scoreBefore: toScore(previous.evalCp, previous.mateIn),
    scoreAfter: toScore(played.evalCp, played.mateIn),
    mover: getSideToMove(previous.fen),
    playedBest: isEngineChoice(previous.bestUci, played),
  });
}

// Did the played move match the engine's top choice for that position? Compared
// on from/to only: the log records squares, not the promotion piece, and an
// underpromotion that differs from the engine's pick still shows up as a loss.
function isEngineChoice(bestUci: string | undefined, played: MoveLogEntry): boolean {
  if (!bestUci || !played.from || !played.to) return false;
  return bestUci.slice(0, 2) === played.from && bestUci.slice(2, 4) === played.to;
}

function bucket(lossCp: number): MoveQuality {
  if (lossCp < GOOD_CP) return "good";
  if (lossCp < INACCURACY_CP) return "inaccuracy";
  if (lossCp < MISTAKE_CP) return "mistake";
  return "blunder";
}

function alreadyDecided(before: number, after: number, mover: "w" | "b"): boolean {
  if (Math.abs(before) < DECIDED_CP || Math.abs(after) < DECIDED_CP) return false;
  if (Math.sign(before) !== Math.sign(after)) return false;
  // Throwing away a forced mate is always worth flagging, however won the
  // position still looks afterwards.
  if (hasForcedMate(before, mover) && !hasForcedMate(after, mover)) return false;
  return true;
}

function hasForcedMate(score: number, mover: "w" | "b"): boolean {
  return mover === "w" ? score >= MATE_FLOOR : score <= -MATE_FLOOR;
}

// Shown after the move in the log. "good" is deliberately blank - an annotation
// on every move would be noise, and the interesting ones are the mistakes.
export const QUALITY_GLYPH: Record<MoveQuality, string> = {
  best: "★",
  good: "",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

export const QUALITY_LABEL: Record<MoveQuality, string> = {
  best: "Best move",
  good: "Good move",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};
