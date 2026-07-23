# Coach Prawny 🦐

![status](https://img.shields.io/badge/status-MVP-e8663f)
![license](https://img.shields.io/badge/license-GPL--3.0-1f4d3a)
![react](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)
![vite](https://img.shields.io/badge/vite-5-646CFF?logo=vite&logoColor=white)
![typescript](https://img.shields.io/badge/typescript-5-3178C6?logo=typescript&logoColor=white)
![stockfish](https://img.shields.io/badge/engine-stockfish_18-1f4d3a)

Chess position → top moves, ranked and evaluated. Client-side, powered by Stockfish.

Drag pieces or paste a FEN and get the engine's top moves for the position,
analyzed entirely in your browser - nothing you enter is sent anywhere. Step
back and forward through the moves you've played, export the game as PGN, or
switch to setup mode to build any position from scratch.

## Features
- Board editor with **play** mode (legal moves only) and **setup** mode (free
  placement, for building or correcting arbitrary positions)
- Stockfish (WASM) analysis: ranked top-N moves with evaluations, re-run as
  the position changes
- Hover a piece to preview its legal moves; hover a suggested move to see it
  as an arrow on the board; the last move played is highlighted too
- Move history with back/forward navigation and PGN export
- Side-to-move and castling-rights toggles, board flip/reset
- Move history navigable with the ← / → arrow keys

## Quick start
```bash
npm install
npm run dev
```

## Architecture
Two swappable seams - `recognition` (image → FEN) and `engine` (FEN → moves) -
keep either stage movable to a backend later via a config flag in
`src/config/config.ts`.

## Stack
React · Vite · TypeScript · Stockfish (WASM) · chess.js · react-chessboard

Stockfish is GPL-3; this project is source-available accordingly.
