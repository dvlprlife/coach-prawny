// The engine's search scheduling, driven through a scripted fake Worker. This
// is the only automated coverage the foreground/background priority gets: the
// real engine is WASM in a browser worker, which vitest can't run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPreempted, StockfishEngine } from "./stockfishWorker";

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Records every command the engine sends and lets the test play the engine's
// side of the conversation. The engine listens through BOTH onmessage (uciok)
// and addEventListener (per-search lines), so emit() feeds both.
class FakeWorker {
  static last: FakeWorker;
  sent: string[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private listeners = new Set<(e: MessageEvent) => void>();

  constructor() {
    FakeWorker.last = this;
  }
  postMessage(cmd: string) {
    this.sent.push(cmd);
  }
  addEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.delete(fn);
  }
  terminate() {}

  emit(line: string) {
    const e = { data: line } as MessageEvent;
    this.onmessage?.(e);
    // Snapshot first, as a real EventTarget does: `bestmove` starts the next
    // search, whose listener is added mid-dispatch and must not receive the
    // `bestmove` that ended the previous one.
    for (const fn of Array.from(this.listeners)) fn(e);
  }
  // One complete search reply: a rank-1 line at `depth`, then bestmove.
  finish(depth = 18, move = "e2e4") {
    this.emit(`info depth ${depth} multipv 1 score cp 20 pv ${move}`);
    this.emit(`bestmove ${move}`);
  }
  count(prefix: string) {
    return this.sent.filter((c) => c.startsWith(prefix)).length;
  }
}

// Settles promise continuations without advancing the (fake) clock.
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// Tracks a promise's outcome so a test can assert it is still pending.
function track<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error })
  );
  return state;
}

let engine: StockfishEngine;
let worker: FakeWorker;

beforeEach(async () => {
  // Both of the engine's timers (15s ready, 10s silence) are long enough to fire
  // mid-suite on real time; fake timers keep them from ever doing so.
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  engine = new StockfishEngine("fake.js");
  worker = FakeWorker.last;
  worker.emit("uciok");
  await engine.init();
});

afterEach(() => {
  engine.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("StockfishEngine scheduling", () => {
  it("queues a background search behind the running one without stopping it", async () => {
    const live = track(engine.analyze(FEN, 1, 18));
    const bg = track(engine.analyze(FEN, 1, 18, { background: true }));
    await flush();
    expect(worker.count("stop")).toBe(0);
    expect(worker.count("go")).toBe(1);

    worker.finish();
    await flush();
    expect(live.value).toHaveLength(1);
    // Only now does the background search reach the worker.
    expect(worker.count("go")).toBe(2);
    expect(bg.settled).toBe(false);

    worker.finish();
    await flush();
    expect(bg.value).toHaveLength(1);
  });

  it("drops a queued background search when a foreground one arrives", async () => {
    const first = track(engine.analyze(FEN, 1, 18));
    const bg = track(engine.analyze(FEN, 1, 18, { background: true }));
    const second = track(engine.analyze(FEN, 1, 18));
    await flush();

    expect(bg.error).toBeInstanceOf(SearchPreempted);
    // The running foreground search is stopped, exactly as before.
    expect(worker.count("stop")).toBe(1);

    worker.finish(7);
    await flush();
    expect(first.value?.[0].depth).toBe(7);
    // The second foreground search runs next - the background one never did.
    expect(worker.count("go")).toBe(2);
    worker.finish();
    await flush();
    expect(second.value?.[0].depth).toBe(18);
    expect(worker.count("go")).toBe(2);
  });

  it("stops a running background search, which rejects instead of resolving partial lines", async () => {
    const bg = track(engine.analyze(FEN, 1, 18, { background: true }));
    await flush();
    expect(worker.count("go")).toBe(1);

    const live = track(engine.analyze(FEN, 1, 18));
    await flush();
    expect(worker.count("stop")).toBe(1);

    // The stopped search reports what it had so far - which must NOT reach
    // the background caller as if it were a finished result.
    worker.finish(9);
    await flush();
    expect(bg.error).toBeInstanceOf(SearchPreempted);
    expect(bg.value).toBeUndefined();

    expect(worker.count("go")).toBe(2);
    worker.finish();
    await flush();
    expect(live.value?.[0].depth).toBe(18);
  });

  it("still resolves a foreground search stopped by another with its partial lines", async () => {
    const first = track(engine.analyze(FEN, 1, 18));
    engine.analyze(FEN, 1, 18);
    await flush();
    worker.finish(5);
    await flush();
    expect(first.error).toBeUndefined();
    expect(first.value?.[0].depth).toBe(5);
  });

  it("fails the running search and every queued one when the engine dies", async () => {
    const running = track(engine.analyze(FEN, 1, 18, { background: true }));
    const queuedBg = track(engine.analyze(FEN, 1, 18, { background: true }));
    await flush();
    worker.onerror?.({ message: "boom" } as ErrorEvent);
    await flush();
    expect(running.error).toBeInstanceOf(Error);
    expect(queuedBg.error).toBeInstanceOf(Error);
    expect(running.error).not.toBeInstanceOf(SearchPreempted);
    expect(engine.dead).toBe(true);
    // And nothing further is sent to the dead worker.
    expect(worker.count("go")).toBe(1);
  });

  it("fails every queued search when a search goes silent", async () => {
    const running = track(engine.analyze(FEN, 1, 18));
    const queued = track(engine.analyze(FEN, 1, 18, { background: true }));
    await flush();
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(running.error).toBeInstanceOf(Error);
    expect(queued.error).toBeInstanceOf(Error);
  });
});
