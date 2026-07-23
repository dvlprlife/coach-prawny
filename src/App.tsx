// Top-level layout: board on the left, moves on the right.
// Owns the FEN state, drives analysis, and lifts the hovered-move state so a
// suggested move drawn in the right pane shows as an arrow on the left board.

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
// The Stockfish worker + its .wasm are served from public/engine/ so they stay
// side by side (the worker loads the .wasm by relative path at runtime; bundling
// the .js alone would break that). Files were copied from
// node_modules/stockfish/bin/ - re-copy if you upgrade stockfish (see the copy
// step in package.json's "sync-engine" script).
//
// "-lite-single" = single-threaded + smaller NNUE net. Single-threaded means it
// runs WITHOUT the COOP/COEP headers, the safest default. For more speed, copy
// "stockfish-18-lite.js" (+ .wasm) instead and confirm your headers are live.
const stockfishUrl = "/engine/stockfish-18-lite-single.js";
import { BoardInput, type BoardArrow, type Square } from "./components/BoardInput";
import { MoveList } from "./components/MoveList";
import { MoveLog } from "./components/MoveLog";
import { About } from "./components/About";
import { useStockfish } from "./engine/useStockfish";
import { STARTING_FEN } from "./engine/fen";
import { config } from "./config/config";
import type { Fen, MoveLogEntry } from "./config/types";
import "./App.css";

// Arrow color per rank: best move in prawn-coral, second in sage green, rest
// muted. Kept in sync with the .move.rank-N border colors in App.css.
const ARROW_COLORS: Record<number, string> = {
  1: "#e8663f", // prawn - best
  2: "#5a8f78", // sage green - second best
  3: "#b0a99a", // muted
};
const FALLBACK_ARROW_COLOR = "#b0a99a"; // muted, for ranks beyond the palette above

// The move log doubles as the position's undo/redo history: `entries[0]` is
// the position the log started from (no `san`), and `index` is where on that
// timeline the board is currently showing. Playing a move while `index` isn't
// at the end truncates the "future" - same as any undo-then-branch history.
interface GameState {
  entries: MoveLogEntry[];
  index: number;
}

export default function App() {
  const [game, setGame] = useState<GameState>({
    entries: [{ fen: STARTING_FEN }],
    index: 0,
  });
  const fen = game.entries[game.index].fen;
  const [hoveredUci, setHoveredUci] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(config.engine.multiPv);
  const [showAbout, setShowAbout] = useState(false);

  // A played move (from BoardInput's play mode) extends the log; any other
  // FEN change (paste, setup edit, toggles, reset) starts a fresh one - it's
  // a new position, not a continuation of the old game.
  function handleFenChange(
    newFen: Fen,
    move?: { san: string; from: Square; to: Square }
  ) {
    setGame((g) => {
      if (move) {
        const truncated = g.entries.slice(0, g.index + 1);
        return {
          entries: [
            ...truncated,
            { fen: newFen, san: move.san, from: move.from, to: move.to },
          ],
          index: truncated.length,
        };
      }
      return { entries: [{ fen: newFen }], index: 0 };
    });
  }

  // Clicking a suggested move plays it, exactly as though it had been dragged:
  // chess.js validates it against the current position and gives the resulting
  // FEN, and passing `move` extends the move log rather than starting a fresh
  // one - the same path tryLegalMove takes in BoardInput. `uci` is the engine's
  // move string ("e2e4", or "e7e8q" with a trailing promotion piece).
  function playMove(uci: string) {
    try {
      const chess = new Chess(fen);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
      if (!move) return;
      // Drop the hovered arrow for the move we just played: the position has
      // changed under it, and React won't fire mouseleave on a list item that
      // stays under the cursor while it re-renders - so it would otherwise
      // linger as an arrow out of a now-empty square.
      setHoveredUci(null);
      handleFenChange(chess.fen(), {
        san: move.san,
        from: move.from as Square,
        to: move.to as Square,
      });
    } catch {
      // Not legal in this position (e.g. a stale suggestion left under the
      // cursor from a prior position) - do nothing.
    }
  }

  function goBack() {
    setGame((g) => ({ ...g, index: Math.max(0, g.index - 1) }));
  }

  function goForward() {
    setGame((g) => ({ ...g, index: Math.min(g.entries.length - 1, g.index + 1) }));
  }

  // Left/right arrows step through the move history, the way every chess site
  // behaves. Bound to the window rather than a focused element so it works
  // without clicking anything first - which means it has to stay out of the way
  // of text entry: the FEN box needs its arrow keys for the caret, and the
  // "Show N" <select> needs them to change value. Modified presses are left to
  // the browser (Alt+Left is Back).
  //
  // goBack/goForward only ever call setGame with an updater, so the listener can
  // be registered once and still act on the current history.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // The board isn't on screen behind the About panel - stepping the history
      // there would move an invisible position and kick off a pointless search.
      if (showAbout) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;

      e.preventDefault();
      if (e.key === "ArrowLeft") goBack();
      else goForward();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAbout]);

  const { result, analyzing, error, analyze } = useStockfish({
    workerUrl: stockfishUrl,
  });

  // The move that produced the currently-displayed position, whatever put us
  // here - a fresh move, or the log's back/forward buttons.
  const currentEntry = game.entries[game.index];
  const lastMove =
    currentEntry.from && currentEntry.to
      ? { from: currentEntry.from as Square, to: currentEntry.to as Square }
      : undefined;

  // Re-analyze whenever the position or requested move count changes
  // (debounced inside the hook).
  useEffect(() => {
    analyze(fen, moveCount);
  }, [fen, moveCount, analyze]);

  // Translate the hovered UCI move (e.g. "e2e4") into a board arrow tuple.
  // Look up its rank so the arrow color matches the move's ranking.
  const arrows = useMemo<BoardArrow[]>(() => {
    if (!hoveredUci) return [];
    // Only draw a move that belongs to the position currently on the board.
    // React doesn't fire onMouseLeave when an element unmounts under a still
    // cursor, so stepping the history with the pointer parked on a move would
    // otherwise leave `hoveredUci` set and paint the OLD position's arrow - a
    // move that may not even be legal here - until the mouse happens to move.
    const ranked = result?.moves.find((m) => m.move === hoveredUci);
    if (!ranked) return [];
    const from = hoveredUci.slice(0, 2) as Square;
    const to = hoveredUci.slice(2, 4) as Square;
    return [[from, to, ARROW_COLORS[ranked.rank] ?? FALLBACK_ARROW_COLOR]];
  }, [hoveredUci, result]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="mark">🦐</span>
        <h1>Coach Prawny</h1>
        <span className="tag">your next gambit</span>
        <button
          type="button"
          className="about-link"
          onClick={() => setShowAbout((v) => !v)}
        >
          {showAbout ? "Close" : "About"}
        </button>
      </header>

      {showAbout ? (
        <About onClose={() => setShowAbout(false)} />
      ) : (
        <main className="panels">
          <section className="left">
            <BoardInput
              fen={fen}
              onFenChange={handleFenChange}
              arrows={arrows}
              lastMove={lastMove}
            />
          </section>
          <section className="right">
            <MoveList
              result={result}
              analyzing={analyzing}
              error={error}
              onHoverMove={setHoveredUci}
              onPlayMove={playMove}
              moveCount={moveCount}
              onMoveCountChange={setMoveCount}
            />
            <MoveLog
              entries={game.entries}
              currentIndex={game.index}
              onBack={goBack}
              onForward={goForward}
            />
          </section>
        </main>
      )}
    </div>
  );
}
