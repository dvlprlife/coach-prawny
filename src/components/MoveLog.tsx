// RIGHT PANE, below Best moves. Shows the played-move history as a standard
// numbered move log, plus back/forward buttons to step through it. Stepping
// changes the position shown everywhere (board + engine), same as if the
// user had pasted that FEN directly.

import { useState } from "react";
import { getSideToMove, STARTING_FEN } from "../engine/fen";
import type { MoveLogEntry } from "../config/types";

interface MoveLogProps {
  entries: MoveLogEntry[];
  currentIndex: number;
  onBack: () => void;
  onForward: () => void;
}

interface LogRow {
  number: number;
  white?: { san: string; index: number };
  black?: { san: string; index: number };
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
    const san = entries[i].san ?? "";
    if (sideToMove === "w") {
      rows.push({ number: moveNumber, white: { san, index: i } });
    } else {
      const last = rows[rows.length - 1];
      if (last && last.number === moveNumber && !last.black) {
        last.black = { san, index: i };
      } else {
        rows.push({ number: moveNumber, black: { san, index: i } });
      }
      moveNumber++;
    }
    sideToMove = sideToMove === "w" ? "b" : "w";
  }
  return rows;
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

export function MoveLog({ entries, currentIndex, onBack, onForward }: MoveLogProps) {
  const rows = buildRows(entries);
  const [copied, setCopied] = useState(false);

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
        <ol className="move-log-list">
          {rows.map((row) => (
            <li className="move-log-row" key={row.number}>
              <span className="num">{row.number}.</span>
              <span className={row.white?.index === currentIndex ? "san current" : "san"}>
                {row.white?.san ?? ""}
              </span>
              <span className={row.black?.index === currentIndex ? "san current" : "san"}>
                {row.black?.san ?? ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
