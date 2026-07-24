// RIGHT PANE. Ranked top-N moves with evaluation. Hovering a move calls
// onHoverMove with its UCI string so the parent can draw a transient arrow on
// the board; leaving clears it (onHoverMove(null)). Single-clicking a move
// calls onTogglePin to LOCK that arrow on so it persists after the pointer
// leaves - clicking the pinned move again unpins it, clicking a different move
// moves the pin (pinnedUci says which one is currently pinned). DOUBLE-clicking
// calls onPlayMove to play the move onto the board. For the keyboard: focusing
// a row shows the arrow (the display gesture) and Enter/Space commits the move
// (the accessible equivalent of a double-click).

import type { AnalysisResult, EngineMove } from "../config/types";

const MOVE_COUNT_OPTIONS = [1, 2, 3, 4, 5];

interface MoveListProps {
  result: AnalysisResult | null;
  analyzing: boolean;
  error: string | null;
  onHoverMove?: (uci: string | null) => void;
  onPlayMove?: (uci: string) => void;
  onTogglePin?: (uci: string) => void;
  pinnedUci?: string | null;
  moveCount: number;
  onMoveCountChange: (count: number) => void;
}

// Scores arrive already normalized to White (see toWhitePerspective in
// analyzeEngine): positive favours White, negative favours Black, whoever is on
// move. So the sign alone says who stands better - the same convention as the
// eval bar on Chess.com or Lichess.
function formatEval(m: EngineMove): string {
  if (m.mateIn != null) {
    return `${m.mateIn > 0 ? "+" : "-"}M${Math.abs(m.mateIn)}`;
  }
  if (m.evalCp != null) {
    const pawns = m.evalCp / 100;
    return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
  }
  return "—";
}

// Spelled out on hover: "+M7" and a bare "-1.20" both lean on knowing the sign
// convention, which is exactly the thing a learner won't know yet.
function describeEval(m: EngineMove): string {
  const suffix = " (scores are from White's perspective)";
  if (m.mateIn != null) {
    const side = m.mateIn > 0 ? "White" : "Black";
    return `${side} mates in ${Math.abs(m.mateIn)}${suffix}`;
  }
  if (m.evalCp != null) {
    if (m.evalCp === 0) return `Level${suffix}`;
    const side = m.evalCp > 0 ? "White" : "Black";
    const pawns = Math.abs(m.evalCp / 100).toFixed(2);
    return `${side} is ahead by ${pawns}${suffix}`;
  }
  return "No evaluation yet";
}

// A row that takes up exactly the height of a real one but carries no content.
// Used twice: as a loading placeholder, and to pad a short list out to the
// requested count. Sharing one definition is the point - the panel's height is
// only stable while these agree with a real row, and three near-identical
// copies of the markup would drift apart the first time a row gains a field.
// The non-breaking spaces are load-bearing: an empty span has no line box, so
// the row would collapse to its padding.
function BlankRow({ className, rank }: { className: string; rank?: number }) {
  return (
    <li className={className}>
      <span className="rank">{rank ?? " "}</span>
      <span className="san">&nbsp;</span>
      <span className="eval">&nbsp;</span>
      <span className="pv">&nbsp;</span>
    </li>
  );
}

export function MoveList({
  result,
  analyzing,
  error,
  onHoverMove,
  onPlayMove,
  onTogglePin,
  pinnedUci,
  moveCount,
  onMoveCountChange,
}: MoveListProps) {
  return (
    <div className="move-list">
      <div className="move-list-header">
        <h2 title="Evaluations are from White's perspective: + favours White, - favours Black">
          Best moves
        </h2>
        <label className="count-select">
          Show
          <select
            value={moveCount}
            onChange={(e) => onMoveCountChange(Number(e.target.value))}
          >
            {MOVE_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      {!analyzing && !result && !error && (
        <p className="status">Enter a position to see the top moves.</p>
      )}

      {result && result.moves.length === 0 && (
        <p className="status">No legal moves - checkmate or stalemate.</p>
      )}

      {result && result.moves.length > 0 && (
        <ol className="moves">
          {result.moves.map((m) => {
            const pinned = pinnedUci === m.move;
            const label = m.san ?? m.move;
            return (
            <li
              key={m.rank}
              className={`move rank-${m.rank}${pinned ? " pinned" : ""}`}
              onMouseEnter={() => onHoverMove?.(m.move)}
              onMouseLeave={() => onHoverMove?.(null)}
              onFocus={() => onHoverMove?.(m.move)}
              onBlur={() => onHoverMove?.(null)}
              // A single click pins/unpins this move's arrow (toggle handled in
              // the parent). It's a deliberate lock, not a play - playing is
              // gated behind the double-click so a stray click can't alter the
              // game. On a fast double-click the two clicks toggle the pin an
              // even number of times, so it lands back where it started before
              // the play, which then drops it anyway.
              onClick={() => onTogglePin?.(m.move)}
              onDoubleClick={() => onPlayMove?.(m.move)}
              onKeyDown={(e) => {
                // Enter/Space commit the focused move - the keyboard equivalent
                // of a double-click for a role="button" row (focus already drew
                // the preview arrow). preventDefault stops Space from also
                // scrolling the panel.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPlayMove?.(m.move);
                }
              }}
              role="button"
              aria-pressed={pinned}
              title={
                pinned
                  ? `${label} pinned - click to unpin, double-click to play`
                  : `Click to pin ${label}, double-click to play`
              }
              tabIndex={0}
            >
              <span className="rank">{m.rank}</span>
              <span className="san">{label}</span>
              <span className="eval" title={describeEval(m)}>
                {formatEval(m)}
              </span>
              {/* Always rendered, even with no line to show. A single-move PV
                  is normal near the end of a search tree (a forced reply, or a
                  mate in one), and omitting the second row there made that one
                  move's box shorter than its neighbours - so the panel's height
                  changed with the position and everything below it shifted. */}
              <span
                className="pv"
                title={m.pv.length > 1 ? m.pv.join(" ") : undefined}
              >
                {m.pv.length > 1
                  ? `${m.pv.slice(0, 5).join(" ")}${m.pv.length > 5 ? "…" : ""}`
                  : " "}
              </span>
            </li>
            );
          })}
          {/* Pad out to the requested count. A position with fewer legal moves
              than "Show N" (a king with three squares, say) would otherwise
              render a shorter panel than both the placeholders that preceded it
              and the position before it, so the move log below would settle
              upwards on arrival and drop back on the next move. Hidden rather
              than omitted: same height, nothing drawn. */}
          {Array.from(
            { length: Math.max(0, moveCount - result.moves.length) },
            (_, i) => (
              <BlankRow key={`pad-${i}`} className="move pad" />
            )
          )}
        </ol>
      )}

      {/* Placeholder rows for the first search on a NEW position. useStockfish
          drops the previous result the moment the FEN changes (those moves are
          frequently not even legal on the new board), which used to collapse
          this panel from a full list to a single "Analyzing…" line and yank the
          move log below it upwards for the length of the search. These reuse the
          real rows' markup and classes, so the reserved height follows the row
          styling instead of a hardcoded pixel guess. Not rendered on a
          multiPv-only change - that keeps its result and refines in place. */}
      {analyzing && !result && !error && (
        <ol className="moves skeleton" aria-hidden="true">
          {Array.from({ length: moveCount }, (_, i) => (
            <BlankRow key={i} className="move" rank={i + 1} />
          ))}
        </ol>
      )}

      {/* One status slot for both phases, always rendered once there's anything
          to say (just hidden when idle) so its height is reserved too -
          otherwise it popping in and out on every move shifts the move log below
          it up and down. */}
      {(result || analyzing) && (
        <p className={analyzing ? "status refining visible" : "status refining"}>
          {result ? "Refining…" : "Analyzing…"}
        </p>
      )}
    </div>
  );
}
