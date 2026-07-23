// React hook wrapping the engine seam. Handles the Vite worker URL, debounces
// rapid board edits so overlapping searches don't pile up, and exposes analysis
// state to the UI.
//
// Because it calls analyze() (the seam) rather than the worker directly, the
// hook is unchanged whether the engine runs client- or server-side.

import { useCallback, useEffect, useRef, useState } from "react";
import { analyze } from "./analyzeEngine";
import type { AnalysisResult, Fen } from "../config/types";

// Vite resolves the Stockfish worker script to a URL at build time.
// The `stockfish` npm package ships the worker at this path; adjust if the
// installed version differs (check node_modules/stockfish/src).
// Example: import stockfishUrl from "stockfish/src/stockfish.js?url";
// We accept it as a param so this file has no bundler-specific import.

interface UseStockfishOptions {
  workerUrl: string;
  debounceMs?: number;
}

interface UseStockfishState {
  result: AnalysisResult | null;
  analyzing: boolean;
  error: string | null;
  analyze: (fen: Fen, multiPv?: number) => void;
}

export function useStockfish({
  workerUrl,
  debounceMs = 300,
}: UseStockfishOptions): UseStockfishState {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identifies the most recent request so a response can be ignored if a
  // newer one has since been made - whether the fen changed, just multiPv
  // changed, or both. A fen-only check would miss the multiPv-only case.
  const requestId = useRef(0);

  const run = useCallback(
    (fen: Fen, multiPv?: number) => {
      const id = ++requestId.current;
      setAnalyzing(true);
      setError(null);

      analyze(fen, workerUrl, multiPv)
        .then((res) => {
          // Ignore stale results if a newer request has since been made.
          if (id === requestId.current) {
            setResult(res);
            setAnalyzing(false);
          }
        })
        .catch((e: unknown) => {
          if (id === requestId.current) {
            setError(e instanceof Error ? e.message : "Analysis failed.");
            setAnalyzing(false);
          }
        });
    },
    [workerUrl]
  );

  const analyzeDebounced = useCallback(
    (fen: Fen, multiPv?: number) => {
      // Drop a result computed for a DIFFERENT position immediately, ahead of the
      // debounce - not inside run(). Waiting would leave the previous position's
      // moves on screen for another 300ms after the board already changed, and
      // those moves are frequently not even legal on the new board. Showing
      // "Analyzing…" for that beat is the honest answer.
      //
      // A multiPv-only change keeps the result, so tweaking "Show N" refines in
      // place instead of flashing empty.
      setResult((prev) => (prev && prev.fen !== fen ? null : prev));
      setAnalyzing(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => run(fen, multiPv), debounceMs);
    },
    [run, debounceMs]
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { result, analyzing, error, analyze: analyzeDebounced };
}
