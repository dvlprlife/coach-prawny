// RIGHT PANE, below Best moves. Shows the played-move history as a standard
// numbered move log, plus back/forward buttons to step through it. Stepping
// changes the position shown everywhere (board + engine), same as if the
// user had pasted that FEN directly.

import { useLayoutEffect, useRef, useState } from "react";
import { getSideToMove, STARTING_FEN } from "../engine/fen";
import {
  assessEntry,
  QUALITY_GLYPH,
  QUALITY_LABEL,
  type MoveAssessment,
} from "../engine/moveQuality";
import type { MoveLogEntry } from "../config/types";

interface MoveLogProps {
  entries: MoveLogEntry[];
  currentIndex: number;
  onBack: () => void;
  onForward: () => void;
}

interface LogCell {
  san: string;
  index: number;
  // null when either side of the comparison hasn't been analyzed yet, which is
  // the signal to render the move with no annotation at all.
  assessment: MoveAssessment | null;
}

interface LogRow {
  number: number;
  white?: LogCell;
  black?: LogCell;
}

// Groups the flat entry list into numbered white/black pairs. Uses the FEN's
// own fullmove number and side-to-move rather than assuming the log always
// starts with White - it may start mid-game from a pasted position.
function buildRows(entries: MoveLogEntry[]): LogRow[] {
  const rows: LogRow[] = [];
  if (entries.length <= 1) return rows;

  let sideToMove = getSideToMove(entries[0].fen);
  let moveNumber = parseInt(entries[0].fen.split(/\s+/)[5] ?? "1", 10) || 1;

  for (let i = 1; i < entries.length; i++) {
    const cell: LogCell = {
      san: entries[i].san ?? "",
      index: i,
      assessment: assessEntry(entries[i - 1], entries[i]),
    };
    if (sideToMove === "w") {
      rows.push({ number: moveNumber, white: cell });
    } else {
      const last = rows[rows.length - 1];
      if (last && last.number === moveNumber && !last.black) {
        last.black = cell;
      } else {
        rows.push({ number: moveNumber, black: cell });
      }
      moveNumber++;
    }
    sideToMove = sideToMove === "w" ? "b" : "w";
  }
  return rows;
}

// "Mistake - gave up 1.30" reads better than a bare centipawn count, and the
// pawn unit matches how the evaluations are shown in the Best-moves panel.
function assessmentTitle(assessment: MoveAssessment): string {
  const label = QUALITY_LABEL[assessment.quality];
  if (assessment.lossCp <= 0) return label;
  return `${label} - gave up ${(assessment.lossCp / 100).toFixed(2)}`;
}

// The annotation shown after a move. "good" has an empty glyph on purpose:
// marking every unremarkable move would drown out the ones worth seeing.
function Annotation({ assessment }: { assessment: MoveAssessment | null }) {
  if (!assessment) return null;
  const glyph = QUALITY_GLYPH[assessment.quality];
  if (!glyph) return null;
  return (
    <span className={`quality ${assessment.quality}`} title={assessmentTitle(assessment)}>
      {glyph}
    </span>
  );
}

// Standard PGN movetext ("1. e4 e5 2. Nf3 ..."), with a "N..." lead-in when
// the log starts mid-game on Black to move. Includes the FEN/SetUp tags when
// the log didn't start from the normal starting position, so the game is
// still reconstructible by anything that reads this PGN back in.
function buildPgn(entries: MoveLogEntry[]): string {
  const rows = buildRows(entries);
  const movetext = rows
    .map((row) => {
      if (row.white) {
        return row.black
          ? `${row.number}. ${row.white.san} ${row.black.san}`
          : `${row.number}. ${row.white.san}`;
      }
      return `${row.number}... ${row.black!.san}`;
    })
    .join(" ");

  const startFen = entries[0].fen;
  if (startFen === STARTING_FEN) return movetext;
  return `[FEN "${startFen}"]\n[SetUp "1"]\n\n${movetext}`;
}

// Keeps the highlighted move visible while stepping. The list only shows 10
// rows, so past that point the current move walks off the edge and the user
// has to chase it with the scrollbar. Deliberately nudges only the list's own
// scrollTop rather than calling scrollIntoView, which would also scroll the
// page to bring the panel into view - jarring when you're just holding the
// arrow key. Rects rather than offsetTop so it doesn't depend on the list
// being a positioned ancestor.
function useScrollCurrentIntoView(
  listRef: React.RefObject<HTMLOListElement | null>,
  rowRef: React.RefObject<HTMLLIElement | null>,
  currentIndex: number,
  rowCount: number,
) {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Index 0 is the starting position, which no row represents - stepping all
    // the way back should show the top of the game rather than stay put.
    if (currentIndex === 0) {
      list.scrollTop = 0;
      return;
    }
    const row = rowRef.current;
    if (!row) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) {
      list.scrollTop += rowBox.top - listBox.top;
    } else if (rowBox.bottom > listBox.bottom) {
      list.scrollTop += rowBox.bottom - listBox.bottom;
    }
    // rowCount is a dependency because loading a different game can leave the
    // index unchanged while the row under it becomes a completely new move.
  }, [listRef, rowRef, currentIndex, rowCount]);
}

export function MoveLog({ entries, currentIndex, onBack, onForward }: MoveLogProps) {
  const rows = buildRows(entries);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const currentRowRef = useRef<HTMLLIElement | null>(null);

  useScrollCurrentIntoView(listRef, currentRowRef, currentIndex, rows.length);

  async function copyPgn() {
    try {
      await navigator.clipboard.writeText(buildPgn(entries));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied or unavailable - nothing useful to surface here
    }
  }

  return (
    <div className="move-log">
      <div className="move-log-header">
        <h2>Moves</h2>
        <div className="move-log-actions">
          <button
            type="button"
            className="action-btn"
            onClick={copyPgn}
            disabled={rows.length === 0}
            title="Copy the game so far as PGN"
          >
            {copied ? "Copied!" : "Copy PGN"}
          </button>
          <div className="move-nav">
            <button
              type="button"
              onClick={onBack}
              disabled={currentIndex === 0}
              aria-label="Previous move"
              title="Previous move (←)"
            >
              &lt;
            </button>
            <button
              type="button"
              onClick={onForward}
              disabled={currentIndex === entries.length - 1}
              aria-label="Next move"
              title="Next move (→)"
            >
              &gt;
            </button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="status">No moves yet.</p>
      ) : (
        <ol className="move-log-list" ref={listRef}>
          {rows.map((row) => (
            <li
              className="move-log-row"
              key={row.number}
              ref={
                row.white?.index === currentIndex || row.black?.index === currentIndex
                  ? currentRowRef
                  : null
              }
            >
              <span className="num">{row.number}.</span>
              <span className={row.white?.index === currentIndex ? "san current" : "san"}>
                {row.white?.san ?? ""}
                {row.white ? <Annotation assessment={row.white.assessment} /> : null}
              </span>
              <span className={row.black?.index === currentIndex ? "san current" : "san"}>
                {row.black?.san ?? ""}
                {row.black ? <Annotation assessment={row.black.assessment} /> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
