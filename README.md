# Tropical Island

A first-person walk around a procedurally generated tropical island. It runs in the browser from a single
HTML file: no install, no downloads at runtime, and it works offline.

> Early days: the island is a simple placeholder while the real sky, water, palms and beach are built.

## Play

- **Online:** https://bstummer.github.io/tropical-island/
- **Download:** [tropical-island.html](https://github.com/bstummer/tropical-island/releases/latest/download/tropical-island.html).
  It's one file and always the latest build. Open it in a desktop browser (Chrome, Edge or Firefox).

Click to start, then:

| Input | Action |
|---|---|
| Mouse | Look around |
| W A S D | Move |
| Space / Shift | Up / down |
| Mouse wheel | Change speed |
| Esc | Release the mouse |

URL parameters, such as `?view=overview&time=17.5`, jump to a named viewpoint or time of day.

## Develop

Requires Node 20.19+ or 22.12+.

```sh
npm install      # also downloads the headless Chromium used for screenshots
npm run dev      # dev server with hot reload, including shaders
npm run verify   # tests, build, checks and screenshots: run before every push
```

On a fresh Linux machine, also run `npx playwright install-deps chromium` once (it installs system libraries
with apt, so it needs root or sudo).

The build is `dist/index.html`. Every push to `main` is verified by GitHub Actions, deployed to Pages and
published as the download above. [CLAUDE.md](CLAUDE.md) holds the project rules, architecture and workflow.
