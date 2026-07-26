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

import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard, defaultArrowOptions } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { Chess } from "chess.js";
// react-chessboard 5 dropped its exported Square/BoardOrientation types (and the
// deep `dist/chessboard/types` path they lived on) - it types every square as a
// plain string. chess.js publishes the same 64-square literal union, so sourcing
// it there keeps the app's own typing as strict as it was before.
import type { Square } from "chess.js";
import { recognizeBoard, NotImplementedError } from "../recognition/recognizeBoard";
import { shareUrl } from "../engine/positionLink";
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
type BoardOrientation = "white" | "black";

// The app's own arrow shape: [from, to, color?]. react-chessboard 5 wants
// `{ startSquare, endSquare, color }` objects instead, but this tuple stays the
// internal contract - App.tsx and the helpers below all build arrows with it -
// and is converted at the <Chessboard> boundary. Keeping the seam means a
// library shape change doesn't ripple through the app. Square is re-exported so
// App can type arrows without importing chess.js itself.
export type { Square };
export type BoardArrow = [Square, Square, (string | undefined)?];

// The pieces a pawn may become. Kept in board-left-to-right order rather than
// value order, matching how every chess UI lays the picker out.
const PROMOTION_PIECES = ["q", "r", "b", "n"] as const;
type PromotionPiece = (typeof PROMOTION_PIECES)[number];
const PROMOTION_LABELS: Record<PromotionPiece, string> = {
  q: "Queen",
  r: "Rook",
  b: "Bishop",
  n: "Knight",
};
// Unicode piece glyphs, indexed by colour then piece. Drawn as text rather than
// reusing react-chessboard's SVGs: those are only reachable through its own
// render pipeline, not as standalone components.
const PROMOTION_GLYPHS: Record<"w" | "b", Record<PromotionPiece, string>> = {
  w: { q: "♕", r: "♖", b: "♗", n: "♘" },
  b: { q: "♛", r: "♜", b: "♝", n: "♞" },
};

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

// react-chessboard 5 keys each rendered arrow by its square pair alone
// (`chessboard-arrow-<start>-<end>`), with no colour in the key, so two arrows
// sharing a pair are two React children with the same key: it warns and drops
// one. Our three sources overlap legitimately - the engine's suggested move is
// very often also one of the hovered piece's legal moves - so the list has to be
// deduped before it goes in. First occurrence wins, and the caller passes them
// suggestion-first, so the engine's arrow survives and the paler preview
// duplicate is the one discarded. (Version 4 keyed by index and drew both
// stacked, which is why this only appeared on the upgrade.)
function toBoardArrows(list: BoardArrow[]) {
  const seen = new Set<string>();
  const out: { startSquare: Square; endSquare: Square; color: string }[] = [];
  for (const [startSquare, endSquare, color] of list) {
    const key = `${startSquare}-${endSquare}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startSquare, endSquare, color: color ?? LEGAL_MOVE_ARROW_COLOR });
  }
  return out;
}

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
  const [linkCopied, setLinkCopied] = useState(false);
  // Which square's arrows to show. A pinned square (set by right-clicking) wins:
  // once set, its arrows stay on - and its cell stays tinted (see squareStyles) -
  // until it's unpinned or another square is pinned; hovering the board doesn't
  // disturb them. Hovering only previews a square's arrows when nothing is
  // pinned. (The Best-moves list keeps hover-on-top precedence; the board pin is
  // stickier because you're often mousing over the board to read it.)
  const [hoveredSquare, setHoveredSquare] = useState<Square | null>(null);
  const [pinnedSquare, setPinnedSquare] = useState<Square | null>(null);
  const [showPressure, setShowPressure] = useState(true);

  // Undo/redo history for Set up mode only. Play mode already has one - the move
  // log - but a Set up edit deliberately resets that (it's a new position, not a
  // continuation), so free-placement edits had nothing to step back through.
  // These stacks hold the positions before/after the current one; they're kept
  // separate from the move log so they never leak into the game's PGN. A fresh
  // history starts each time you enter Set up (see the effect on `mode`).
  const [setupPast, setSetupPast] = useState<Fen[]>([]);
  const [setupFuture, setSetupFuture] = useState<Fen[]>([]);

  const sideToMove = getSideToMove(fen);
  const castling = getCastlingRights(fen);

  // A promotion the user has started but not yet resolved. react-chessboard 4
  // owned this interaction - it withheld onPieceDrop until its own Q/R/B/N
  // dialog resolved, so the move arrived already carrying the chosen piece.
  // Version 5 removed the dialog and every prop around it
  // (onPromotionPieceSelect, promotionToSquare, autoPromoteToQueen), so the
  // choice is ours to collect or silently lose. Null means no promotion pending.
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
    color: "w" | "b";
  } | null>(null);

  // Kept from the version 4 era, where react-chessboard memoized each piece's
  // drag handlers on [piece, square, currentPosition, id] rather than on the
  // callback props, so a handler reading `mode`/`fen` from its closure could
  // fire with a value that went stale when mode changed without the position
  // also changing (toggling Play/Set up without moving anything). Version 5
  // routes handlers through a context provider that re-reads `options` each
  // render, which should make this unnecessary - but the failure mode is silent
  // and position-corrupting, and a stable ref costs nothing, so it stays as a
  // guard rather than something to prove unnecessary and remove.
  const latestRef = useRef({ mode, fen });
  latestRef.current = { mode, fen };

  // The board's hover/pin arrows: a piece's legal moves (blue when it's that
  // side's turn, gray when previewing the other side's piece) plus the pressure
  // on the square. Drawn for whichever square is "active": the PINNED square wins
  // whenever one is set, so its arrows stay put until it's unpinned or another
  // square is pinned - moving the pointer around the board doesn't disturb them.
  // Only when nothing is pinned does hovering a square preview its arrows.
  // Recomputed from the live FEN so it always matches the board in front of you.
  // Play mode only: setup mode has no rules to derive moves or pressure from.
  const { pieceMoveArrows, squarePressureArrows } = useMemo<{
    pieceMoveArrows: BoardArrow[];
    squarePressureArrows: BoardArrow[];
  }>(() => {
    const square = pinnedSquare ?? hoveredSquare;
    const none = {
      pieceMoveArrows: [] as BoardArrow[],
      squarePressureArrows: [] as BoardArrow[],
    };
    if (!square || mode !== "play") return none;
    try {
      const chess = new Chess(fen);
      const piece = chess.get(square);

      // Empty square: nothing is standing there to move, so there are no move
      // arrows - and no piece colour to read "friendly" from either. The side
      // to move stands in, answering "if I played something onto this square,
      // what could take it, and what of mine would recapture?"
      if (!piece) {
        return {
          pieceMoveArrows: [],
          squarePressureArrows: pressureArrows(chess, square, chess.turn()),
        };
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
      return {
        pieceMoveArrows: moves.map((m) => [m.from, m.to, color] as BoardArrow),
        // Occupied square: friendly is this piece's own colour, so the arrows
        // answer "what can take this piece, and what would recapture" regardless
        // of whose turn it actually is.
        squarePressureArrows: pressureArrows(chess, square, piece.color),
      };
    } catch {
      return none;
    }
  }, [hoveredSquare, pinnedSquare, fen, mode]);

  // A pinned square belongs to the position it was set on; drop it on any board
  // change so its arrows can't linger onto a position where the piece has moved
  // or vanished. (The Best-moves pin clears the same way.)
  useEffect(() => {
    setPinnedSquare(null);
  }, [fen]);

  // ---- Set up mode undo/redo ----
  // Record every position change made while in Set up mode so it can be stepped
  // back. Watching the committed `fen` rather than hooking each edit site means
  // piece drops, off-board removals and the side/castling toggles are all
  // covered uniformly. `setupNavRef` flags the changes that undo/redo themselves
  // make, so those aren't re-recorded as fresh edits.
  const prevFenRef = useRef(fen);
  const setupNavRef = useRef(false);
  useEffect(() => {
    const prev = prevFenRef.current;
    if (fen === prev) return;
    prevFenRef.current = fen;
    if (setupNavRef.current) {
      setupNavRef.current = false;
      return;
    }
    if (mode !== "setup") return;
    setSetupPast((p) => [...p, prev]);
    setSetupFuture([]);
  }, [fen, mode]);

  // A fresh history each time the mode changes, so entering Set up starts clean
  // and leaving it doesn't leave a stale stack pointing at old positions.
  useEffect(() => {
    setSetupPast([]);
    setSetupFuture([]);
  }, [mode]);

  const canUndoSetup = mode === "setup" && setupPast.length > 0;
  const canRedoSetup = mode === "setup" && setupFuture.length > 0;

  function undoSetup() {
    if (!canUndoSetup) return;
    const prev = setupPast[setupPast.length - 1];
    setSetupPast(setupPast.slice(0, -1));
    setSetupFuture([fen, ...setupFuture]);
    setupNavRef.current = true; // the resulting fen change is navigation, not an edit
    commitFen(prev);
  }

  function redoSetup() {
    if (!canRedoSetup) return;
    const next = setupFuture[0];
    setSetupFuture(setupFuture.slice(1));
    setSetupPast([...setupPast, fen]);
    setupNavRef.current = true;
    commitFen(next);
  }

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or +Y) drive the same undo/redo while in
  // Set up mode. Bound to the window so it works without focusing a control, but
  // held off while typing in the FEN box. The handler closes over live state, so
  // it routes through refs kept current each render (same trick as onPaste).
  const undoRef = useRef(undoSetup);
  const redoRef = useRef(redoSetup);
  undoRef.current = undoSetup;
  redoRef.current = redoSetup;
  useEffect(() => {
    if (mode !== "setup") return;
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redoRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  // Square tints, all sharing the translucent --last-move colour so the square's
  // own light/dark shade still reads through:
  //  - the last move's from/to squares (regardless of hover, same convention as
  //    most chess UIs; `lastMove` reflects whatever position is displayed - a
  //    fresh move, or one reached via the move log's back/forward buttons), and
  //  - the pinned square, so which cell is locked reads at a glance rather than
  //    only from its arrows. Gated on play mode to stay in step with the pin's
  //    arrows, which also only show there.
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { backgroundColor: "var(--last-move)" };
    squareStyles[lastMove.to] = { backgroundColor: "var(--last-move)" };
  }
  if (pinnedSquare && mode === "play") {
    squareStyles[pinnedSquare] = { backgroundColor: "var(--last-move)" };
  }

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
  // One handler for every drop now. Version 4 had a separate
  // onPieceDropOffBoard; version 5 folds that in by reporting targetSquare as
  // null, which is a strict improvement here - the library no longer touches
  // its own copy of the position on an off-board drop, so the v4 hazard of it
  // deleting a piece we then refused to remove (board a piece short of the FEN)
  // cannot happen. Mode and fen still come from latestRef rather than the
  // closure; see its comment above.
  function handlePieceDrop({
    piece,
    sourceSquare,
    targetSquare,
  }: PieceDropHandlerArgs): boolean {
    const { mode: currentMode, fen: currentFen } = latestRef.current;

    // Dragged off the board entirely.
    if (targetSquare === null) {
      // Play mode has no notion of removing a piece mid-game, so snap back.
      if (currentMode !== "setup") return false;
      const board = fenToBoard(currentFen);
      const [file, rank] = squareToIndex(sourceSquare);
      board[rank][file] = "";
      commitFen(boardToFen(board, currentFen));
      return true;
    }

    if (currentMode === "play") {
      return tryLegalMove(sourceSquare, targetSquare, piece.pieceType, currentFen);
    }
    return placePiece(sourceSquare, targetSquare, piece.pieceType, currentFen);
  }

  // Would this drop land a pawn on its promotion rank? Asked before the move is
  // played, so the piece identity has to come from the dragged piece rather than
  // from the resulting position. Only a legality check away from certain - and
  // tryLegalMove does that check immediately after.
  function isPromotion(pieceType: string, to: string): boolean {
    if (pieceType[1] !== "P") return false;
    return pieceType[0] === "w" ? to[1] === "8" : to[1] === "1";
  }

  // PLAY mode: only accept legal moves. chess.js applies the move and gives the
  // new FEN (which also flips side-to-move correctly, en passant, castling, etc.)
  //
  // Promotions are the one move we cannot complete here, because the piece to
  // promote to is a user choice and version 5 no longer collects it. So: confirm
  // the move is legal (as a queen - promotion choice never changes legality),
  // then park it in pendingPromotion and return false so the pawn snaps back to
  // its own square while the picker is up. The move is applied for real in
  // resolvePromotion once a piece is chosen; returning true here would leave the
  // board showing a pawn sitting on the last rank in a position the FEN doesn't
  // agree with.
  function tryLegalMove(
    from: string,
    to: string,
    pieceType: string,
    currentFen: Fen
  ): boolean {
    try {
      const chess = new Chess(currentFen);
      if (isPromotion(pieceType, to)) {
        const legal = chess
          .moves({ square: from as Square, verbose: true })
          .some((m) => m.to === to);
        if (!legal) return false;
        setPendingPromotion({
          from: from as Square,
          to: to as Square,
          color: pieceType[0] as "w" | "b",
        });
        return false;
      }
      const move = chess.move({ from, to });
      if (!move) return false;
      commitFen(chess.fen(), { san: move.san, from: move.from, to: move.to });
      return true;
    } catch {
      return false; // illegal move - snap the piece back
    }
  }

  // Applies the parked promotion with the piece the user picked.
  function resolvePromotion(choice: PromotionPiece) {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    try {
      const chess = new Chess(latestRef.current.fen);
      const move = chess.move({ from, to, promotion: choice });
      if (!move) return;
      commitFen(chess.fen(), { san: move.san, from: move.from, to: move.to });
    } catch {
      // Position moved on under the picker (undo, paste, reset). Dropping the
      // move is the safe outcome - better than forcing a move onto a position
      // the user is no longer looking at.
    }
  }

  // SETUP mode: free placement. Move a piece from one square to another
  // regardless of legality; the source square is cleared. This lets users
  // construct any position. We edit the board field of the FEN directly.
  function placePiece(
    from: string,
    to: string,
    pieceType: string,
    currentFen: Fen
  ): boolean {
    const board = fenToBoard(currentFen);
    const [fromFile, fromRank] = squareToIndex(from);
    const [toFile, toRank] = squareToIndex(to);
    // pieceType looks like "wP" / "bN"; convert to FEN char (uppercase=white).
    const color = pieceType[0];
    const type = pieceType[1];
    const fenChar = color === "w" ? type.toUpperCase() : type.toLowerCase();

    board[fromRank][fromFile] = "";
    board[toRank][toFile] = fenChar;

    const next = boardToFen(board, currentFen);
    commitFen(next);
    return true;
  }

  // ---- hover / click to show a square's arrows (play mode only) ----
  // Hover just records which square the pointer is on; the arrows themselves are
  // derived in the useMemo above (which also handles the off-turn preview and
  // the empty-square pressure case). Version 5 passes { piece, square }; the
  // piece it hands over is ignored - the memo reads it back from the position it
  // reasons with, and mixing the two sources would risk them disagreeing.
  function onMouseOverSquare({ square }: SquareHandlerArgs) {
    setHoveredSquare(square as Square);
  }

  function onMouseOutSquare() {
    setHoveredSquare(null);
  }

  // RIGHT-click a square (or the piece on it) to PIN its arrows so they stay
  // after the pointer leaves; right-click the same square again to unpin, or a
  // different one to move the pin. No square highlight - the arrows are the whole
  // signal. Play mode only, to match the hover arrows.
  //
  // Right-click, deliberately, not left: the left button is owned by dnd-kit's
  // drag (dragActivationDistance is 1px, so a real left click on a piece becomes
  // a drag and never arrives as a click). The right button never drags a piece,
  // so onSquareRightClick fires once for pieces AND empty squares alike - one
  // clean handler, no drag ambiguity. react-chessboard already preventDefaults
  // the context menu and only fires this on a right *click* (a right *drag* still
  // draws a user arrow), so the two don't collide.
  function onSquareRightClick({ square }: SquareHandlerArgs) {
    if (mode !== "play") return;
    setPinnedSquare((prev) => (prev === square ? null : (square as Square)));
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

  // Copies a link that opens straight to this position. Built from the
  // committed fen rather than read out of the address bar: App keeps the two in
  // step, but the fen prop is the position actually on the board, and reading
  // location here would depend on that sync having already run.
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        shareUrl(fen, window.location.origin, window.location.pathname)
      );
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
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
      <div className="board-wrap">
        <Chessboard
          options={{
            position: fen,
            onPieceDrop: handlePieceDrop,
            onMouseOverSquare,
            onMouseOutSquare,
            onSquareRightClick,
            // Deliberately constant, not `mode === "setup"`. Version 5 only
            // uses this to decide whether to constrain the drag inside the
            // board; it never removes anything itself, so leaving it on and
            // refusing off-board drops in handlePieceDrop keeps the decision in
            // one place. It also means no <Chessboard> input depends on
            // component state, which is what made the version 4 equivalent
            // (dropOffBoardAction) go stale on a mode flip.
            allowDragOffBoard: true,
            allowDragging: true,
            // Pressure arrows are filtered in here rather than at the point
            // they're computed, so flipping the toggle mid-hover takes effect
            // right away instead of waiting for the pointer to leave and
            // re-enter the square. Version 5 wants objects, not tuples.
            // Suggestion arrows first: toBoardArrows keeps the first of any
            // duplicated square pair, so the engine's arrow outranks the
            // hover preview when a move appears in both.
            arrows: toBoardArrows([
              ...arrows,
              ...pieceMoveArrows,
              ...(showPressure ? squarePressureArrows : []),
            ]),
            // User-drawn arrows (right-drag) - version 4's customArrowColor.
            arrowOptions: { ...defaultArrowOptions, color: "#e8663f" },
            squareStyles: squareStyles,
            boardOrientation: orientation,
            // Version 5 sizes itself from CSS instead of taking a pixel
            // boardWidth, so the ResizeObserver that used to measure the
            // wrapper and feed it back in is gone entirely - .board-wrap's own
            // width is now the only thing deciding this.
            boardStyle: { width: "100%", height: "auto" },
          }}
        />
      </div>

      {/* Replaces the picker react-chessboard 4 drew itself. Rendered outside
          .board-wrap so it is never clipped by the board's own bounds. */}
      {pendingPromotion && (
        <div
          className="promotion-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Choose promotion piece"
        >
          <div className="promotion-picker">
            <span className="promotion-prompt">Promote to</span>
            <div className="promotion-choices">
              {PROMOTION_PIECES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="promotion-choice"
                  onClick={() => resolvePromotion(p)}
                  title={PROMOTION_LABELS[p]}
                  aria-label={PROMOTION_LABELS[p]}
                  autoFocus={p === "q"}
                >
                  {PROMOTION_GLYPHS[pendingPromotion.color][p]}
                </button>
              ))}
            </div>
            {/* The pawn has already snapped back, so dismissing simply abandons
                the move - no position to undo. */}
            <button
              type="button"
              className="promotion-cancel"
              onClick={() => setPendingPromotion(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

        {/* Undo/redo for free-placement edits, shown only in Set up mode - Play
            mode already has this in the move log. Ctrl+Z / Ctrl+Shift+Z do the
            same (see the keydown effect). The history resets on entering Set up. */}
        {mode === "setup" && (
          <div className="setup-undo">
            <span>Edit history</span>
            <button
              type="button"
              className="action-btn"
              onClick={undoSetup}
              disabled={!canUndoSetup}
              title="Undo the last setup edit (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={redoSetup}
              disabled={!canRedoSetup}
              title="Redo the last undone edit (Ctrl+Shift+Z)"
            >
              ↷ Redo
            </button>
          </div>
        )}

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
          <button
            type="button"
            className="copy-btn"
            onClick={copyLink}
            title={
              linkCopied ? "Link copied!" : "Copy a link to this position"
            }
            aria-label="Copy a link to this position"
          >
            {linkCopied ? (
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
                <path
                  d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"
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
