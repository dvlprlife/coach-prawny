// "Analyze game": score every unscored position in the move log in one go, so a
// pasted game can be graded without stepping through it move by move.
//
// Runs on the same engine as the live analysis, at the same depth and MultiPV,
// so a move gets the same mark either way (see multipv-changes-grading in App).
// Every search is a BACKGROUND one: it never interrupts the live board search,
// and the live search pre-empts it - the sweep just asks again afterwards. So
// stepping through the game mid-sweep stays responsive and never shows a
// cut-short result.

import { useCallback, useEffect, useRef, useState } from "react";
import { analyze } from "./analyzeEngine";
import { SearchPreempted } from "./stockfishWorker";
import { isScored } from "./recordEval";
import { config } from "../config/config";
import type { AnalysisResult, MoveLogEntry } from "../config/types";

interface UseGameSweepOptions {
  workerUrl: string;
  // The live move log. Read through a ref after every await, so each search
  // is checked against the log as it is NOW, not as it was when the sweep began.
  entries: MoveLogEntry[];
  // Writes one result onto entries[index]. The caller runs it through
  // recordEval, whose fen check is the last line of defence against a result
  // landing on a log that has changed underneath it.
  onRecord: (index: number, result: AnalysisResult) => void;
}

export interface GameSweep {
  running: boolean;
  done: number;
  // Positions this run set out to score - the unscored ones when it started,
  // not every entry in the log.
  total: number;
  error: string | null;
  start: (multiPv: number) => void;
  cancel: () => void;
}

export function useGameSweep({
  workerUrl,
  entries,
  onRecord,
}: UseGameSweepOptions): GameSweep {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  // Bumped by cancel() and by every start(). A run checks it after each await
  // and quits the moment it no longer matches, so a cancelled run can never
  // write. Its in-flight search is left to finish and the result dropped -
  // at most one wasted search, and not worth a way to reach into the engine.
  const generation = useRef(0);

  // Assigned from an effect, as useStockfish does for onResult: both are only
  // read after an await, long after the commit, so the lag doesn't matter.
  const entriesRef = useRef(entries);
  const onRecordRef = useRef(onRecord);
  useEffect(() => {
    entriesRef.current = entries;
    onRecordRef.current = onRecord;
  });

  // Stop reaching for the engine once the component is gone. Ref only - there
  // is no state left to reset. (The ref object is captured so the cleanup bumps
  // the same counter the running loop is comparing against.)
  useEffect(() => {
    const counter = generation;
    return () => {
      counter.current++;
    };
  }, []);

  const cancel = useCallback(() => {
    generation.current++;
    setProgress(null);
    setError(null);
  }, []);

  const start = useCallback(
    async (multiPv: number) => {
      const gen = ++generation.current;
      const live = () => gen === generation.current;
      const depth = config.engine.depth;
      const targets = entriesRef.current.flatMap((entry, index) =>
        isScored(entry) ? [] : [{ index, fen: entry.fen }]
      );
      setError(null);
      if (targets.length === 0) {
        setProgress(null);
        return;
      }
      setProgress({ done: 0, total: targets.length });

      for (let k = 0; k < targets.length; k++) {
        const { index, fen } = targets[k];
        for (;;) {
          // Re-checked before every search, retries included: the log may
          // have changed, and stepping through the game scores positions too.
          const current = entriesRef.current[index];
          if (!current || current.fen !== fen || isScored(current)) break;
          try {
            const res = await analyze(fen, workerUrl, multiPv, depth, {
              background: true,
            });
            if (!live()) return;
            // A checkmate or stalemate has no lines, so nothing to record.
            // A line short of full depth is never recorded either - a
            // background search that finishes ends at `go depth`, so this is
            // a backstop, and stepping to the move still scores it normally.
            const best = res.moves.find((m) => m.rank === 1);
            if (best && best.depth >= depth) onRecordRef.current(index, res);
            break;
          } catch (e) {
            if (!live()) return;
            // The live search needed the engine. Ask again: this queues
            // behind it, so the retry runs once the board is idle.
            if (e instanceof SearchPreempted) continue;
            generation.current++;
            setProgress(null);
            setError(e instanceof Error ? e.message : "Analysis failed.");
            return;
          }
        }
        setProgress({ done: k + 1, total: targets.length });
      }
      if (live()) setProgress(null);
    },
    [workerUrl]
  );

  return {
    running: progress !== null,
    done: progress?.done ?? 0,
    total: progress?.total ?? 0,
    error,
    start: (multiPv) => void start(multiPv),
    cancel,
  };
}
