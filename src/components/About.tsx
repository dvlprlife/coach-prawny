// A single static info panel, swapped in for the board+moves panels by a
// button in the header. Not worth a router for one page.
//
// This component is ALSO the source for the standalone /about.html page:
// scripts/build-about.mjs renders it to static HTML after the bundle is built,
// so the explanation lives in exactly one place and cannot drift between the
// in-app panel and the linkable page. That page has nothing to close and no
// React to do it with, so it passes `backHref` and gets a link home instead of
// a button. Keep this component free of hooks and browser APIs - it has to
// render on the server too.

interface AboutProps {
  // In-app: dismiss the panel. Omitted on the static page.
  onClose?: () => void;
  // Static page: where the "back" control should link to. When set, the
  // control renders as an anchor rather than a button.
  backHref?: string;
}

export function About({ onClose, backHref }: AboutProps) {
  return (
    <div className="about">
      <p>
        Coach Prawny takes a chess position and shows you the top engine
        moves, ranked and evaluated - paste a FEN or drag pieces into place,
        and the board re-analyzes as you go.
      </p>

      <h2>Setting up a position</h2>
      <ul>
        <li>
          <strong>Drag pieces</strong> to arrange the board. In{" "}
          <strong>Play</strong> mode only legal moves are allowed and the side
          to move flips automatically; switch to <strong>Set&nbsp;up</strong>{" "}
          mode to place pieces freely, and drag a piece off the board to remove
          it.
        </li>
        <li>
          <strong>Paste or type a FEN</strong> in the box below the board and
          press Enter - only the piece placement is required, the rest fills in
          with defaults. The copy button copies the current position back out.
        </li>
        <li>
          Set whose turn it is with <strong>Side to move</strong>, and toggle{" "}
          <strong>castling</strong> rights for each side. A castling button is
          disabled when that king and rook aren't both on their home squares.
        </li>
        <li>
          <strong>Share a position</strong> with the link button beside the FEN
          box - it copies a link that opens straight to the board in front of
          you. The address bar keeps up on its own as you play, so you can also
          just copy it. Opening a link with a position in it starts a fresh
          game from there.
        </li>
        <li>
          Made a mistake? In Set&nbsp;up mode, <strong>Undo</strong> /{" "}
          <strong>Redo</strong> (or <strong>Ctrl+Z</strong> /{" "}
          <strong>Ctrl+Shift+Z</strong>) step back and forth through your edits.
        </li>
      </ul>

      <h2>Reading the best moves</h2>
      <p>
        The right-hand panel lists the engine's top moves, ranked and scored.
        Scores are from <strong>White's</strong> perspective - positive means
        White stands better, negative means Black - and a forced mate reads as{" "}
        <strong>+M5</strong> / <strong>-M5</strong>. Use <strong>Show</strong>{" "}
        to choose how many moves (1-5) to list.
      </p>
      <ul>
        <li>
          <strong>Hover</strong> a move to preview its arrow on the board.
        </li>
        <li>
          <strong>Click</strong> a move to pin that arrow so it stays; click it
          again to unpin, or click another move to move the pin.
        </li>
        <li>
          <strong>Double-click</strong> a move - or press Enter / Space with it
          focused - to play it on the board.
        </li>
      </ul>

      <h2>Exploring on the board</h2>
      <ul>
        <li>
          <strong>Hover a piece</strong> to see where it can go - blue arrows
          when it's that side's turn, grey when you're peeking at the other
          side's piece.
        </li>
        <li>
          With <strong>Pressure</strong> on, hovering a square also shows who is
          fighting over it: <strong>red</strong> arrows for pieces that could
          capture there, <strong>green</strong> for pieces that would recapture.
        </li>
        <li>
          <strong>Right-click a square</strong> to pin its arrows so they stay
          while you look around; right-click it again to unpin, or right-click
          another square to move the pin. The pinned square is tinted. (Right-
          drag draws your own arrows.)
        </li>
        <li>
          The <strong>last move</strong> played is highlighted on the squares it
          came from and went to.
        </li>
      </ul>

      <h2>How your moves are judged</h2>
      <p>
        Moves you play are annotated in the move log by comparing the
        evaluation before the move with the evaluation after it - how much the
        position got worse for you, in pawns. Hover an annotation to see how
        much was given up.
      </p>
      <ul>
        <li>
          <strong className="q-best">★</strong> the engine's own top choice, or
          as good as; <strong className="q-inaccuracy">?!</strong> an
          inaccuracy; <strong className="q-mistake">?</strong> a mistake;{" "}
          <strong className="q-blunder">??</strong> a blunder. Ordinary sound
          moves are left unmarked.
        </li>
        <li>
          A move is only judged once both the position before it and the
          position after it have been analyzed, so moves played faster than the
          engine can keep up stay unmarked - step back through them and the
          annotations fill in.
        </li>
        <li>
          Once a game is completely won or lost, further imprecision is not
          flagged - but giving up a forced mate always is.
        </li>
      </ul>

      <h2>Board controls</h2>
      <ul>
        <li>
          <strong>Flip board</strong> shows it from the other side;{" "}
          <strong>Reset board</strong> returns to the starting position.
        </li>
        <li>
          Step through the move history with the <strong>‹ ›</strong> buttons or
          the <strong>← →</strong> arrow keys, and <strong>Copy PGN</strong> to
          export the game.
        </li>
      </ul>

      <h2>How it works</h2>
      <p>
        Everything runs client-side: the board editor, the move history, and
        the analysis engine (<a href="https://stockfishchess.org/" target="_blank" rel="noopener noreferrer">Stockfish</a>,
        compiled to WebAssembly) all execute in your browser. Nothing you
        enter is sent anywhere.
      </p>

      <h2>Built with</h2>
      <p>
        React · Vite · <a href="https://stockfishchess.org/" target="_blank" rel="noopener noreferrer">Stockfish</a> (WASM) · <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener noreferrer">chess.js</a> · <a href="https://github.com/Clariity/react-chessboard" target="_blank" rel="noopener noreferrer">react-chessboard</a>
      </p>

      <h2>License</h2>
      <p>
        Stockfish is GPL-3, so this project is source-available under the
        same terms.
      </p>

      {backHref ? (
        <a className="action-btn" href={backHref}>
          ← Back to the board
        </a>
      ) : (
        <button type="button" className="action-btn" onClick={onClose}>
          ← Back to the board
        </button>
      )}
    </div>
  );
}
