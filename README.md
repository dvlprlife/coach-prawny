# Coach Prawny 🦐

![status](https://img.shields.io/badge/status-MVP-e8663f)
![license](https://img.shields.io/badge/license-GPL--3.0-1f4d3a)
![react](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)
![vite](https://img.shields.io/badge/vite-8-646CFF?logo=vite&logoColor=white)
![typescript](https://img.shields.io/badge/typescript-7-3178C6?logo=typescript&logoColor=white)
![stockfish](https://img.shields.io/badge/engine-stockfish_18-1f4d3a)

Chess position → top moves, ranked and evaluated. Client-side, powered by Stockfish.

Drag pieces or paste a FEN and get the engine's top moves for the position,
analyzed entirely in your browser - nothing you enter is sent anywhere. Step
back and forward through the moves you've played, export the game as PGN, or
switch to setup mode to build any position from scratch.

## Features
- Board editor with **play** mode (legal moves only) and **set up** mode (free
  placement, drag a piece off the board to remove it, undo/redo your edits with
  Ctrl+Z / Ctrl+Shift+Z)
- Stockfish (WASM) analysis: ranked top moves with evaluations, re-run as the
  position changes; pick how many (1-5) to list
- Hover a suggested move to preview its arrow, click to pin it, double-click
  (or Enter / Space) to play it on the board
- Hover a piece to preview its legal moves; **pressure** view shows which
  pieces attack a square and which defend it; right-click a square to pin its
  arrows, right-drag to draw your own
- The last move played is highlighted on the squares it came from and went to
- Move history with back/forward navigation (← / → arrow keys) and PGN export
- Side-to-move and castling-rights toggles, board flip/reset

## Quick start
```bash
npm install
npm run dev
```

```bash
npm run lint   # oxlint - react-hooks rules over src/ and scripts/
npm test       # vitest - the pure engine modules
npm run build  # tsc + vite build + the standalone About page
```
Lint, test and build all run in CI on every PR.

## Architecture
Two swappable seams - `recognition` (image → FEN) and `engine` (FEN → moves) -
keep either stage movable to a backend later via a config flag in
`src/config/config.ts`.

## Stack
React · Vite · TypeScript · Stockfish (WASM) · chess.js · react-chessboard

Stockfish is GPL-3; this project is source-available accordingly.
