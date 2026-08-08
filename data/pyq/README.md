# `data/pyq` — the archive's source of truth

Everything the PYQ site shows is generated from this directory. Nothing else needs editing to add
a paper or a section.

## Layout

```
data/pyq/
  catalogue.json              which years exist, and which branches each is split into
  TEMPLATE.json               a copy-paste example of a paper record
  first-year/common.json      first year is common to every branch
  second-year/<branch>.json   one file per branch — cse.json, it.json, ece.json, …
  third-year/<branch>.json
  fourth-year/<branch>.json
```

A collection file that does not exist yet is not an error — most branches start empty and gain a
file the first time somebody contributes to them. Create the file with a single-entry array.

The branch ids are the `id` fields in [`catalogue.json`](catalogue.json). A file named after
anything else fails CI, because a paper filed under a misspelled branch is invisible on the site
rather than merely misplaced.

## A paper record

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
  "contributor": "@octocat",
  "notes": "Section A only; section B was not collected."
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique across the whole archive. Lowercase, hyphen-separated. `<branch>-<year>-<exam>-<code>` is the convention. |
| `subject` | yes | The subject's full name, as printed on the paper. Max 120 characters. |
| `exam` | yes | One of the `examTypes` in `catalogue.json`: `MTE`, `ETE`, `Quiz`, `Makeup`. |
| `year` | yes | The calendar year the exam was sat, as a number. |
| `code` | no | Subject code, e.g. `CS2001`. Supplying it is what groups papers for the same subject together on the site. |
| `semester` | no | Must be one of the semesters the year covers (3 or 4 for second year, and so on). |
| `url` | no\* | An `https://` link to the paper. |
| `file` | no\* | A `.pdf` committed under `papers/`, as a repo-relative path. |
| `pages` | no | Page count, if you know it. |
| `contributor` | no | Your GitHub handle, e.g. `@octocat`. |
| `notes` | no | Anything a reader should know before opening it. Max 280 characters. |

\* Every record needs **either** `url` **or** `file`. Any field not in this table is rejected
rather than ignored, so a typo surfaces in CI instead of silently disappearing.

### Link, or commit the PDF?

Prefer `url` when the paper is already hosted somewhere stable. Use `file` when it is not — commit
the PDF under `papers/<year>/<branch>/` and point at it. Committed PDFs are checked for existence
by CI, so a `file` entry can never render as a dead link.

## After editing

```bash
node build.js                            # regenerates pyq/data.js
node .github/scripts/validate-data.js    # the same check CI runs
node tests/run.js                        # the rules themselves
```

`pyq/data.js` is generated and must be committed alongside your data change — CI fails if the two
are out of sync, because a stale bake means the site quietly serves yesterday's archive.

## Adding a section

Add an entry to `branches` in [`catalogue.json`](catalogue.json), run `node build.js`, and commit.
The site, the validator and the build all read that one list, so there is nothing else to update.
