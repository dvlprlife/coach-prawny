// Low-level Stockfish WASM wrapper. Talks the UCI protocol over the Web Worker's
// postMessage channel and parses `info ... multipv N ... pv <moves>` lines into
// structured EngineMove objects.
//
// This is the client-side engine implementation. It stays in the browser even
// if recognition later moves server-side. If you ever move the ENGINE server-side
// too, you'd write an alternate analyze() in analyzeEngine.ts that fetch()es
// instead - this file wouldn't need to exist there.

import type { EngineMove } from "../config/types";

type ReadyResolver = () => void;
type Rejecter = (error: Error) => void;

// A healthy engine answers "uci" with "uciok" in milliseconds; this only has to
// be long enough to cover compiling the ~7MB .wasm on a slow phone. It exists to
// catch the case where the worker script loads but the engine never speaks (e.g.
// the .wasm 404s or is served with the wrong MIME type), which fires no error
// event and would otherwise hang forever.
const READY_TIMEOUT_MS = 15_000;

// A working search chatters: Stockfish streams `info` lines the whole time it is
// thinking. So silence, not elapsed time, is what says it has given up - a slow
// machine grinding on a hard position still talks, while an engine that has
// quietly refused the position says nothing at all. (It does that for some
// malformed-but-chess.js-legal FENs; normalizeFen scrubs the known trigger, but
// this backstop is what guarantees a bad position can't hang the app, since a
// search that never resolves would block every search queued behind it.)
const SEARCH_SILENCE_TIMEOUT_MS = 10_000;

// How a background search ends when a foreground one needs the engine: queued,
// it is dropped before it ever runs; running, it is stopped and REJECTS rather
// than resolving with the partial lines a stopped search returns. The caller
// (the whole-game sweep) retries it later - it must never mistake a cut-short
// search for a complete one.
export class SearchPreempted extends Error {
  constructor() {
    super("Background search pre-empted by a foreground search.");
    this.name = "SearchPreempted";
  }
}

export interface AnalyzeOptions {
  // Runs only when nothing else wants the engine: it never stops the running
  // search, and any foreground request pre-empts it (see SearchPreempted).
  background?: boolean;
}

interface Job {
  fen: string;
  multiPv: number;
  depth: number;
  background: boolean;
  // Set on a RUNNING background job when a foreground request stops it, so its
  // `bestmove` rejects instead of resolving.
  preempted: boolean;
  resolve: (moves: EngineMove[]) => void;
  reject: Rejecter;
}

export class StockfishEngine {
  private worker: Worker;
  private ready: Promise<void>;
  private resolveReady!: ReadyResolver;
  private rejectReady!: Rejecter;
  private readyTimer: ReturnType<typeof setTimeout>;
  // Set once the engine is known dead. Every later call fails fast with it
  // rather than waiting on a reply that will never come.
  private failure: Error | null = null;
  // Rejecters for searches currently waiting on a `bestmove`, so a worker that
  // dies mid-search fails them instead of leaving the UI spinning.
  private pendingRejects: Rejecter[] = [];
  // Stockfish runs one search at a time over a single UCI session, so a
  // `bestmove` reply can't be attributed to a specific caller if two searches
  // overlap. Jobs wait in `queue` and the next one starts only once the running
  // one's `bestmove` has arrived. A foreground request stops the running search
  // so it wraps up with whatever it has instead of running to full depth first.
  //
  // An explicit list rather than a promise chain because background jobs need
  // to be reached while they are still waiting: stop() only touches the search
  // that is running, so a chained background search would hold up the live
  // one for a full search.
  private queue: Job[] = [];
  private running: Job | null = null;

  constructor(workerUrl: string) {
    // The stockfish WASM build ships a worker script. In Vite you can import the
    // URL: `import stockfishUrl from "stockfish/src/stockfish.js?url"` and pass it.
    this.worker = new Worker(workerUrl);
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Nothing awaits `ready` until init(), so absorb the rejection here to keep
    // it from surfacing as an unhandled rejection. init() still sees it: catch()
    // returns a new promise and leaves this one rejected for its own awaiters.
    this.ready.catch(() => {});
    this.worker.onmessage = (e) => this.onEngineLine(String(e.data));
    // A worker whose script can't load or that throws at runtime fires `error`
    // and then goes silent. Without this the `ready` promise and every queued
    // search would hang, and the UI would sit on "Analyzing…" forever.
    this.worker.onerror = (e) => {
      const detail = typeof e.message === "string" && e.message ? ` (${e.message})` : "";
      this.fail(new Error(`Chess engine failed to load${detail}.`));
    };
    this.readyTimer = setTimeout(
      () => this.fail(new Error("Chess engine didn't start. Try reloading the page.")),
      READY_TIMEOUT_MS
    );
    this.send("uci");
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private onEngineLine(line: string) {
    if (line === "uciok") {
      clearTimeout(this.readyTimer);
      this.resolveReady();
    }
    // Analysis lines are handled per-search in runSearch() via a temporary listener.
  }

  // Mark the engine permanently dead and fail everything waiting on it. Only the
  // first failure counts - later error events are just noise from the same corpse.
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    clearTimeout(this.readyTimer);
    this.running = null;
    this.rejectReady(error);
    // The running search is reached through pendingRejects; queued jobs never
    // registered there, so they are failed directly.
    for (const reject of this.pendingRejects.splice(0)) reject(error);
    for (const job of this.queue.splice(0)) job.reject(error);
  }

  // Once dead, always dead - the caller should throw this engine away and build
  // a fresh worker rather than keep sending it positions.
  get dead(): boolean {
    return this.failure !== null;
  }

  async init(): Promise<void> {
    await this.ready;
    this.send("isready");
  }

  // Run a MultiPV analysis. Returns ranked moves once the search reaches the
  // target depth. Promise-shaped on purpose so a server swap is a drop-in.
  // Queued behind any in-flight search - see the `queue` field above.
  analyze(
    fen: string,
    multiPv: number,
    depth: number,
    { background = false }: AnalyzeOptions = {}
  ): Promise<EngineMove[]> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      if (!background) {
        // Drop every waiting background job before it reaches the worker, so the
        // live search never queues behind one.
        this.queue = this.queue.filter((job) => {
          if (!job.background) return true;
          job.reject(new SearchPreempted());
          return false;
        });
        if (this.running) {
          if (this.running.background) this.running.preempted = true;
          this.stop();
        }
      }
      this.queue.push({ fen, multiPv, depth, background, preempted: false, resolve, reject });
      this.startNext();
    });
  }

  // Starts the next queued job if the engine is idle. Called when a job is
  // queued and again from each `bestmove`, which is the only point at which the
  // worker has finished with the previous search.
  private startNext() {
    if (this.running || this.failure) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = job;
    this.runSearch(job).then(job.resolve, job.reject);
  }

  private runSearch(job: Job): Promise<EngineMove[]> {
    const { fen, multiPv, depth } = job;
    return new Promise((resolve, reject) => {
      const lines = new Map<number, EngineMove>();
      let silence: ReturnType<typeof setTimeout>;

      // Restarted on every line the engine sends, so the timer measures how long
      // it has been quiet rather than how long the search has run.
      const heardFromEngine = () => {
        clearTimeout(silence);
        silence = setTimeout(() => {
          // A silent engine is not one we can keep using: it ignored this
          // position and it will ignore the next one too. Kill it so the
          // caller can start a fresh worker.
          this.fail(new Error("The chess engine stopped responding to this position."));
        }, SEARCH_SILENCE_TIMEOUT_MS);
      };

      const handler = (e: MessageEvent) => {
        heardFromEngine();
        const text = String(e.data);

        if (text.startsWith("info") && text.includes("multipv")) {
          const parsed = parseInfoLine(text);
          if (parsed) lines.set(parsed.rank, parsed);
        }

        // `bestmove` signals the search is done (either it reached the
        // requested depth, or it was cut short by stop()).
        if (text.startsWith("bestmove")) {
          cleanup();
          this.running = null;
          const ranked = [...lines.values()].sort((a, b) => a.rank - b.rank);
          // A pre-empted search whose `bestmove` crossed our `stop` in flight
          // may already have finished at full depth. That result is complete,
          // so keep it rather than make the sweep search the position again.
          if (job.preempted && (ranked[0]?.depth ?? 0) < depth) {
            reject(new SearchPreempted());
          } else {
            resolve(ranked.slice(0, multiPv));
          }
          this.startNext();
        }
      };

      // Registered so fail() can reject this search if the engine dies - or goes
      // silent - before it ever reports `bestmove`.
      const onFailure: Rejecter = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(silence);
        this.worker.removeEventListener("message", handler);
        const i = this.pendingRejects.indexOf(onFailure);
        if (i !== -1) this.pendingRejects.splice(i, 1);
      };

      this.worker.addEventListener("message", handler);
      this.pendingRejects.push(onFailure);

      this.send("ucinewgame");
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      heardFromEngine();
    });
  }

  // Cancel an in-flight search (e.g. user edited the board mid-analysis).
  stop() {
    this.send("stop");
  }

  dispose() {
    clearTimeout(this.readyTimer);
    this.worker.terminate();
  }
}

// Parse one UCI `info` line into an EngineMove.
// Example:
//   info depth 18 seldepth 24 multipv 1 score cp 34 ... pv e2e4 e7e5 g1f3
function parseInfoLine(line: string): EngineMove | null {
  const tokens = line.split(/\s+/);

  const rank = intAfter(tokens, "multipv");
  const depth = intAfter(tokens, "depth");
  if (rank == null || depth == null) return null;

  let evalCp: number | null = null;
  let mateIn: number | null = null;

  const scoreIdx = tokens.indexOf("score");
  if (scoreIdx !== -1) {
    const kind = tokens[scoreIdx + 1]; // "cp" or "mate"
    const value = parseInt(tokens[scoreIdx + 2], 10);
    if (kind === "cp") evalCp = value;
    else if (kind === "mate") mateIn = value;
  }

  const pvIdx = tokens.indexOf("pv");
  const pv = pvIdx !== -1 ? tokens.slice(pvIdx + 1) : [];
  const move = pv[0];
  if (!move) return null;

  return { rank, move, evalCp, mateIn, pv, depth, san: undefined };
}

function intAfter(tokens: string[], key: string): number | null {
  const i = tokens.indexOf(key);
  if (i === -1) return null;
  const n = parseInt(tokens[i + 1], 10);
  return Number.isNaN(n) ? null : n;
}
