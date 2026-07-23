// The universal contracts. FEN is the string that ties every stage together.
// Recognition emits FEN; the engine consumes FEN; the board renders FEN.
// As long as every stage speaks these types, any stage can move server-side freely.

export type Fen = string;

// A single analysis line from the engine.
export interface EngineMove {
  rank: number; // 1 = best, 2 = second best, 3 = third best (matches MultiPV)
  move: string; // the move in UCI (e.g. "e2e4"); convert to SAN for display with chess.js
  san?: string; // human-readable move (e.g. "e4", "Nf3") - filled in by the hook
  // Both scores are normalized to WHITE's perspective by analyzeEngine (UCI
  // reports them from the side-to-move's), so + favours White and - favours
  // Black no matter who is on move.
  evalCp: number | null; // evaluation in centipawns
  mateIn: number | null; // if forced mate, moves until mate (negative = Black mates); otherwise null
  pv: string[]; // principal variation - the full line of best play (UCI moves)
  depth: number; // depth this line was searched to
}

export interface AnalysisResult {
  fen: Fen;
  moves: EngineMove[]; // up to config.engine.multiPv entries, ranked
}

// The recognition seam's contract. image in, FEN out.
// Client impl (stub for now) and future server impl share this signature.
export interface RecognitionResult {
  fen: Fen;
  confidence?: number; // 0-1, optional; server models may report it
}

// One step in the played-move history. The root entry (index 0) has no
// `san`/`from`/`to` - it's the position the log started from, not a move.
export interface MoveLogEntry {
  fen: Fen;
  san?: string;
  from?: string;
  to?: string;
}
