// Tests for position sharing. The important cases are the hostile ones: a FEN
// out of a URL is attacker-editable, and normalizeFen's castling prune is the
// only thing standing between a hand-edited link and a Stockfish search that
// never returns.

import { describe, it, expect } from "vitest";
import {
  FEN_PARAM,
  encodeFen,
  decodeFen,
  fenFromSearch,
  searchForFen,
  shareUrl,
} from "./positionLink";
import { STARTING_FEN, getCastlingRights } from "./fen";

describe("encodeFen / decodeFen", () => {
  it("swaps spaces for underscores and back", () => {
    const encoded = encodeFen(STARTING_FEN);
    expect(encoded).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1"
    );
    expect(decodeFen(encoded)).toBe(STARTING_FEN);
  });

  it("leaves slashes unescaped so the link stays readable", () => {
    expect(encodeFen(STARTING_FEN)).toContain("/");
    expect(encodeFen(STARTING_FEN)).not.toContain("%2F");
  });

  it("produces only characters that are safe unencoded in a query string", () => {
    expect(encodeFen(STARTING_FEN)).toMatch(/^[A-Za-z0-9/_-]+$/);
  });

  it("round-trips a position with an en-passant square", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2";
    expect(decodeFen(encodeFen(fen))).toBe(fen);
  });
});

describe("searchForFen / shareUrl", () => {
  it("builds a query string with the fen parameter", () => {
    expect(searchForFen(STARTING_FEN)).toBe(
      `?${FEN_PARAM}=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1`
    );
  });

  it("builds a full shareable url", () => {
    expect(shareUrl(STARTING_FEN, "https://coachprawny.com", "/")).toBe(
      "https://coachprawny.com/?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1"
    );
  });

  it("survives a round trip through fenFromSearch", () => {
    expect(fenFromSearch(searchForFen(STARTING_FEN))).toBe(STARTING_FEN);
  });
});

describe("fenFromSearch", () => {
  it("returns null when there is no query string at all", () => {
    expect(fenFromSearch("")).toBeNull();
    expect(fenFromSearch("?")).toBeNull();
  });

  it("returns null when some other parameter is present", () => {
    expect(fenFromSearch("?utm_source=chat")).toBeNull();
  });

  it("returns null for an empty fen parameter", () => {
    expect(fenFromSearch("?fen=")).toBeNull();
  });

  it("accepts the underscore form this module writes", () => {
    expect(fenFromSearch("?fen=" + encodeFen(STARTING_FEN))).toBe(STARTING_FEN);
  });

  it("accepts percent-encoded spaces from a hand-written link", () => {
    const encoded = STARTING_FEN.replace(/ /g, "%20");
    expect(fenFromSearch(`?fen=${encoded}`)).toBe(STARTING_FEN);
  });

  it("accepts plus-encoded spaces, which is what a form would produce", () => {
    const encoded = STARTING_FEN.replace(/ /g, "+");
    expect(fenFromSearch(`?fen=${encoded}`)).toBe(STARTING_FEN);
  });

  it("works with a leading ? or without one", () => {
    const bare = "fen=" + encodeFen(STARTING_FEN);
    expect(fenFromSearch(bare)).toBe(STARTING_FEN);
  });

  it("pads a placement-only fen through normalizeFen", () => {
    const placement = STARTING_FEN.split(" ")[0];
    expect(fenFromSearch(`?fen=${placement}`)).toBe(`${placement} w - - 0 1`);
  });

  it("ignores unrelated parameters sitting alongside the fen", () => {
    expect(fenFromSearch(`?utm_source=x&fen=${encodeFen(STARTING_FEN)}&a=b`)).toBe(
      STARTING_FEN
    );
  });

  // The hostile cases. A link is hand-editable, so none of these may reach the
  // engine.
  it("rejects a malformed fen rather than loading it", () => {
    expect(fenFromSearch("?fen=not_a_position")).toBeNull();
    expect(fenFromSearch("?fen=" + encodeFen("8/8/8/8/8/8/8/8 w - - 0 1"))).toBeNull();
  });

  it("rejects a fen whose castling field is malformed", () => {
    // normalizeFen deliberately leaves a non-standard castling field alone so
    // validateFen can reject it - this is that path, reached from a url.
    expect(fenFromSearch("?fen=" + encodeFen("4k3/8/8/8/8/8/8/4K3 w KQkg - 0 1"))).toBeNull();
  });

  it("prunes castling rights the placement cannot support", () => {
    // The Stockfish wedge, arriving by link: kings home, no rooks anywhere,
    // but the link claims KQkq. It must load with those rights stripped.
    const loaded = fenFromSearch(
      "?fen=" + encodeFen("4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1")
    );
    expect(loaded).toBe("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(getCastlingRights(loaded!)).toEqual({
      K: false,
      Q: false,
      k: false,
      q: false,
    });
  });

  it("does not choke on junk that is not a query string", () => {
    expect(fenFromSearch("????")).toBeNull();
    expect(fenFromSearch("%%%")).toBeNull();
  });
});
