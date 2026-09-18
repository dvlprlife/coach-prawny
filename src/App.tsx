// Top-level layout: board on the left, moves on the right.
// Owns the FEN state, drives analysis, and lifts the hovered-move state so a
// suggested move drawn in the right pane shows as an arrow on the left board.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { NoteLog } from "./components/NoteLog";
import { About } from "./components/About";
import { useStockfish } from "./engine/useStockfish";
import { STARTING_FEN } from "./engine/fen";
import { fenFromSearch, searchForFen } from "./engine/positionLink";
import { config } from "./config/config";
import type { Fen, MoveLogEntry, PositionNote } from "./config/types";
import "./App.css";

// Arrow color per rank: best move in prawn-coral, second in sage green, rest
// muted. Kept in sync with the .move.rank-N border colors in App.css.
const ARROW_COLORS: Record<number, string> = {
  1: "#e8663f", // prawn - best
  2: "#5a8f78", // sage green - second best
  3: "#b0a99a", // muted
};
const FALLBACK_ARROW_COLOR = "#b0a99a"; // muted, for ranks beyond the palette above

// The keys that drive the move history. Home/End sit alongside the arrows here
// because they want every one of the guards the handler applies - modifiers,
// text entry, and the About panel being open.
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

// The move log doubles as the position's undo/redo history: `entries[0]` is
// the position the log started from (no `san`), and `index` is where on that
// timeline the board is currently showing. Playing a move while `index` isn't
// at the end truncates the "future" - same as any undo-then-branch history.
// Notes live in here rather than in their own useState because every note
// points at an entry by index, and that invariant is only cheap to hold if the
// two move together. Truncating the log has to drop the notes hanging off the
// moves it just discarded, in the same updater that does the truncating - split
// across two setState calls, the filter would have to guess at the index the
// other one landed on.
interface GameState {
  entries: MoveLogEntry[];
  index: number;
  notes: PositionNote[];
}

export default function App() {
  // A ?fen= link opens straight to that position. Read once, in a lazy
  // initializer, so a later re-render can't reset the board to whatever the URL
  // said at mount. fenFromSearch validates and normalizes, returning null for
  // anything it won't vouch for - a hand-edited or truncated link lands you on
  // the starting position rather than an error, which is the friendlier failure
  // for something arriving from a chat window.
  const [game, setGame] = useState<GameState>(() => ({
    entries: [{ fen: fenFromSearch(window.location.search) ?? STARTING_FEN }],
    index: 0,
    notes: [],
  }));
  // Note ids only have to be unique within the session, and they're generated
  // in the handler rather than inside the setGame updater on purpose: StrictMode
  // runs updaters twice in development, which would burn two ids per note and
  // (worse) hand the two invocations different ones.
  const nextNoteId = useRef(1);
  const fen = game.entries[game.index].fen;
  // Two ways a suggested move becomes an arrow on the board: hovering a move
  // row previews one transiently, and clicking a row pins one so it stays after
  // the pointer leaves. Hover takes precedence while active (so you can preview
  // other moves without losing the pin), and the pinned arrow shows again once
  // you leave. Clicking the pinned row again, or clicking a different row,
  // moves/clears the pin - see togglePin.
  const [hoveredUci, setHoveredUci] = useState<string | null>(null);
  const [pinnedUci, setPinnedUci] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(config.engine.multiPv);
  // What the ENGINE is asked for, which is deliberately not always what is on
  // screen. "Show 0" hides the list but leaves this on the last real count, so
  // hiding is a display change and nothing else.
  //
  // The tempting version - clamp MultiPV to `max(moveCount, 1)` - is wrong, and
  // not only because MultiPV 0 is not a legal Stockfish option. Stockfish
  // genuinely searches differently per MultiPV: from the opening position it
  // calls d4 best at MultiPV 3 and e4 best at MultiPV 1. The rank-1 move is
  // what the move log grades against, so hiding the suggestions would silently
  // re-grade the game underneath you - stripping the star off a move that was
  // best when you played it. Hiding the answers must not change the marking.
  const [engineMultiPv, setEngineMultiPv] = useState(config.engine.multiPv);
  const [showAbout, setShowAbout] = useState(false);

  // 0 is a display state, so it never reaches the engine. Leaving engineMultiPv
  // alone also means toggling the list off and back on costs no search at all:
  // the effect below doesn't re-run, and the existing result is still there.
  function handleMoveCountChange(count: number) {
    setMoveCount(count);
    if (count > 0) setEngineMultiPv(count);
    // Hiding the list has to drop the arrows with it. A pin is unpinned by
    // clicking its row, so a pinned arrow outliving the rows would be stuck on
    // the board with nothing left to click - and a hover can outlive them too,
    // since React fires no mouseleave for a row that unmounts under the cursor.
    // Both would also defeat the point of hiding the moves: the answer would
    // still be drawn across the board.
    //
    // Done here rather than from an effect on `moveCount` because this is the
    // only place `moveCount` ever changes, so the two are equivalent - and this
    // is the event that caused it.
    else {
      setPinnedUci(null);
      setHoveredUci(null);
    }
  }

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
          // Playing a move from part-way back throws away the moves that came
          // after it, so any note pinned to one of them is now pinned to
          // nothing. Dropping them here is the only place that can be done
          // correctly - `g.index` is the cut, and it's only in scope inside
          // this updater. Notes on the surviving moves keep their indices,
          // which the slice above leaves untouched.
          notes: g.notes.filter((n) => n.index <= g.index),
        };
      }
      // Not a continuation: a pasted FEN, a setup edit, a castling or
      // side-to-move toggle. The log is replaced, so the notes describe moves
      // that are no longer there - keeping them would leave "3. Nf3 - the pin
      // is the idea" sitting against whatever move 3 happens to be next.
      return { entries: [{ fen: newFen }], index: 0, notes: [] };
    });
  }

  // A whole game arriving at once (a pasted PGN). Unlike handleFenChange this
  // replaces the entire timeline rather than starting a one-entry log, which is
  // the point: the history IS what a PGN carries, and it's what makes the move
  // log's annotations reachable for a game played somewhere else.
  //
  // Lands on the FINAL position, the way opening a game on any chess site does -
  // the result is what you came to look at, and ← steps back from there.
  //
  // Every entry arrives unscored: MoveLogEntry's eval fields are filled in by the
  // analysis effect below, one position at a time, as each is actually shown. So
  // a freshly loaded game is unannotated until you step back through it, and the
  // annotations appear as you go. Sweeping the whole game up front would mean
  // running the engine over 40 positions before showing anything.
  function loadGame(entries: MoveLogEntry[]) {
    if (entries.length === 0) return;
    // A different game entirely - same reasoning as the reset above.
    setGame({ entries, index: entries.length - 1, notes: [] });
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

  // Click a move to lock its arrow on the board; click the same one again to
  // unlock; click a different one to move the pin to it. Playing a move (or any
  // position change) drops the pin - see the effect below.
  function togglePin(uci: string) {
    setPinnedUci((prev) => (prev === uci ? null : uci));
  }

  // Keep the address bar on the position that's actually showing, so the URL is
  // always the one worth sharing and a reload returns to the same board.
  //
  // replaceState, NOT pushState: pushing would make the browser's back button
  // step through positions, which collides head-on with the ← / → move
  // navigation and the move log's own back/forward buttons - two competing
  // histories over the same board. Replacing keeps exactly one.
  useEffect(() => {
    window.history.replaceState(null, "", searchForFen(fen));
  }, [fen]);

  // A pin belongs to the position it was set on. Drop it whenever the board
  // changes underneath it - a played move, paste, setup edit, or a back/forward
  // step - so a locked arrow can't linger onto a position where its move may
  // not even be legal. (goBack/goForward don't route through handleFenChange,
  // so keying this off `fen` is what covers every path - the seven call sites
  // that move the position are exactly what would rot if enumerated here.)
  //
  // Adjusted during render rather than from an effect: React re-runs the
  // component immediately on this, before committing or painting, so no frame
  // is ever shown with the stale arrow still drawn. Clearing it from an effect
  // lands a render later, which is a visible flash of the previous position's
  // arrow on the new board.
  const [pinnedForFen, setPinnedForFen] = useState(fen);
  if (pinnedForFen !== fen) {
    setPinnedForFen(fen);
    setPinnedUci(null);
  }

  function goBack() {
    setGame((g) => ({ ...g, index: Math.max(0, g.index - 1) }));
  }

  function goForward() {
    setGame((g) => ({ ...g, index: Math.min(g.entries.length - 1, g.index + 1) }));
  }

  // Jump to either end of the history instead of stepping to it. `entries`
  // always holds at least the position the log started from, so the ends are 0
  // and length - 1 with nothing to clamp. These earn their place on a long game:
  // holding → back to the live position runs a search on every position it
  // passes through, where landing on it directly costs exactly one.
  function goToStart() {
    setGame((g) => ({ ...g, index: 0 }));
  }

  function goToEnd() {
    setGame((g) => ({ ...g, index: g.entries.length - 1 }));
  }

  // Clicking a note goes back to the position it was written about. Clamped
  // rather than trusted: a note's index is kept in step with the log by the
  // updaters above, and this is the cheap guard that keeps a slip there from
  // reading past the end of the array.
  function goToIndex(index: number) {
    setGame((g) => ({
      ...g,
      index: Math.min(Math.max(0, index), g.entries.length - 1),
    }));
  }

  // A note pins to whatever position is showing when it's saved, which is what
  // makes it findable again later.
  function addNote(text: string) {
    const id = nextNoteId.current++;
    setGame((g) => ({ ...g, notes: [...g.notes, { id, index: g.index, text }] }));
  }

  function deleteNote(id: number) {
    setGame((g) => ({ ...g, notes: g.notes.filter((n) => n.id !== id) }));
  }

  // Left/right arrows step through the move history and Home/End jump to its
  // ends, the way every chess site behaves. Bound to the window rather than a
  // focused element so it works without clicking anything first - which means it
  // has to stay out of the way of text entry: the FEN box needs its arrow keys
  // for the caret and Home/End to reach the ends of the line, and the "Show N"
  // <select> needs the arrows to change value. Modified presses are left to the
  // browser (Alt+Left is Back).
  //
  // All four handlers only ever call setGame with an updater, so the listener
  // can be registered once and still act on the current history.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!NAV_KEYS.has(e.key)) return;
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
      else if (e.key === "ArrowRight") goForward();
      else if (e.key === "Home") goToStart();
      else goToEnd();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAbout]);

  // Record each position's evaluation onto its own move-log entry as the
  // analysis lands. That's what lets MoveLog judge a move: comparing the score
  // of the position before it with the score after.
  //
  // Driven by the result arriving rather than by an effect watching `result`:
  // this runs exactly once per analysis, where the effect re-ran on every
  // change to `result` or `fen` and needed its equality check purely to stop
  // itself looping. That check is kept below, but now only to skip a pointless
  // re-render when a position is re-analyzed to the same numbers - stepping
  // away and back does that.
  //
  // Only the entry the result actually belongs to is ever written:
  // `entry.fen !== res.fen` is what turns a result landing after the board has
  // moved into a no-op instead of scoring the wrong move.
  //
  // A position only gets scored once it has been analyzed, so playing faster
  // than the search completes leaves entries unscored - those moves simply go
  // unannotated, and fill in if you step back through them later.
  const { result, analyzing, error, analyze } = useStockfish({
    workerUrl: stockfishUrl,
    onResult: (res) => {
      const best = res.moves.find((m) => m.rank === 1);
      if (!best) return;
      setGame((g) => {
        const entry = g.entries[g.index];
        if (!entry || entry.fen !== res.fen) return g;
        if (
          entry.evalCp === best.evalCp &&
          entry.mateIn === best.mateIn &&
          entry.bestUci === best.move
        ) {
          return g;
        }
        const entries = g.entries.slice();
        entries[g.index] = {
          ...entry,
          evalCp: best.evalCp,
          mateIn: best.mateIn,
          bestUci: best.move,
        };
        return { ...g, entries };
      });
    },
  });

  // The move that produced the currently-displayed position, whatever put us
  // here - a fresh move, or the log's back/forward buttons.
  const currentEntry = game.entries[game.index];
  const lastMove =
    currentEntry.from && currentEntry.to
      ? { from: currentEntry.from as Square, to: currentEntry.to as Square }
      : undefined;

  // Re-analyze whenever the position or the engine's move count changes
  // (debounced inside the hook). Keyed on engineMultiPv, NOT moveCount, so
  // hiding the list neither re-searches nor re-grades - see the note above.
  useEffect(() => {
    analyze(fen, engineMultiPv);
  }, [fen, engineMultiPv, analyze]);

  // Translate the active UCI move (e.g. "e2e4") into a board arrow tuple. The
  // hovered move wins while the pointer is on a row; otherwise the pinned one
  // shows. Look up its rank so the arrow color matches the move's ranking.
  const arrows = useMemo<BoardArrow[]>(() => {
    const activeUci = hoveredUci ?? pinnedUci;
    if (!activeUci) return [];
    // Only draw a move that belongs to the position currently on the board.
    // React doesn't fire onMouseLeave when an element unmounts under a still
    // cursor, so stepping the history with the pointer parked on a move would
    // otherwise leave `hoveredUci` set and paint the OLD position's arrow - a
    // move that may not even be legal here - until the mouse happens to move.
    // (The pin is dropped on every position change, so it can't go stale.)
    const ranked = result?.moves.find((m) => m.move === activeUci);
    if (!ranked) return [];
    const from = activeUci.slice(0, 2) as Square;
    const to = activeUci.slice(2, 4) as Square;
    return [[from, to, ARROW_COLORS[ranked.rank] ?? FALLBACK_ARROW_COLOR]];
  }, [hoveredUci, pinnedUci, result]);

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
              onGameLoad={loadGame}
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
              onTogglePin={togglePin}
              pinnedUci={pinnedUci}
              moveCount={moveCount}
              onMoveCountChange={handleMoveCountChange}
            />
            <MoveLog
              entries={game.entries}
              currentIndex={game.index}
              onBack={goBack}
              onForward={goForward}
              onFirst={goToStart}
              onLast={goToEnd}
            />
            <NoteLog
              entries={game.entries}
              currentIndex={game.index}
              notes={game.notes}
              onAdd={addNote}
              onDelete={deleteNote}
              onJump={goToIndex}
            />
          </section>
        </main>
      )}
    </div>
  );
}
