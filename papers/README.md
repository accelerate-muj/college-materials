# `papers/`

Committed PDFs, for papers that aren't hosted anywhere stable.

**Prefer linking.** If a paper already lives at a durable `https://` URL, reference it with `url` in
the data file instead of committing a copy here. It keeps the repository small and the takedown
surface smaller.

When you do commit one:

```
papers/<year>/<branch>/<subject-code>-<exam>-<year>.pdf
papers/btech/year-2/cse/cs2001-mte-2024.pdf
```

Then reference it from the matching data file with `file` rather than `url`:

```json
{ "id": "cse-2024-mte-cs2001", "…": "…", "file": "papers/btech/year-2/cse/cs2001-mte-2024.pdf" }
```

CI checks that every `file` path is actually committed, so this can't render as a dead link on the
site.

Do not commit a paper you don't have the right to redistribute — see
[the licensing note in the README](../README.md#licensing-and-the-papers-themselves).
