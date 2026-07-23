## Summary

<!-- What changed and why. -->

Closes #N

## Checklist

- [ ] Branch is named `issue-{number}-short-description`
- [ ] The `Closes #N` line above references the issue (keep it on its own line)
- [ ] `npm run build` passes (this is `tsc && vite build` — typecheck *and* bundle)
- [ ] Verified in a real browser, not only type-checked — most of this app's
      regressions are runtime behaviour the compiler cannot see
- [ ] FEN is still the only contract between the recognition and engine seams;
      no second interchange format was introduced
- [ ] Components still call the seam functions rather than touching
      `fetch` / `Worker` directly
- [ ] Any new `<Chessboard>` callback that reads mutable component state reads
      it through `latestRef`, and no `<Chessboard>` prop consumed by the drag
      spec depends on component state (both go stale — see `BoardInput.tsx`)
- [ ] Engine evaluations are still normalized to White's perspective
- [ ] If `public/engine/` changed, `npm run sync-engine` was re-run and the
      .js/.wasm pair is still intact
