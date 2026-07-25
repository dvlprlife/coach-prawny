// A single static info panel, swapped in for the board+moves panels by a
// button in the header. Not worth a router for one page.

interface AboutProps {
  onClose: () => void;
}

export function About({ onClose }: AboutProps) {
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

      <button type="button" className="action-btn" onClick={onClose}>
        ← Back to the board
      </button>
    </div>
  );
}
