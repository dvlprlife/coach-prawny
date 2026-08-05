// Tests for loading a game from PGN.
//
// Two groups matter more than the rest. looksLikePgn decides whether a paste is
// intercepted at all, so the FEN cases guard a feature that already works from
// being broken by this one. And the [FEN] tag is untrusted input arriving from
// someone else's clipboard, so it goes through the same normalize/validate path
// as a pasted FEN or a shared link - a PGN that wedges Stockfish would be the
// same bug positionLink.test.ts covers, reached by a different door.

import { describe, it, expect } from "vitest";
import { looksLikePgn, parsePgn, describeGame, type PgnGame } from "./pgn";
import { STARTING_FEN, getCastlingRights } from "./fen";

// Unwraps a result that is expected to parse, failing with the error message
// rather than a bare "undefined" when it doesn't.
function parsed(text: string): PgnGame {
  const result = parsePgn(text);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`);
  return result.game;
}

function errorFrom(text: string): string {
  const result = parsePgn(text);
  if (result.ok) throw new Error("expected a parse failure, got a game");
  return result.error;
}

const SICILIAN = '[Event "Test"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 c5 2. Nf3 1-0';

describe("looksLikePgn", () => {
  it("accepts bare movetext", () => {
    expect(looksLikePgn("1. e4 e5 2. Nf3 Nc6")).toBe(true);
    expect(looksLikePgn("1.e4 e5")).toBe(true);
  });

  it("accepts a game that starts mid-move-pair", () => {
    expect(looksLikePgn("12... Nc6 13. Bb5")).toBe(true);
  });

  it("accepts a tag-pair header", () => {
    expect(looksLikePgn('[Event "Casual game"]\n\n*')).toBe(true);
  });

  it("accepts castling as the first move token", () => {
    expect(looksLikePgn("15. O-O Rd8")).toBe(true);
    expect(looksLikePgn("15. 0-0 Rd8")).toBe(true);
  });

  // The load-bearing cases: a FEN must never be mistaken for a game, or pasting
  // one would stop reaching the FEN box.
  it("rejects a full FEN", () => {
    expect(looksLikePgn(STARTING_FEN)).toBe(false);
  });

  it("rejects a FEN with an en-passant square and non-zero clocks", () => {
    expect(
      looksLikePgn("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 12 34")
    ).toBe(false);
  });

  it("rejects a bare piece placement", () => {
    expect(looksLikePgn("4k3/8/8/8/8/8/8/4K3")).toBe(false);
  });

  it("rejects empty and whitespace-only text", () => {
    expect(looksLikePgn("")).toBe(false);
    expect(looksLikePgn("   \n\t ")).toBe(false);
  });

  // A numbered list opens exactly like a game, and several English words open
  // exactly like a piece move - "Buy" is indistinguishable from "Bxe4" until the
  // second character. Matching a whole SAN token is what separates them.
  it("rejects prose, including numbered lists that start like piece moves", () => {
    expect(looksLikePgn("hello world")).toBe(false);
    expect(looksLikePgn("1. Buy milk\n2. Walk the dog")).toBe(false);
    expect(looksLikePgn("1. Be careful\n2. Nice work")).toBe(false);
    expect(looksLikePgn("1. Bad idea")).toBe(false);
    expect(looksLikePgn("1. Read the docs\n2. Question everything")).toBe(false);
  });

  it("is not fooled by a lichess clock annotation at the start of a line", () => {
    // These arrive inside comments and can be pushed onto their own line by
    // wrapping; they carry no quoted value, so they are not tag pairs.
    expect(looksLikePgn("[%clk 0:03:00]")).toBe(false);
  });
});

describe("parsePgn - the move log it builds", () => {
  it("puts the starting position in a root entry carrying no move", () => {
    const { entries } = parsed("1. e4 e5");
    expect(entries[0].fen).toBe(STARTING_FEN);
    expect(entries[0].san).toBeUndefined();
    expect(entries[0].from).toBeUndefined();
    expect(entries[0].to).toBeUndefined();
  });

  it("adds one entry per move, in order", () => {
    const { entries } = parsed("1. e4 e5 2. Nf3 Nc6");
    expect(entries).toHaveLength(5);
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("records each move's from/to and the position it produced", () => {
    const { entries } = parsed("1. e4");
    expect(entries[1].from).toBe("e2");
    expect(entries[1].to).toBe("e4");
    expect(entries[1].fen).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    );
  });

  it("leaves every entry unscored - a loaded game has not been analyzed", () => {
    const { entries } = parsed("1. e4 e5 2. Nf3");
    for (const entry of entries) {
      expect(entry.evalCp).toBeUndefined();
      expect(entry.mateIn).toBeUndefined();
      expect(entry.bestUci).toBeUndefined();
    }
  });

  it("chains: each entry's fen is the position after its own move", () => {
    const { entries } = parsed("1. d4 d5 2. c4 e6");
    expect(entries[2].fen).toContain(" w ");
    expect(entries[4].fen).toContain(" w ");
    expect(entries[1].fen).toContain(" b ");
  });

  it("keeps the headers", () => {
    const { headers } = parsed(SICILIAN);
    expect(headers.White).toBe("Alice");
    expect(headers.Black).toBe("Bob");
    expect(headers.Event).toBe("Test");
  });
});

describe("parsePgn - what it tolerates", () => {
  it("ignores the game termination marker", () => {
    expect(parsed("1. e4 e5 1-0").entries).toHaveLength(3);
    expect(parsed("1. e4 e5 1/2-1/2").entries).toHaveLength(3);
    expect(parsed("1. e4 e5 *").entries).toHaveLength(3);
  });

  it("ignores brace comments", () => {
    const { entries } = parsed("1. e4 {best by test} e5 2. Nf3 {develops}");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("ignores rest-of-line comments", () => {
    const { entries } = parsed("1. e4 e5 ; and the rest of this line\n2. Nf3");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("ignores NAGs and suffix annotations", () => {
    const { entries } = parsed("1. e4! $1 e5?! $14 2. Nf3!? Nc6??");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("keeps the mainline and drops variations", () => {
    const { entries } = parsed("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("drops nested variations too", () => {
    const { entries } = parsed("1. e4 e5 (1... c5 (1... e6 2. d4) 2. Nf3) 2. Nf3");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("is not confused by parentheses inside a comment", () => {
    const { entries } = parsed("1. e4 {a (tricky) note} e5");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5"]);
  });

  it("reads a lichess export, clock comments and all", () => {
    const { entries, headers } = parsed(
      '[Event "Rated blitz game"]\n' +
        '[Site "https://lichess.org/abcd1234"]\n' +
        '[White "alice"]\n' +
        '[Black "bob"]\n' +
        '[Result "1-0"]\n\n' +
        "1. e4 { [%clk 0:03:00] } 1... c5 { [%clk 0:03:00] } 2. Nf3 { [%clk 0:02:58] } 1-0"
    );
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "c5", "Nf3"]);
    expect(headers.White).toBe("alice");
  });

  it("handles CRLF line endings", () => {
    const { entries } = parsed('[Event "X"]\r\n\r\n1. e4 e5\r\n2. Nf3\r\n');
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("handles leading and trailing whitespace", () => {
    expect(parsed("   \n\n 1. e4 e5 \n\n  ").entries).toHaveLength(3);
  });

  it("takes the first game when several are pasted together", () => {
    const { entries, headers } = parsed(
      '[Event "First"]\n[White "Alice"]\n\n1. e4 e5 1-0\n\n' +
        '[Event "Second"]\n[White "Carol"]\n\n1. d4 d5 0-1'
    );
    expect(headers.Event).toBe("First");
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "e5"]);
  });
});

describe("parsePgn - games that don't start from the initial position", () => {
  const MIDGAME = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";

  it("respects a FEN/SetUp tag pair", () => {
    const { entries } = parsed(`[SetUp "1"]\n[FEN "${MIDGAME}"]\n\n1. e4 Kd7`);
    expect(entries[0].fen).toBe(MIDGAME);
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "Kd7"]);
  });

  it("respects a FEN tag with no SetUp tag beside it", () => {
    const { entries } = parsed(`[FEN "${MIDGAME}"]\n\n1. e4`);
    expect(entries[0].fen).toBe(MIDGAME);
  });

  it("loads a game that starts on Black's move", () => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const { entries } = parsed(`[FEN "${afterE4}"]\n[SetUp "1"]\n\n1... c5 2. Nf3`);
    expect(entries[0].fen).toBe(afterE4);
    expect(entries.slice(1).map((e) => e.san)).toEqual(["c5", "Nf3"]);
  });

  // chess.js writes the en-passant field the way Stockfish and lichess do: it
  // names the square only when a pawn can actually capture there, and drops it
  // otherwise. So the root entry is not always byte-identical to the FEN tag
  // that produced it. This is the same normalization the FEN box already
  // applies, so a loaded game and a pasted position agree.
  it("keeps an en-passant square that a pawn can actually capture on", () => {
    const capturable = "rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3";
    const { entries } = parsed(`[FEN "${capturable}"]\n[SetUp "1"]\n\n1... dxe3`);
    expect(entries[0].fen).toBe(capturable);
    expect(entries[1].san).toBe("dxe3");
  });

  it("drops an en-passant square no pawn can capture on", () => {
    const idle = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const { entries } = parsed(`[FEN "${idle}"]\n[SetUp "1"]\n\n1... e5`);
    expect(entries[0].fen.split(" ")[3]).toBe("-");
  });

  it("loads a FEN tag with no moves as a position", () => {
    const { entries } = parsed(`[SetUp "1"]\n[FEN "${MIDGAME}"]\n\n*`);
    expect(entries).toHaveLength(1);
    expect(entries[0].fen).toBe(MIDGAME);
  });

  it("pads a FEN tag carrying only the piece placement", () => {
    const { entries } = parsed('[FEN "4k3/8/8/8/8/8/4P3/4K3"]\n\n1. e4');
    expect(entries[0].fen).toBe(MIDGAME);
  });

  // The Stockfish wedge, arriving by PGN. A position claiming castling rights
  // its placement cannot support makes Stockfish refuse the search outright -
  // no info lines, no bestmove, no error - and every position in the game would
  // inherit the bad field from the tag. See normalizeFen.
  it("prunes castling rights the starting placement cannot support", () => {
    const { entries } = parsed(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1"]\n\n1. Ke2 Ke7'
    );
    expect(entries[0].fen).toBe("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(getCastlingRights(entries[0].fen)).toEqual({
      K: false,
      Q: false,
      k: false,
      q: false,
    });
  });

  it("keeps the pruning through every position in the game", () => {
    const { entries } = parsed(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1"]\n\n1. Ke2 Ke7 2. Kd3'
    );
    for (const entry of entries) {
      expect(getCastlingRights(entry.fen)).toEqual({
        K: false,
        Q: false,
        k: false,
        q: false,
      });
    }
  });
});

describe("parsePgn - failures", () => {
  it("refuses an empty paste", () => {
    expect(errorFrom("")).toMatch(/empty/i);
    expect(errorFrom("   \n  ")).toMatch(/empty/i);
  });

  it("refuses a header block with no moves, rather than resetting the board", () => {
    expect(errorFrom('[Event "Casual game"]\n[White "Alice"]\n\n*')).toMatch(
      /no moves/i
    );
  });

  it("reports an illegal move rather than loading a partial game", () => {
    const error = errorFrom("1. e4 e5 2. Qh9");
    expect(error).toMatch(/pgn/i);
    expect(error.length).toBeLessThan(120);
  });

  it("reports a move that isn't legal in the position", () => {
    expect(errorFrom("1. e4 e5 2. Nf6")).toMatch(/./);
  });

  it("reports a truncated game", () => {
    expect(errorFrom("1. e4 e5 2. N")).toMatch(/pgn/i);
  });

  it("rejects an invalid FEN tag", () => {
    expect(errorFrom('[FEN "total garbage"]\n\n1. e4')).toMatch(
      /starting position isn't valid/i
    );
  });

  it("rejects a FEN tag whose castling field is malformed", () => {
    // normalizeFen deliberately leaves a non-standard castling field alone so
    // validateFen can reject it - this is that path, reached from a PGN.
    expect(errorFrom('[FEN "4k3/8/8/8/8/8/8/4K3 w KQkg - 0 1"]\n\n1. Ke2')).toMatch(
      /starting position isn't valid/i
    );
  });

  it("never surfaces chess.js's list of expected tokens", () => {
    // The raw parser error enumerates the whole grammar at the failure point,
    // which is what readableError exists to replace.
    expect(errorFrom("1. e4 e5 2. N")).not.toMatch(/brace comment/i);
    expect(errorFrom("hello world")).not.toMatch(/rest of line comment/i);
  });
});

describe("parsePgn - round trip with the app's own Copy PGN", () => {
  // MoveLog's buildPgn writes bare movetext from the standard start, and adds a
  // FEN/SetUp tag pair otherwise. Both forms have to load back in, or the app
  // could export a game it cannot read.
  it("reads back movetext from the starting position", () => {
    const { entries } = parsed("1. e4 e5 2. Nf3 Nc6 3. Bb5");
    expect(entries.slice(1).map((e) => e.san)).toEqual([
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Bb5",
    ]);
  });

  it("reads back a game that started from a set-up position", () => {
    const start = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
    const { entries } = parsed(`[FEN "${start}"]\n[SetUp "1"]\n\n1. e4 Kd7 2. e5`);
    expect(entries[0].fen).toBe(start);
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e4", "Kd7", "e5"]);
  });

  it("reads back a log that started on Black's move, written as '1... e5'", () => {
    const start = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const { entries } = parsed(`[FEN "${start}"]\n[SetUp "1"]\n\n1... e5 2. Nf3`);
    expect(entries.slice(1).map((e) => e.san)).toEqual(["e5", "Nf3"]);
  });
});

describe("describeGame", () => {
  it("names both players when the PGN carries them", () => {
    expect(describeGame(parsed(SICILIAN))).toBe("Alice vs Bob - 3 moves");
  });

  it("falls back to the move count when the players are unknown", () => {
    // chess.js supplies "?" for absent roster tags; that is not a player name.
    expect(describeGame(parsed("1. e4 e5"))).toBe("2 moves");
  });

  it("falls back when only one player is named", () => {
    expect(describeGame(parsed('[White "Alice"]\n\n1. e4 e5'))).toBe("2 moves");
  });

  it("counts a single move in the singular", () => {
    expect(describeGame(parsed("1. e4"))).toBe("1 move");
  });

  it("describes a position with no moves", () => {
    expect(describeGame(parsed('[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n*'))).toBe(
      "position only"
    );
  });
});
