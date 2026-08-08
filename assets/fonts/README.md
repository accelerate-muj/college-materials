# Fonts

Self-hosted rather than loaded from a CDN. Three reasons: the site has no external dependency to
break or be compromised, it leaks no visitor data to a third party, and it still renders correctly
when opened over `file://` — which is how contributors check their own changes.

Each file is the **latin subset only**, as served by Google Fonts, which is why they are small.

| File | Family | Weights | Used for | Licence |
|---|---|---|---|---|
| `anton-latin.woff2` | [Anton](https://fonts.google.com/specimen/Anton) | 400 | Display headings, card titles, the wordmark | [SIL OFL 1.1](https://openfontlicense.org/) |
| `space-grotesk-latin.woff2` | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | 400–700 (variable) | Body copy and UI | [SIL OFL 1.1](https://openfontlicense.org/) |
| `jetbrains-mono-latin.woff2` | [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | 400–700 (variable) | Terminal motifs, navigation, metadata, subject codes | [SIL OFL 1.1](https://openfontlicense.org/) |

All three are SIL Open Font License 1.1, which permits redistribution as part of this repository.
The OFL is a font licence and is independent of the repository's own CC BY-SA 4.0 licence — the
fonts stay under the OFL.

## Replacing or updating one

```bash
# Grab the latin subset URL for a family, then download it.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=Anton&display=swap"
```

Take the `src: url(...)` from the block commented `/* latin */`, download it here, and keep the
`unicode-range` in `style.css` in step with the one in that block. The `-A` user agent matters:
without it Google serves TTF instead of WOFF2.
