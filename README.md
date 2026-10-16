# bb-plugin-expand-thinking

Keeps reasoning rows ("Thought" / "Thinking…") expanded in BB thread timelines,
so provider thinking is always visible without clicking.

## How it works

BB has no setting for this and stores reasoning expansion in an in-memory React
map, so a frontend content script (`app.tsx`) clicks each collapsed reasoning
header as it mounts. BB then remembers the row as open on its own. Collapse a
row by hand and it stays collapsed.

## Self-check after BB updates

The script depends on BB's internal timeline DOM (selectors at the top of
`app.tsx`). On every load it checks:

- `toggle-noop` — clicking a thinking header no longer expands it
- `header-missing` — thinking rows render with an unrecognised structure
- `timeline-missing` — thinking labels are visible but no timeline row wrapper matches
- `script-error` — the script threw

On failure, a banner offers **Copy fix prompt**: a ready-made agent prompt with
the failed check, the details, and the BB frontend build fingerprint. Dismissing
it hides it until the BB build or the failing check changes.

## Develop

```
npm install
npx tsc -p .
bb plugin build
bb plugin reload expand-thinking
```

## License

MIT — see [LICENSE](LICENSE).
