// LEFT PANE. Interactive board (drag to edit) + side-to-move toggle + FEN entry
// + upload/paste UI (recognition seam, stubbed in the MVP).
//
// The board supports two editing modes:
//   - "play": legal moves only (chess.js validates). Good for exploring lines.
//   - "setup": free placement - drag any piece anywhere, remove by dragging off.
//     Needed so users can build/correct arbitrary positions (and fix auto-detect
//     misreads later).
//
// Custom arrows are driven from above (hovered suggested move) via `arrows`,
// plus a second set drawn locally when hovering a piece on the board (its own
// legal destinations, play mode only).

import { useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { BoardOrientation, Square } from "react-chessboard/dist/chessboard/types";
import { Chess } from "chess.js";
import { recognizeBoard, NotImplementedError } from "../recognition/recognizeBoard";
import { config } from "../config/config";
import {
  STARTING_FEN,
  validateFen,
  normalizeFen,
  getSideToMove,
  setSideToMove,
  getCastlingRights,
  setCastlingRight,
  castlingIsPossible,
  type CastlingRight,
} from "../engine/fen";
import type { Fen } from "../config/types";

type EditMode = "play" | "setup";

// react-chessboard arrow tuple: [from, to, color?]. Square is a string-literal
// union of the 64 squares (re-exported so App can build arrows without a second
// import path).
export type { Square };
export type BoardArrow = [Square, Square, (string | undefined)?];

// Distinct from the rank colors (prawn/sage/muted) used for engine
// suggestions, so "what this piece can do" reads separately from "what the
// engine likes". Blue for the side whose turn it actually is, gray when
// previewing the other side's piece.
const LEGAL_MOVE_ARROW_COLOR = "#5b7a99";
const LEGAL_MOVE_ARROW_COLOR_OFF_TURN = "#9a9a94";

// Threat arrows point INWARDS (attacker -> hovered piece), the opposite of the
// outgoing move arrows, so the two sets stay readable even when they overlap.
// A deep red rather than the prawn coral, which is already spoken for by
// user-drawn arrows (customArrowColor).
const THREAT_ARROW_COLOR = "#b3302b";
// Defenders point INWARDS too, so hue is the only thing separating "could take
// this" from "would recapture" - which is why this is a saturated green rather
// than the palette's muted sage, too close to the move arrows' blue to tell
// apart at arrow width on a busy board.
const DEFENDER_ARROW_COLOR = "#3f8f63";

// Every piece of colour `by` bearing down on `square`, as arrows pointing INTO
// it. Read off the position exactly as given: attackers() ignores whose turn it
// is, so it needs no side-flipping and keeps working even where the flip in
// onMouseOverSquare fails. It counts pinned pieces too, which is what we want -
// a pinned piece still controls the square, and "nothing can take this" would
// be a lie the moment the pin breaks.
function attackArrows(
  chess: Chess,
  square: Square,
  by: "w" | "b",
  color: string
): BoardArrow[] {
  return chess
    .attackers(square, by)
    .map((from) => [from, square, color] as BoardArrow);
}

// Both sides' pressure on one square: hostile pieces red, friendly green. What
// counts as friendly is the colour standing there - or on an empty square the
// side to move, i.e. whoever would be placing something on it. Reading the two
// together is the point: three attackers against two defenders is a different
// story from three against none, and the count alone won't tell you which.
function pressureArrows(
  chess: Chess,
  square: Square,
  friendly: "w" | "b"
): BoardArrow[] {
  const hostile = friendly === "w" ? "b" : "w";
  return [
    ...attackArrows(chess, square, hostile, THREAT_ARROW_COLOR),
    ...attackArrows(chess, square, friendly, DEFENDER_ARROW_COLOR),
  ];
}

interface BoardInputProps {
  fen: Fen;
  // `move` is set only for a legal move played in play mode, so the parent
  // can tell "a move happened" (append to the log) apart from any other FEN
  // change - paste, setup edit, toggles, reset (start a fresh log).
  onFenChange: (fen: Fen, move?: { san: string; from: Square; to: Square }) => void;
  arrows?: BoardArrow[]; // suggested-move arrows drawn on hover
  lastMove?: { from: Square; to: Square }; // highlighted on the board, independent of hover
}

export function BoardInput({
  fen,
  onFenChange,
  arrows = [],
  lastMove,
}: BoardInputProps) {
  const [fenText, setFenText] = useState(fen);
  const [fenError, setFenError] = useState<string | null>(null);
  const [recognitionNote, setRecognitionNote] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>("play");
  const [orientation, setOrientation] = useState<BoardOrientation>("white");
  const [copied, setCopied] = useState(false);
  const [pieceMoveArrows, setPieceMoveArrows] = useState<BoardArrow[]>([]);
  const [squarePressureArrows, setSquarePressureArrows] = useState<BoardArrow[]>(
    []
  );
  const [showPressure, setShowPressure] = useState(true);

  const sideToMove = getSideToMove(fen);
  const castling = getCastlingRights(fen);

  // react-chessboard takes a pixel width and can't derive one from CSS, so the
  // board would stay fixed at whatever we hardcode and overflow a narrow screen.
  // Measuring the wrapper keeps it fluid: it re-fits on viewport resize, an
  // orientation flip, and when .panels stacks at the 700px breakpoint.
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(360);
  useEffect(() => {
    const wrap = boardWrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setBoardWidth(Math.floor(width));
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // react-chessboard memoizes each piece's drag handlers on
  // [piece, square, currentPosition, id] - NOT on the callback props - so a
  // callback that reads `mode`/`fen` directly can fire with a stale value
  // whenever mode changes without the position also changing (e.g. toggling
  // Play/Set up without moving a piece). Reading through a ref instead of the
  // closed-over variable sidesteps that: the ref object is stable, so even a
  // stale closure reads its current .current value.
  const latestRef = useRef({ mode, fen });
  latestRef.current = { mode, fen };

  // Shades the last move's squares regardless of hover, same convention as
  // most chess UIs. `lastMove` reflects whatever position is displayed - a
  // fresh move, or one reached via the move log's back/forward buttons.
  // The tint is translucent (see --last-move) so the square's own light/dark
  // colour still reads through it.
  const lastMoveStyles = lastMove
    ? {
        [lastMove.from]: { backgroundColor: "var(--last-move)" },
        [lastMove.to]: { backgroundColor: "var(--last-move)" },
      }
    : {};

  // Keep the FEN input box in sync when the position changes from elsewhere
  // (drag, toggle, recognition). Controlled but reconciled on external change.
  // Not while an error is showing, though: blurring an invalid FEN would other-
  // wise snap the box back to the old valid one, leaving the error message
  // sitting under a box whose contents are fine - the user's actual typo, the
  // thing the error is about, would vanish before they could read it.
  if (fenText !== fen && !fenError && document.activeElement?.tagName !== "INPUT") {
    setFenText(fen);
  }

  // Missing fields (side to move, castling, en passant, clocks) are filled
  // in with defaults before validation, so pasting just the piece placement
  // still works.
  function commitFen(next: Fen, move?: { san: string; from: Square; to: Square }) {
    const normalized = normalizeFen(next);
    const check = validateFen(normalized);
    if (!check.valid) {
      setFenError(check.error ?? "Invalid FEN");
      return;
    }
    setFenError(null);
    // Show what was actually committed, not what was typed. normalizeFen fills
    // in omitted fields and prunes castling rights the placement can't support,
    // so the raw text can otherwise sit there claiming a position we aren't
    // holding - and it would stick, since the reconcile below only runs on a
    // render and an unchanged FEN doesn't cause one.
    setFenText(normalized);
    // Nothing actually changed (e.g. blurring the FEN box unedited, or
    // clicking a toggle already in that state) - don't touch the move log.
    if (!move && normalized === fen) return;
    onFenChange(normalized, move);
  }

  // ---- drag handling ----
  function onPieceDrop(
    sourceSquare: string,
    targetSquare: string,
    piece: string
  ): boolean {
    if (mode === "play") {
      return tryLegalMove(sourceSquare, targetSquare, piece);
    }
    return placePiece(sourceSquare, targetSquare, piece);
  }

  // PLAY mode: only accept legal moves. chess.js applies the move and gives the
  // new FEN (which also flips side-to-move correctly, en passant, castling, etc.)
  // `piece` is "wQ"/"bN"/etc - on a non-promoting move chess.js just ignores an
  // irrelevant `promotion`, so it's safe to always pass it through. On a
  // promotion, react-chessboard withholds this call until its own Q/R/N/B
  // dialog resolves, so `piece` is already the color's actual choice.
  function tryLegalMove(from: string, to: string, piece: string): boolean {
    try {
      const chess = new Chess(fen);
      const move = chess.move({ from, to, promotion: piece[1].toLowerCase() });
      if (!move) return false;
      commitFen(chess.fen(), { san: move.san, from: move.from, to: move.to });
      return true;
    } catch {
      return false; // illegal move - snap the piece back
    }
  }

  // SETUP mode: free placement. Move a piece from one square to another
  // regardless of legality; the source square is cleared. This lets users
  // construct any position. We edit the board field of the FEN directly.
  function placePiece(from: string, to: string, piece: string): boolean {
    const board = fenToBoard(fen);
    const [fromFile, fromRank] = squareToIndex(from);
    const [toFile, toRank] = squareToIndex(to);
    // piece looks like "wP" / "bN"; convert to FEN char (uppercase=white).
    const color = piece[0];
    const type = piece[1];
    const fenChar = color === "w" ? type.toUpperCase() : type.toLowerCase();

    board[fromRank][fromFile] = "";
    board[toRank][toFile] = fenChar;

    const next = boardToFen(board, fen);
    commitFen(next);
    return true;
  }

  // SETUP mode: dragging a piece off the board removes it (react-chessboard
  // calls this for any off-board drop regardless of mode; play mode ignores
  // it - you can't delete a piece mid-game, so it just snaps back instead).
  // Reads mode/fen through latestRef - see its comment above for why.
  function onPieceDropOffBoard(square: Square, _piece: string) {
    const { mode: currentMode, fen: currentFen } = latestRef.current;
    if (currentMode !== "setup") return;
    const board = fenToBoard(currentFen);
    const [file, rank] = squareToIndex(square);
    board[rank][file] = "";
    commitFen(boardToFen(board, currentFen));
  }

  // ---- hover-to-show-legal-moves (play mode only; setup mode has no rules) ----
  // Shows the hovered piece's moves even when it's not that color's turn, by
  // switching the position's active color before asking chess.js for moves -
  // this is a "what can this piece do" preview, not a claim it can move now.
  function onMouseOverSquare(square: Square) {
    if (mode !== "play") return;
    try {
      const chess = new Chess(fen);
      const piece = chess.get(square);

      // Empty square: nothing is standing there to move, so there are no move
      // arrows - and no piece colour to read "friendly" from either. The side
      // to move stands in, answering "if I played something onto this square,
      // what could take it, and what of mine would recapture?"
      if (!piece) {
        setPieceMoveArrows([]);
        setSquarePressureArrows(pressureArrows(chess, square, chess.turn()));
        return;
      }

      const isSideToMove = piece.color === chess.turn();
      // Previewing an off-turn piece needs a position with ITS colour to move.
      // Built by reloading a side-flipped FEN rather than calling
      // chess.setTurn(): setTurn is implemented as a null move, and chess.js
      // refuses a null move while the side to move is in check ("Null move not
      // allowed when in check"). So hovering an enemy piece during a check used
      // to throw and clear every arrow - the board just went blank on exactly
      // the positions where you most want to look around. Loading the flipped
      // FEN has no such restriction; setSideToMove also drops the en passant
      // target, which would otherwise fail validation on the wrong rank.
      const view = isSideToMove
        ? chess
        : new Chess(setSideToMove(fen, piece.color));
      const moves = view.moves({ square, verbose: true });
      const color = isSideToMove
        ? LEGAL_MOVE_ARROW_COLOR
        : LEGAL_MOVE_ARROW_COLOR_OFF_TURN;
      setPieceMoveArrows(moves.map((m) => [m.from, m.to, color] as BoardArrow));

      // Occupied square: friendly is this piece's own colour, so the arrows
      // answer "what can take this piece, and what would recapture" regardless
      // of whose turn it actually is.
      setSquarePressureArrows(pressureArrows(chess, square, piece.color));
    } catch {
      setPieceMoveArrows([]);
      setSquarePressureArrows([]);
    }
  }

  function onMouseOutSquare() {
    setPieceMoveArrows([]);
    setSquarePressureArrows([]);
  }

  // ---- recognition (stub) ----
  async function handleFile(file: File) {
    setRecognitionNote(null);
    try {
      const result = await recognizeBoard(file);
      // No setFenText here: commitFen already shows the NORMALIZED FEN it
      // committed. Setting the raw recognition output afterwards would overwrite
      // it and put the box back out of step with the real position.
      commitFen(result.fen);
    } catch (e) {
      if (e instanceof NotImplementedError) {
        setRecognitionNote(e.message);
      } else {
        setRecognitionNote(e instanceof Error ? e.message : "Recognition failed.");
      }
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clearing the value matters for the retry case: a file input fires `change`
    // only when the selection actually changes, so picking the SAME file again
    // (say, after a recognition failure) would otherwise be a silent no-op.
    e.target.value = "";
    if (file) void handleFile(file);
  }

  // Copies the current committed position, not whatever's mid-edit in the
  // text box, so what's copied is always a valid, normalized FEN.
  async function copyFen() {
    try {
      await navigator.clipboard.writeText(fen);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setFenError("Couldn't copy to clipboard.");
    }
  }

  // Restores the standard starting position. Doesn't touch board mode or
  // orientation - those are view preferences, not part of the position.
  function resetBoard() {
    commitFen(STARTING_FEN);
  }

  // A right the placement can't support (king or rook no longer home) is shown
  // disabled rather than left looking clickable: normalizeFen prunes any such
  // right on commit, so the button would otherwise just quietly do nothing.
  function castlingButton(right: CastlingRight, label: string, description: string) {
    const possible = castlingIsPossible(fen, right);
    return (
      <button
        className={castling[right] ? "active" : ""}
        onClick={() => commitFen(setCastlingRight(fen, right, !castling[right]))}
        disabled={!possible}
        aria-pressed={castling[right]}
        title={
          possible
            ? description
            : `${description} - unavailable: the king and rook aren't both on their home squares`
        }
      >
        {label}
      </button>
    );
  }

  function onPaste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) =>
      i.type.startsWith("image/")
    );
    if (item) {
      const file = item.getAsFile();
      if (file) void handleFile(file);
    }
  }

  // Pasting is a page-level gesture: the paste event fires on whatever holds
  // focus, and on a fresh load that's <body> - which sits outside React's root
  // container, so an onPaste bound to this div never sees it and Ctrl+V does
  // nothing at all. Listening on the window is what makes the advertised "or
  // paste an image" actually work without clicking into the pane first.
  // Pasting text is unaffected: this only reacts to an image item, so pasting a
  // FEN into the box below still behaves normally.
  //
  // Not registered while recognition is hidden - with no UI to report the
  // result, an image paste would just call a stub that throws and swallow it.
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;
  useEffect(() => {
    if (!config.recognition.enabled) return;
    const handler = (e: ClipboardEvent) => onPasteRef.current(e);
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, []);

  return (
    <div className="board-input">
      <div className="board-wrap" ref={boardWrapRef}>
        <Chessboard
          position={fen}
          onPieceDrop={onPieceDrop}
          onPieceDropOffBoard={onPieceDropOffBoard}
          // Deliberately constant. react-chessboard memoizes each piece's drag
          // spec on [piece, square, position, id] - not on its callback props -
          // so a mode flip with no piece moved leaves this frozen at its old
          // value. Passing "trash" here would let the library delete a piece
          // from its OWN copy of the position while we're back in play mode and
          // our handler correctly refuses: board loses a piece the FEN still
          // has. Snapback keeps the library from mutating anything; the actual
          // removal in setup mode is done by onPieceDropOffBoard -> commitFen,
          // which flows back through the `position` prop. (latestRef fixes the
          // same staleness for the callback, but it can't reach a prop.)
          dropOffBoardAction="snapback"
          onMouseOverSquare={onMouseOverSquare}
          onMouseOutSquare={onMouseOutSquare}
          // Pressure arrows are filtered in here rather than at the point
          // they're computed, so flipping the toggle mid-hover takes effect
          // right away instead of waiting for the pointer to leave and re-enter
          // the square.
          customArrows={[
            ...arrows,
            ...pieceMoveArrows,
            ...(showPressure ? squarePressureArrows : []),
          ]}
          customSquareStyles={lastMoveStyles}
          boardWidth={boardWidth}
          arePiecesDraggable={true}
          customArrowColor="#e8663f"
          boardOrientation={orientation}
        />
      </div>

      <div className="board-controls">
        <div className="mode-toggle">
          <span>Board mode</span>
          <button
            className={mode === "play" ? "active" : ""}
            onClick={() => setMode("play")}
            title="Only legal moves; auto-updates whose turn it is"
          >
            Play
          </button>
          <button
            className={mode === "setup" ? "active" : ""}
            onClick={() => setMode("setup")}
            title="Freely place pieces to build any position"
          >
            Set up
          </button>
        </div>

        {/* Disabled in setup mode rather than merely inert: hover arrows are a
            play-mode feature (setup mode has no rules to derive them from), so
            an enabled-looking button would just appear to do nothing - the same
            reasoning the castling buttons use. */}
        <div className="pressure-toggle">
          <span>Pressure</span>
          <button
            className={showPressure ? "active" : ""}
            onClick={() => setShowPressure((on) => !on)}
            disabled={mode !== "play"}
            aria-pressed={showPressure}
            title={
              mode === "play"
                ? "On hover, arrow in every piece bearing down on that square: red for those that could capture there, green for those that would recapture"
                : "Pressure arrows need Play mode - Set up mode has no rules to derive them from"
            }
          >
            {showPressure ? "On" : "Off"}
          </button>
        </div>

        <div className="side-toggle">
          <span>Side to move</span>
          <button
            className={sideToMove === "w" ? "active" : ""}
            onClick={() => commitFen(setSideToMove(fen, "w"))}
          >
            White
          </button>
          <button
            className={sideToMove === "b" ? "active" : ""}
            onClick={() => commitFen(setSideToMove(fen, "b"))}
          >
            Black
          </button>
        </div>

        <div className="castling-toggle">
          <span>White castling</span>
          {castlingButton("K", "O-O", "White kingside (O-O)")}
          {castlingButton("Q", "O-O-O", "White queenside (O-O-O)")}
        </div>

        <div className="castling-toggle">
          <span>Black castling</span>
          {castlingButton("k", "O-O", "Black kingside (O-O)")}
          {castlingButton("q", "O-O-O", "Black queenside (O-O-O)")}
        </div>

        <div className="board-actions">
          <button
            type="button"
            className="action-btn"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
            title="View the board from the other side"
          >
            ⇅ Flip board
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={resetBoard}
            title="Reset to the starting position"
          >
            ↺ Reset board
          </button>
        </div>
      </div>

      <label className="fen-label">
        FEN
        <div className="fen-row">
          <input
            type="text"
            value={fenText}
            onChange={(e) => setFenText(e.target.value)}
            onBlur={() => commitFen(fenText)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitFen(fenText);
            }}
            spellCheck={false}
          />
          <button
            type="button"
            className="copy-btn"
            onClick={copyFen}
            title={copied ? "Copied!" : "Copy FEN to clipboard"}
          >
            {copied ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5L10 17.5L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect
                  x="8"
                  y="8"
                  width="13"
                  height="13"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </label>
      <p className="hint">
        placement · side (w/b) · castling (KQkq or -) · en passant · halfmove
        · fullmove — only placement is required, the rest default to w - - 0 1
      </p>
      {fenError && <p className="error">{fenError}</p>}

      {/* Hidden until recognizeBoard() is real - see config.recognition.enabled.
          The handlers below it stay wired, so flipping the flag restores this
          with no other changes. */}
      {config.recognition.enabled && (
        <>
          <div className="upload-row">
            <label className="upload-btn">
              Upload board image
              <input type="file" accept="image/*" onChange={onFileInput} hidden />
            </label>
            <span className="hint">or paste an image (Ctrl/Cmd+V)</span>
          </div>
          {recognitionNote && <p className="note">{recognitionNote}</p>}
        </>
      )}
    </div>
  );
}

// ---- FEN <-> 2D board helpers (rank 8 at index 0, file a at index 0) ----

function fenToBoard(fen: Fen): string[][] {
  const placement = fen.split(" ")[0];
  const rows = placement.split("/");
  return rows.map((row) => {
    const cells: string[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) cells.push("");
      } else {
        cells.push(ch);
      }
    }
    return cells;
  });
}

function boardToFen(board: string[][], prevFen: Fen): Fen {
  const placement = board
    .map((row) => {
      let out = "";
      let empty = 0;
      for (const cell of row) {
        if (cell === "") {
          empty++;
        } else {
          if (empty > 0) {
            out += empty;
            empty = 0;
          }
          out += cell;
        }
      }
      if (empty > 0) out += empty;
      return out;
    })
    .join("/");

  // Carry the other FEN fields over from prev, except the en passant target:
  // it names a square that a pawn just double-stepped past, and an arbitrary
  // setup edit makes that claim meaningless (it would let the engine consider a
  // capture onto a square no pawn ever skipped). Castling rights are carried
  // over as-is and pruned against the new placement in normalizeFen.
  const [, side = "w", castling = "-", , halfmove = "0", fullmove = "1"] =
    prevFen.split(/\s+/);
  return `${placement} ${side} ${castling} - ${halfmove} ${fullmove}`;
}

// "e4" -> [file index 0-7, rank index 0-7 where 0 = rank 8]
function squareToIndex(square: string): [number, number] {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = 8 - parseInt(square[1], 10);
  return [file, rank];
}
