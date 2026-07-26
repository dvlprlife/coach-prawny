// Sharing a position as a link: FEN <-> query string.
//
// Lives next to fen.ts because it is FEN (de)serialization - the same contract
// crossing one more boundary. Everything here is pure, so it can be tested
// without a browser; App owns the actual history and location calls.
//
// A FEN arriving from a URL is UNTRUSTED input - anyone can hand-edit a link -
// so reading one goes through the same normalize/validate path as pasting into
// the FEN box. That matters beyond tidiness: a position whose castling field
// the placement cannot support makes Stockfish refuse the search with no error
// at all (see normalizeFen), so an unchecked ?fen= would be a way to hang a
// stranger's board with a link.

import { normalizeFen, validateFen } from "./fen";
import type { Fen } from "../config/types";

export const FEN_PARAM = "fen";

// FEN fields are space-separated, and a FEN never contains an underscore, so
// swapping the two keeps a shared link readable instead of littering it with
// %20. Slashes are left as they are: RFC 3986 allows them unescaped inside a
// query string, and encoding them would make the link far uglier for no gain.
// That leaves only letters, digits, "/", "-" and "_" - all safe unencoded.
export function encodeFen(fen: Fen): string {
  return fen.trim().replace(/\s+/g, "_");
}

export function decodeFen(raw: string): Fen {
  return raw.replace(/_/g, " ").trim();
}

// Pull a shareable position out of a query string. Returns null when there is
// no fen parameter, or when what is there is not a position we can safely load
// - the caller falls back to the starting position rather than showing an
// error, because a broken link should still land you on a usable board.
export function fenFromSearch(search: string): Fen | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(FEN_PARAM);
  } catch {
    return null;
  }
  if (!raw) return null;

  // URLSearchParams has already turned "+" and %20 into spaces; decodeFen
  // covers the underscore form this module writes.
  const candidate = normalizeFen(decodeFen(raw));
  return validateFen(candidate).valid ? candidate : null;
}

// The query string for a position, including the leading "?". Kept separate
// from the origin so App can hand it straight to history.replaceState, which
// wants a same-origin relative URL.
export function searchForFen(fen: Fen): string {
  return `?${FEN_PARAM}=${encodeFen(fen)}`;
}

// The full link to hand someone. `origin` and `pathname` come from
// window.location at the call site.
export function shareUrl(fen: Fen, origin: string, pathname: string): string {
  return `${origin}${pathname}${searchForFen(fen)}`;
}
