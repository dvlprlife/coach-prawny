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
