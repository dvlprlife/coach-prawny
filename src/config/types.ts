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
//
// The eval fields describe THIS entry's position (not the move that reached
// it), recorded from the engine's rank-1 line as each position gets analyzed.
// They are optional because a position is only scored once it has actually
// been analyzed - play a move faster than the search completes and the entry
// stays unscored until you navigate back to it. moveQuality compares two
// adjacent entries' scores to judge the move between them, so an unscored
// entry simply means that move goes unannotated rather than mis-annotated.
export interface MoveLogEntry {
  fen: Fen;
  san?: string;
  from?: string;
  to?: string;
  evalCp?: number | null; // centipawns, WHITE's perspective (see analyzeEngine)
  mateIn?: number | null; // moves to mate, negative = Black mates
  bestUci?: string; // the engine's top move FROM this position, e.g. "e2e4"
}
