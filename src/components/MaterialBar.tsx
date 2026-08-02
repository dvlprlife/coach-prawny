// One side's material summary: the pieces it has captured, and its lead in
// pawns if it has one. Drawn as a row above and below the board, each row
// belonging to the side on that edge - so it follows board orientation rather
// than colour.
//
// Purely presentational. Everything it shows comes from readMaterial(), which
// reads the position and nothing else, so these rows are populated the instant
// the board changes instead of waiting on a search.

import {
  MATERIAL_ORDER,
  capturedTotal,
  type Material,
  type MaterialPiece,
  type PieceCount,
} from "../engine/material";

// Drawn as text rather than reusing react-chessboard's SVGs: those are only
// reachable through its own render pipeline, not as standalone components -
// the same reason the promotion picker draws its own glyphs.
const GLYPHS: Record<"w" | "b", Record<MaterialPiece, string>> = {
  w: { q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const PIECE_NAME: Record<MaterialPiece, string> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

const SIDE_NAME: Record<"w" | "b", string> = { w: "White", b: "Black" };

// "2 pawns, 1 knight" - or null when nothing has been taken.
function listCaptured(count: PieceCount): string | null {
  const parts = MATERIAL_ORDER.filter((piece) => count[piece] > 0).map(
    (piece) =>
      `${count[piece]} ${PIECE_NAME[piece]}${count[piece] > 1 ? "s" : ""}`
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

interface MaterialBarProps {
  material: Material;
  // Whose row this is - the side sitting on this edge of the board.
  side: "w" | "b";
}

export function MaterialBar({ material, side }: MaterialBarProps) {
  const mine = side === "w" ? material.white : material.black;
  // A side's captured pieces are the opponent's, so they are drawn in the
  // opponent's colour: the White row shows the black pieces White has taken.
  const glyphs = GLYPHS[side === "w" ? "b" : "w"];
  // `balance` is on White's scale (as every evaluation in this app is), so
  // Black's lead is its negation. Only a positive number is a lead worth
  // showing - the other row carries the same information already.
  const lead = side === "w" ? material.balance : -material.balance;
  const anyCaptured = capturedTotal(mine.captured) > 0;

  const captured = listCaptured(mine.captured);
  const label = [
    `${SIDE_NAME[side]} has captured ${captured ?? "nothing"}`,
    lead > 0 ? `and leads by ${lead}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    // Always rendered, even with nothing to show. The row reserves its height
    // in CSS so that the first capture of a game doesn't shove the board down
    // the page - the same reasoning the Best moves panel's blank rows use.
    <div className="material-bar" aria-label={label} title={label}>
      {/* aria-hidden because the glyphs would otherwise be announced one by one
          as "white chess queen, white chess queen, ..."; the row's aria-label
          says the same thing in words. */}
      <span className="material-captured" aria-hidden="true">
        {anyCaptured
          ? MATERIAL_ORDER.flatMap((piece) =>
              Array.from({ length: mine.captured[piece] }, (_, i) => (
                <span className="material-piece" key={`${piece}-${i}`}>
                  {glyphs[piece]}
                </span>
              ))
            )
          : // A non-breaking space is load-bearing: an empty span has no line
            // box, so the row would collapse to its padding.
            "\u00a0"}
      </span>
      {lead > 0 && <span className="material-lead">+{lead}</span>}
    </div>
  );
}
