# Architecture

This document explains *why* the archive is shaped the way it is. For what the files are, see the
[README](README.md). For how to work on it, see [CONTRIBUTING.md](CONTRIBUTING.md).

## A note on scope

This is a static site of a few hundred lines that renders a directory of JSON. It is worth saying
plainly what it is **not**, because architecture documents attract vocabulary that doesn't fit:
there is no framework, no state management, no API layer, no database. There are papers, branches
and years — three concepts, one of which is a list of fourteen strings.

What follows is the small number of decisions that actually shape it.

## The one constraint everything follows from

**You must be able to double-click `index.html` and have it work.**

This is inherited from [campus-mapper](https://github.com/accelerate-muj/campus-mapper) and it is
not incidental. The audience is students at one university, most of whom have never used npm and
are making their first pull request. A contributor who has to install Node, run `npm install` and
start a dev server before they can see whether their paper shows up is a contributor who doesn't
finish.

Almost everything below is downstream of it.

| Consequence | Why |
|---|---|
| No bundler, no `package.json` | Every file loads as a plain `<script>`, so `file://` keeps working |
| Data is baked into `pyq/data.js` | `fetch()` on a local JSON file is blocked by CORS under `file://`. A `<script>` is not. |
| Hash routing, not paths | `#/second-year/cse` resolves with no server and no rewrite rules |
| UMD-ish module wrapper in `src/pyq.js` | The same file has to work under `require()` in Node and as a `<script>` in a browser |

The cost is a generated file (`pyq/data.js`) that must be committed and can go stale. CI checks it
against `data/pyq/`, because a stale bake is otherwise invisible: the site renders perfectly and
serves yesterday's archive.

## Why the rules live in one file

`src/pyq.js` has four consumers that share nothing else:

```
                   ┌─────────────────────────┐
                   │      src/pyq.js         │
                   │  validatePaper, sort,   │
                   │  groupBySubject, paths  │
                   └────────────┬────────────┘
        ┌───────────────┬───────┴───────┬──────────────────┐
        │               │               │                  │
   build.js      validate-data.js   pyq/app.js      tests/pyq.test.js
   (bakes)       (the CI gate)      (the site)      (Node + browser)
```

The alternative is each of them knowing what a valid paper looks like. They would diverge, and the
copy that guards contributed input is the one that must not — a record the validator accepts but
the site can't render is a broken page in production, and a record the site renders but the
validator rejects is a contributor stuck on a red CI run they can't reproduce.

Keeping it pure — no DOM, no `fs`, no globals — is what lets the test suite run in Node at all.

## Why validation rejects unknown fields

`validatePaper` errors on a field it doesn't recognise rather than dropping it. Silently ignoring
`{"uploadedBy": "me"}` means a contributor who typed `uploadedBy` instead of `contributor` gets a
green CI run and a paper with no attribution, and never finds out. The strict version costs one
confusing error message the first time; the lenient version costs data nobody notices is missing.

The same reasoning drives returning *every* problem at once instead of throwing on the first: a
contributor fixing one error per CI round is a contributor who gives up on round three.

## Why the catalogue is data, not code

Years, branches and exam types live in `data/pyq/catalogue.json`, not in the JavaScript. Adding a
section is then a JSON edit that a non-programmer can make and review, and it stays a JSON edit
whether the club adds one branch or replaces the whole list when the University restructures its
programmes.

It also means the branch list has exactly one definition. `expectedCollections()` derives the set of
valid data files from it, the validator rejects anything outside that set, the build bakes exactly
that set, and the site renders it. A branch cannot exist in the navigation but not the validator.

### The first-year special case

First year is common across every branch at MUJ, so its papers live in one `common.json` rather than
fourteen identical copies. Rather than special-case it in the view, the catalogue carries
`"branched": false` and the routing skips the branch-picking screen for any year with that flag.
If the University ever splits first year by branch, that's a one-word change.

## Security posture

Contributed JSON is untrusted input rendered into a public page, which gives it two edges worth
naming:

- **Injection.** `pyq/app.js` builds nodes with `createElement` and `textContent`, never
  `innerHTML`. A paper titled `<img src=x onerror=...>` renders as that literal text.
- **Link targets.** `url` must be `https://` — `javascript:` and `data:` URLs are rejected by the
  validator, and there's a test for it. `file` must be a `.pdf` under `papers/`, so a record can't
  point the site at `.github/workflows/ci.yml` or escape via `..`.

CI runs read-only (`permissions: contents: read`) and actions are pinned to full commit SHAs — the
organisation enables `sha_pinning_required`, so a `@v4` reference is rejected before the run starts.

## What isn't here yet

- **No contribution bot.** campus-mapper turns an issue into a PR automatically. That's worth
  copying once the archive has enough traffic to justify it, but a bot that parses untrusted issue
  bodies into file writes is exactly where that repo found its
  [security bugs](https://github.com/accelerate-muj/campus-mapper/blob/main/CHANGELOG.md), so it
  should be built deliberately rather than early.
- **No search.** Fourteen branches × four years is navigable by clicking. Once a branch holds
  fifty papers, a filter on the papers screen will earn its place.
- **No pagination.** Same reasoning.
