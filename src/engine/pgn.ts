// Loading a game from PGN text: movetext in, move-log entries out.
//
// Lives next to fen.ts and positionLink.ts for the same reason they do - this
// is one more way a position (here, a whole sequence of them) crosses into the
// app, and it is pure, so it can be tested without a browser. App owns the
// resulting history; this module only builds it.
//
// chess.js does the actual parsing. It already tolerates everything the PGN
// export standard allows around the mainline - brace and rest-of-line comments,
// NAGs ($1), suffix annotations (!?), parenthesised variations, and the game
// termination marker - and reports each move with the FEN before and after it,
// which is exactly the shape MoveLogEntry wants. What it does NOT do is the two
// things below, which is what this module is for.

import { Chess } from "chess.js";
import { normalizeFen, validateFen } from "./fen";
import type { Fen, MoveLogEntry } from "../config/types";

export interface PgnGame {
  entries: MoveLogEntry[];
  // The PGN's tag pairs, as chess.js reports them. It supplies the seven-tag
  // roster with "?" placeholders for anything the source omitted, so treat a
  // "?" as absent - see describeGame.
  headers: Record<string, string>;
}

export type PgnParseResult =
  | { ok: true; game: PgnGame }
  | { ok: false; error: string };

// A tag-pair line: [Name "value"]. The quote is what makes this safe to use as
// a line-level marker - Lichess writes clock and eval annotations as bracketed
// tokens inside comments ("{ [%clk 0:03:00] }"), and a wrapped line can start
// with one. Those carry no quoted value, so requiring it keeps them out.
const TAG_LINE = /^\s*\[\s*[A-Za-z][A-Za-z0-9_]*\s+"/;

// The [FEN "..."] tag, wherever it sits in the header block. chess.js honours
// it with or without the [SetUp "1"] that the standard pairs it with, and so
// does this.
const FEN_TAG = /\[\s*FEN\s+"([^"]*)"\s*\]/i;

// One move in standard algebraic notation: a pawn move ("e4", "exd5", "e8=Q"),
// a piece move with any disambiguation ("Nf3", "Nbd2", "Qh4xe1"), or castling.
// Check and mate suffixes are left off - nothing here needs to match to the end
// of the token, only far enough to tell a move from a word.
const SAN = /(?:[O0]-[O0](?:-[O0])?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)/;

// A numbered move: "1. e4", "1.e4", "12... Nc6". Requiring a whole plausible SAN
// token after the dots, rather than just a character that could start one, is
// what keeps a numbered list out: "1. Buy milk" opens exactly like a bishop
// move, and "B" alone cannot tell them apart - "Bu" can.
const NUMBERED_MOVE = new RegExp(`(?:^|\\s)\\d{1,4}\\s*\\.+\\s*${SAN.source}`);

// Is this text a game rather than a position or prose? Used to decide whether a
// paste should be intercepted, so it has to be conservative in one direction
// above all: a FEN must never look like a PGN, or pasting one into the FEN box
// would stop working. A FEN has no tag pairs and no numbered moves - its only
// digits are run lengths and the two move clocks, none of them followed by a
// full stop - so neither branch below can fire on one.
export function looksLikePgn(text: string): boolean {
  if (!text.trim()) return false;
  return TAG_LINE.test(text) || NUMBERED_MOVE.test(text);
}

export function parsePgn(text: string): PgnParseResult {
  const source = firstGame(text);
  if (!source.trim()) return { ok: false, error: "That paste was empty." };

  // The starting position has to be made safe BEFORE chess.js sees it, because
  // every position in the game descends from it. A PGN whose [FEN] tag claims
  // castling rights the placement cannot support - kings home, no rooks - loads
  // through chess.js without complaint and carries those rights into all 40
  // resulting FENs, and Stockfish answers such a position with no `info`, no
  // `bestmove` and no error at all: the search simply never returns. Normalizing
  // the tag in place is what stops a pasted game from wedging the engine.
  // It also pads a partial FEN tag, so one carrying only the placement loads.
  const prepared = withNormalizedSetupFen(source);
  if ("error" in prepared) return { ok: false, error: prepared.error };

  const chess = new Chess();
  try {
    chess.loadPgn(prepared.text);
  } catch (e) {
    return { ok: false, error: readableError(e) };
  }

  const history = chess.history({ verbose: true });

  // No moves and no explicit starting position is not a game - it's a header
  // block, or prose that happened to trip looksLikePgn. Loading it would reset
  // the board to the starting position, silently throwing away whatever the
  // user had in front of them, so refuse instead. A FEN tag with no moves IS
  // meaningful, though: it's a position, and loading it is the right answer.
  if (history.length === 0 && !FEN_TAG.test(prepared.text)) {
    return { ok: false, error: "No moves found in that PGN." };
  }

  // `before` on the first move is the position the game started from, which is
  // the FEN tag when there is one and the standard start otherwise. With no
  // moves at all there is nothing to read it off, and the loaded position is
  // itself the start.
  const start: Fen = history[0]?.before ?? chess.fen();
  const entries: MoveLogEntry[] = [{ fen: start }];
  for (const move of history) {
    entries.push({
      fen: move.after,
      san: move.san,
      from: move.from,
      to: move.to,
    });
  }

  return { ok: true, game: { entries, headers: chess.getHeaders() } };
}

// A one-line summary of what was loaded, for the confirmation the UI shows.
// chess.js fills the seven-tag roster with "?" placeholders for tags the source
// didn't carry, so those count as missing rather than as a player named "?".
export function describeGame(game: PgnGame): string {
  const moves = game.entries.length - 1;
  const count =
    moves === 0 ? "position only" : moves === 1 ? "1 move" : `${moves} moves`;
  const white = namedPlayer(game.headers.White);
  const black = namedPlayer(game.headers.Black);
  if (white && black) return `${white} vs ${black} - ${count}`;
  return count;
}

function namedPlayer(value: string | undefined): string | null {
  const name = value?.trim();
  return !name || name === "?" ? null : name;
}

// Everything up to the start of a second game. A PGN file can hold any number
// of games back to back, and chess.js rejects the lot outright ("Expected end
// of input but '[' found") rather than reading the first - so a paste straight
// out of a downloaded database would fail for a reason the user can do nothing
// about. All of a game's tag pairs precede its movetext, so the first tag-pair
// line that appears AFTER the movetext has begun can only be the next game.
function firstGame(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  // The leading header block: tag pairs and the blank lines among them.
  let i = 0;
  while (i < lines.length && (TAG_LINE.test(lines[i]) || !lines[i].trim())) i++;

  // Movetext runs from there to the next tag-pair line, if any.
  let end = i;
  while (end < lines.length && !TAG_LINE.test(lines[end])) end++;

  return lines.slice(0, end).join("\n");
}

// Replaces the [FEN] tag with its normalized form, or reports why it can't be
// used. Text without the tag passes through untouched.
function withNormalizedSetupFen(
  text: string
): { text: string } | { error: string } {
  const match = text.match(FEN_TAG);
  if (!match) return { text };

  const normalized = normalizeFen(match[1]);
  const check = validateFen(normalized);
  if (!check.valid) {
    return {
      error: `That PGN's starting position isn't valid: ${check.error ?? "invalid FEN"}`,
    };
  }
  // Function replacement, so a "$" anywhere in the FEN can't be read as a
  // capture reference. (No FEN contains one, but the tag's contents are
  // whatever was pasted.)
  return { text: text.replace(FEN_TAG, () => `[FEN "${normalized}"]`) };
}

// chess.js's parse errors enumerate every token the grammar would have accepted
// at that point ("Expected NAG, brace comment, end of input, game termination
// marker, move number, ..."), which tells a user nothing. What it FOUND is the
// useful half, and it's the half that points at the typo.
function readableError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  const found = raw.match(/but (.+?) found/);
  if (found) return `Couldn't read that PGN - unexpected ${found[1]}.`;

  // Thrown by chess.js when the position itself is rejected. Ours is normalized
  // and validated before it gets here, so this is a FEN it dislikes for a reason
  // validateFen shares - worth passing through, since it names the field.
  if (/invalid fen/i.test(raw)) {
    return `That PGN's starting position isn't valid: ${raw.replace(/^invalid fen:?\s*/i, "")}`;
  }

  // An illegal move reads as a plain sentence naming the move, which is already
  // the most useful thing we could say.
  return `Couldn't read that PGN - ${raw}`;
}
