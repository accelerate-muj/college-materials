# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Commit messages
follow the club's convention (imperative, present tense).

This project is a static site rather than a published package, so it is not versioned with
semantic-release. Entries are grouped by the date they landed on `main`.

## [Unreleased]

Everything below has landed on `main`.

### Added

- **A scanner, so contributing takes a minute and no Git.** `pyq/add/` walks through four steps:
  where the paper goes, what it is, the pages, submit. Pages come from the camera, from photos on
  the device, or from a PDF the contributor already has — all three are equal choices, and camera
  and uploaded photos can be mixed.

  Everything happens in the browser. Frames go to a canvas, the canvas to JPEG (downscaled, with an
  optional greyscale-and-contrast pass), and the JPEGs into a PDF. Nothing is uploaded while the
  contributor works.

- **`src/pdf.js`** — a dependency-free PDF writer. JPEGs embed verbatim via `/DCTDecode`, so there
  is no re-encoding and no quality loss; what the file actually implements is object bookkeeping and
  the xref table. Every alternative was a CDN script or an npm install, and this repository has
  neither by design. Output verified against qpdf.

- **A submission bot.** `submission.yml` reacts to issues labelled `paper-submission`, validates
  them against the same `src/pyq.js` rules CI uses, downloads the attached PDF, commits it with its
  JSON entry and opens a pull request. **It never merges** — a maintainer reviews every paper. A
  rejected submission gets a comment naming the problem, and editing the issue retries automatically.

- **`src/submission.js`** — the issue format as pure functions, shared by the site that writes the
  body and the workflow that reads it back, so the two cannot drift.

- **"Add a paper" throughout the archive** — in the nav, on the year screen, at the foot of every
  collection, and in the empty state.

- **The scanner skips whatever the link already answered.** Every entry point carries what that
  screen knows, and any step the URL fills in is marked done and passed over, so the flow opens on
  the first question that still needs an answer. Each subject card also offers a `+ MTE` / `+ ETE`
  chip for the exam types it is *missing*: those carry year, branch, subject, code, semester and
  exam, which is everything — pressing one opens straight on the camera with no form at all.

  Skipped steps are not hidden. A context bar shows what was decided, with a *change* link on each
  part, because filing someone's paper somewhere they never chose is worse than one extra click.
  Values that do not resolve against the catalogue are dropped and the step is asked normally — it
  is a URL, so none of it is trusted.

- **Repository scaffolding matching the club's conventions.** `README.md`, `CONTRIBUTING.md`,
  `ARCHITECTURE.md`, `CHANGELOG.md`, `LICENSE`, `.editorconfig`, `.gitattributes`, `.gitignore` and
  a CI workflow, following the shape of
  [campus-mapper](https://github.com/accelerate-muj/campus-mapper) and
  [resources](https://github.com/accelerate-muj/resources). Community-health files
  (`CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, issue templates) are deliberately *not*
  duplicated here — GitHub applies the org-wide copies from `accelerate-muj/.github`, and a local
  copy would only drift.

- **A GitHub Pages site**, served from `main` at the repository root with `.nojekyll`, matching how
  `resources` is deployed. A landing page at `index.html` and the archive at `pyq/`.

  Pages had to be enabled, and its source set to "Deploy from a branch" by hand — see
  [Enabling Pages](README.md#enabling-pages). Workflow-based deployment was attempted and abandoned: `actions/deploy-pages` needs `id-token: write`, which this
  organisation does not grant (jobs requesting it fail at dispatch with no logs, reproduced four
  times including after the `github-pages` environment existed), and setting the Pages source over
  the REST API from a workflow returns 403. The README records the full finding so it is not
  rediscovered later.

- **The PYQ archive.** Three screens — year, branch, papers — reached by hash routing so the site
  works both on Pages and by double-clicking the file. First year is a single common collection;
  second, third and fourth year each split into 14 branches (CSE, its four specialisations, IT,
  CCE, ECE, EE, ME, CE, Mechatronics, Biotechnology, Chemical), taken from the programmes offered
  by MUJ's Faculty of Science, Technology and Architecture.

- **`data/pyq/catalogue.json` as the single definition of the archive's shape.** Adding or renaming
  a section is a JSON edit; the site, the build and the validator all derive from it, so no branch
  can exist in the navigation but not the validator.

- **`src/pyq.js`** — the paper rules as pure functions, shared by the build script, the CI
  validator, the tests and the site, so the four cannot drift apart.

- **The club's design system, implemented and documented.** Black (`#0a0a0a`), crimson
  (`#ee3b44`), white; Anton for display, Space Grotesk for reading, JetBrains Mono wherever the
  interface quotes a machine; and four motifs carried over from the club's poster work — the shell
  prompt, the trajectory rule, the rocket-trail slash, and a CSS starfield.
  [DESIGN.md](DESIGN.md) documents the tokens and the rules so other club repos can match.

  The three faces are self-hosted and embedded as data URIs by `build-fonts.js`. Linking the
  `.woff2` files directly was tried first and fails under `file://` — font fetches are always made
  in CORS mode and a `file://` page has a null origin, so the type silently fell back to system
  faces exactly where contributors check their own work.

- **A dependency-free test suite** (`node tests/run.js`, or `tests/index.html` in a browser) using
  the same harness as campus-mapper. 72 tests over validation, sorting, grouping, path
  resolution, PDF structure and the submission format.

- **CI**: the test suite, a validator over every committed paper record, checks that the generated
  `pyq/data.js` and `assets/fonts/fonts.css` are in sync with their sources, and a link check that
  every local `href`/`src` in the HTML resolves.

### Fixed

- `.wrap`'s `padding` shorthand was resetting the vertical padding on `<main>` — a class outranks a
  bare type selector regardless of order — so page content sat flush against the sticky header. The
  rule is now `main.wrap`.

### Security

- **The submission bot treats the issue body as hostile**, because anyone with a GitHub account can
  write one and the workflow holds a write token. campus-mapper shipped three holes in the
  equivalent script, so: nothing from the issue is interpolated into a shell command (values travel
  through `env:`, outputs through `$GITHUB_OUTPUT` with a random delimiter); the write path is
  derived from validated catalogue ids and a sanitised id, never from submitted text, and is
  asserted to resolve inside `papers/`; a submission that sets its own `file` or `url` is rejected;
  the download URL must be on GitHub's own attachment hosts, or the token would be pointed at an
  arbitrary server; and the response must begin `%PDF-` and fit under 10 MB. Each of these has a
  test.

- Paper `url` values must be `https://`; `javascript:` and `data:` URLs are rejected by the
  validator, with tests. `file` values are constrained to `.pdf` paths under `papers/`, so a
  contributed record cannot point the site at a workflow file or escape the directory with `..`.
- The site renders contributed strings with `createElement`/`textContent`, never `innerHTML`.
- CI runs with `permissions: contents: read`, and its actions are pinned to full commit SHAs — the
  organisation enables `sha_pinning_required`, which rejects movable tags like `@v4` before a run
  starts.

### Notes

- The archive ships empty. Every collection renders a "no papers here yet" state naming the exact
  file to add, rather than being seeded with invented entries.
