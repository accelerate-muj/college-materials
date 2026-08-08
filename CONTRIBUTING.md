# Contributing

Most contributions here are a single JSON entry pointing at a question paper. You do not need to
know JavaScript, and you do not need to install anything.

This file covers the mechanics specific to this repository. The club-wide rules — review, commit
style, accessibility, licensing, the Code of Conduct — are in
[accelerate-muj/.github/CONTRIBUTING.md](https://github.com/accelerate-muj/.github/blob/main/CONTRIBUTING.md)
and apply here too.

## Adding a paper

### 1. Find the right file

```
data/pyq/<year>/<branch>.json
```

- **First year** is common to every branch: `data/pyq/first-year/common.json`
- **Second, third and fourth year** split by branch: `data/pyq/second-year/cse.json`,
  `data/pyq/third-year/ece.json`, and so on

The branch ids are the `id` values in [`data/pyq/catalogue.json`](data/pyq/catalogue.json). **If the
file doesn't exist yet, create it** — most branches start empty. A new file's contents are just
`[]` plus your entry.

### 2. Add your entry

```json
{
  "id": "cse-2024-mte-cs2001",
  "subject": "Data Structures and Algorithms",
  "code": "CS2001",
  "semester": 3,
  "exam": "MTE",
  "year": 2024,
  "url": "https://example.org/papers/cs2001-mte-2024.pdf",
  "pages": 2,
  "contributor": "@your-handle"
}
```

`id`, `subject`, `exam` and `year` are required, plus either `url` or `file`. Everything else is
optional but useful — `code` in particular, because it's what groups every paper for a subject
together on the site. The full field reference is in
[`data/pyq/README.md`](data/pyq/README.md).

### 3. Regenerate and check

```bash
node build.js                            # updates pyq/data.js — commit this too
node .github/scripts/validate-data.js    # the same check CI runs
```

Then open `pyq/index.html` in a browser and confirm your paper appears where you expect.

**Committing `pyq/data.js` matters.** It's generated from `data/pyq/`, and CI fails if the two are
out of sync — a stale bake means the live site serves the old archive without any visible error.

**No Node installed?** Open a pull request with just the JSON change and say so in the description;
a maintainer will run the build. Or use Docker, which runs the same command CI runs on the same
Node version:

```bash
# From the repo root.
docker run --rm -v "$(pwd):/app" -w /app node:20-slim node build.js

# PowerShell:
docker run --rm -v "${PWD}:/app" -w /app node:20-slim node build.js
```

The `-v` mount is the part that matters: without it the container can't see your files.

### Link, or commit the PDF?

**Prefer a link.** If the paper is already hosted somewhere stable, use `url` — it keeps the
repository small and the takedown surface smaller.

Commit the PDF only when there's no stable link. Put it under `papers/<year>/<branch>/` and
reference it with `file` instead of `url`. CI checks that the file actually exists, so a `file`
entry can never render as a dead link.

Do not commit a paper you don't have the right to redistribute. See
[the licensing note in the README](README.md#licensing-and-the-papers-themselves) — question papers
belong to the University, and this archive exists on the understanding that it stays a study
resource and honours takedown requests.

## Adding or renaming a section

Sections (branches) live in one place:
[`data/pyq/catalogue.json`](data/pyq/catalogue.json). Add an entry to `branches`:

```json
{ "id": "cse-cloud", "short": "CSE (Cloud)", "name": "Computer Science & Engineering (Cloud Computing)", "group": "computing" }
```

Then `node build.js` and commit. The site, the validator and the build all read that one list, so
there is nothing else to change — no new HTML page, no route to register.

Renaming a branch id renames its data file too. Move
`data/pyq/second-year/<old>.json` to `<new>.json` in the same commit, or CI will flag the old file
as a collection the catalogue no longer defines.

## Working on the site

There is no build step for the pages themselves, no bundler, and no dependencies. Clone it and open
`index.html`.

```bash
git clone https://github.com/accelerate-muj/college-materials.git
cd college-materials
# then just open index.html
```

### Running the tests

Either open `tests/index.html` in a browser, or:

```bash
node tests/run.js
```

There is no `npm install`, because there is no `package.json`. That's deliberate — see
[ARCHITECTURE.md](ARCHITECTURE.md).

### Where to put logic

Anything that decides *what a valid paper is*, or *how papers sort and group*, belongs in
[`src/pyq.js`](src/pyq.js) as a pure function with a test. Four separate callers depend on those
rules, and the whole point of the file is that they cannot disagree.

Anything that touches the DOM belongs in `pyq/app.js`. Keep it building nodes with
`createElement`/`textContent` — paper titles and contributor handles come from contributed JSON,
and string-concatenating them into `innerHTML` is how that becomes an XSS hole.

### Changing how it looks

Read [DESIGN.md](DESIGN.md) first. The palette, the three type voices and the four motifs are a
system, not preferences — the point is that other club repos can copy `style.css` and look like the
same organisation. In particular:

- **Use the tokens.** No component hard-codes a colour.
- **Crimson is a spotlight, not a fill.** One accent per view.
- **Don't add a Google Fonts link.** Fonts are self-hosted and embedded for a reason; if you need a
  new face, add the `.woff2` to `assets/fonts/`, register it in `build-fonts.js`, and run it.

### Accessibility

Article III.2 of the club's Constitution makes accessibility a review criterion, not an
afterthought. For any change to the site, check the
[WCAG 2.1 list in the org contributing guide](https://github.com/accelerate-muj/.github/blob/main/CONTRIBUTING.md#accessibility--wcag-21-checklist-article-iii2).
The things this site gets wrong most easily:

- **Colour contrast.** The palette in `style.css` clears AA in both light and dark. If you change a
  colour, re-check it — the comments record which pairs were verified.
- **Focus.** Hash navigation moves focus to `<main>` deliberately; without it a keyboard user is
  left on the old link and a screen reader never announces the new screen. Don't remove it.
- **Link names.** "MTE 2024" is meaningless in a screen reader's link list, which is why paper links
  carry a fuller `aria-label`. Keep that up to date if you change what a link shows.

## Pull requests

Branch off `main`, keep the PR to one logical change, and fill out the template. The org guide
covers the rest, including the merge strategy (squash for solo-authored, merge commit for
co-authored, never rebase).
