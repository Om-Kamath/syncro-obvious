# Contributing to Syncro

Thanks for helping build Syncro, a narration-first video editor in the browser.
This guide covers local setup, the commands you'll run before opening a PR, and
the conventions that keep review fast.

## Getting started

**Prerequisites:** Node.js 20 (the version CI runs).

```bash
git clone https://github.com/Om-Kamath/syncro-obvious.git
cd syncro-obvious
npm install
npm run dev
```

The dev server starts on `http://localhost:3000`.

On first launch, click the key icon in the header and paste your Gemini API
key. The key is stored in your browser's local storage
(`syncro_gemini_api_key`) — it never leaves your machine and no `.env` file is
needed.

## Scripts

These are defined in `package.json`; CI runs lint, test, and build on every PR.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Run Vitest unit tests |
| `npm run test:e2e` | Run the Playwright e2e smoke suite (starts the dev server itself) |
| `npm run lint` | Type-check (`tsc --noEmit`) + ESLint |
| `npm run clean` | Remove `dist/` |

## Before you open a PR

Run these locally; CI runs the same three gates:

```bash
npm run lint   # tsc --noEmit + eslint
npm test       # Vitest unit tests
npm run build  # must compile
```

If your change touches rendered UI, add or update a test: unit tests
(`*.test.ts` / `*.test.tsx`, colocated in `src/`) for logic and components, or
a Playwright spec in `tests/e2e/` for end-to-end behavior.

## How tests are organized

- **Unit tests (Vitest, `npm test`):** colocated next to the code they cover
  (for example `src/utils/chainClips.test.ts`, `src/services/gemini.test.ts`).
  Default environment is `node`; add `@vitest-environment jsdom` per file for
  DOM-dependent tests.
- **E2E (Playwright, `npm run test:e2e`):** `tests/e2e/app.spec.ts`. Playwright
  starts the Vite dev server on port 3000 automatically.

## Commit and PR conventions

- **Conventional commits** — `feat:`, `fix:`, `chore:`, `refactor:`, `test:`,
  `docs:`, `a11y:`, `perf:`, `ci:`. The type drives the changelog and PR titles.
- **One concern per PR.** Keep PRs independently mergeable to `main`; PRs are
  squash-merged.
- **PR template.** `.github/PULL_REQUEST_TEMPLATE.md` opens automatically when
  you create a PR — fill it in. Include what changed and why, how you verified
  it, and evidence (screenshots/recordings) for any visual change.
- **CI must be green** before merge. The workflow runs `npm run lint`,
  `npm test`, and `npm run build` on every PR.

## Repo hygiene

Do not commit `node_modules/`, `dist/`, or lockfiles other than
`package-lock.json` (for example, no `bun.lock`).

## Reporting bugs and proposing features

Open a GitHub issue with: what you did, what you expected, what happened, and
your browser/OS. For features, include the workflow you're trying to support —
Syncro's roadmap is driven by creator workflows, not abstract capabilities.
