// Renders src/components/About.tsx to a standalone dist/about.html.
//
// Why this exists: the app is entirely client-rendered, so the About panel is
// a `showAbout` boolean with no URL - there is no way to link anyone to the
// explanation, and no crawler that skips JS ever sees it. This produces a real
// page at a real URL that works with JavaScript switched off entirely.
//
// Why it renders the COMPONENT rather than a hand-written copy: two copies of
// the same explanation would drift the first time a feature lands. About.tsx
// stays the single source of truth; this script is only a renderer.
//
// Why it runs AFTER `vite build` rather than writing into public/: the page has
// to <link> the bundle's stylesheet, whose filename carries a content hash that
// is not known until the build finishes. So it reads the real filename out of
// the freshly built dist/index.html.
//
// Why it borrows Vite's module loader: About.tsx is TSX, which Node cannot
// import. `ssrLoadModule` applies the project's own Vite config (same React
// plugin, same resolution), so nothing here needs its own transform pipeline.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(projectRoot, "dist");
const indexPath = join(distDir, "index.html");
const outPath = join(distDir, "about.html");

const SITE = "https://coachprawny.com";
// The file has to be about.html - that is what Cloudflare Workers Assets looks
// for - but the URL it SERVES is extensionless: a request for /about.html gets
// a 307 to /about (verified live). So every self-reference below has to name
// /about, or the canonical would point at a URL that immediately redirects and
// every inbound link would cost a pointless hop.
const PAGE_URL = `${SITE}/about`;
const TITLE = "How Coach Prawny works — chess position analysis explained";
const DESCRIPTION =
  "How to set up a position, read the engine's ranked moves and evaluations, " +
  "and understand the best / inaccuracy / mistake / blunder annotations in Coach Prawny.";

if (!existsSync(indexPath)) {
  console.error(
    `build-about: ${indexPath} not found.\n` +
      `This script runs after \`vite build\` because it needs the built ` +
      `stylesheet's hashed filename. Run \`npm run build\`.`
  );
  process.exit(1);
}

// Pull the bundle's stylesheet out of the built shell. If Vite ever stops
// emitting a plain <link rel="stylesheet">, fail loudly rather than shipping an
// unstyled page that still returns 200.
const builtIndex = readFileSync(indexPath, "utf8");
const cssMatch = builtIndex.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/);
if (!cssMatch) {
  console.error(
    "build-about: no stylesheet link found in the built index.html.\n" +
      "Vite's output shape changed; update the regex in scripts/build-about.mjs."
  );
  process.exit(1);
}
const cssHref = cssMatch[1];

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

let body;
try {
  const { About } = await server.ssrLoadModule("/src/components/About.tsx");
  // backHref turns the panel's "close" button into a link home - there is no
  // React on this page to handle a click.
  body = renderToStaticMarkup(createElement(About, { backHref: "/" }));
} finally {
  await server.close();
}

// The shell mirrors the app's own header markup so the page looks like part of
// the site rather than a stray document. The header's About control points back
// to the app, since you are already on the About page.
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <title>${TITLE}</title>
    <meta name="description" content="${DESCRIPTION}" />
    <link rel="canonical" href="${PAGE_URL}" />
    <meta name="theme-color" content="#1f4d3a" />

    <meta property="og:type" content="article" />
    <meta property="og:url" content="${PAGE_URL}" />
    <meta property="og:site_name" content="Coach Prawny" />
    <meta property="og:title" content="${TITLE}" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${TITLE}" />
    <meta name="twitter:description" content="${DESCRIPTION}" />

    <link rel="stylesheet" href="${cssHref}" />
  </head>
  <body>
    <div class="app">
      <header class="app-header">
        <span class="mark">🦐</span>
        <h1>Coach Prawny</h1>
        <span class="tag">your next gambit</span>
        <a class="about-link" href="/">Open the board</a>
      </header>
      ${body}
    </div>
  </body>
</html>
`;

writeFileSync(outPath, html, "utf8");
const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
console.log(`build-about: dist/about.html (${kb} KB, styles from ${cssHref})`);
