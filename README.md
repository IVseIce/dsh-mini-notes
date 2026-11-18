# dsh-mini-notes

English | [中文](README.zh.md)

A tiny notepad for the DSH Web UI. One button in the session header opens a panel you can type into — like Windows Notepad: plain text, no formatting, no menus, saves as you type.

Pure client-side plugin. No dependencies, no build step, no network requests, registers no tools.

<img src="icon.svg" width="64" alt="">

## Install

```bash
dsh plugin --profile web add github:IVseIce/dsh-mini-notes
```

Any pnpm-installable form also works:

```bash
# pin a commit (recommended for reviewing third-party code first)
dsh plugin --profile web add github:IVseIce/dsh-mini-notes#<commit-sha>

# full git URL
dsh plugin --profile web add git+https://github.com/IVseIce/dsh-mini-notes.git

# from a local checkout, for development
dsh plugin --profile web add link:/absolute/path/to/dsh-mini-notes
```

Or install this directory from the **Plugin manager** page in the DSH Web UI.

Restart, or let HMR pick it up, then refresh the page. The notes button appears at the right of the session header, next to the other utilities.

## Usage

### Panel
- **Open / close** — click the notes icon at the right of the session header; click again to hide.
- **Placement** — opens just below the button the first time; afterwards it remembers where you dragged it and how big you resized it.
- **Drag** — hold the empty part of the tab bar.
- **Resize** — drag the small triangle in the bottom-right corner (min 280×220, always kept inside the window).
- **Pin** (pushpin) — a pinned panel stays open when you click elsewhere, handy for typing while reading the conversation. An unpinned panel closes on any outside click, and `Esc` also hides it.

### Pages
- Browser-style tabs across the top; a tab's title is the first line of that page.
- `+` sits **after the last tab** (like Windows Notepad). Tabs shrink evenly as they multiply (down to 46px, titles ellipsized) and only start scrolling when even that is not enough.
- **Drag a tab to reorder it** — drag left or right and release. A plain click still just switches pages.
- The `×` on a tab **closes** the page into the trash — it does not destroy it.

### Zoom
`−` / percentage / `+` in the tools row scales the note text (70%–250%). Click the percentage to return to 100%. Window chrome (tab bar, footer) does not scale. Your zoom level is remembered.

### Trash
The bin icon in the tools row.
- Click a row to **restore** that page; the `×` at the end of a row deletes it permanently (the confirmation appears inside the panel, never a browser dialog); **Empty trash** in the footer clears everything at once.
- Closing every tab does not make the window vanish — it stays on the trash, so a closed page never feels lost.
- Keeps up to 2000 entries, dropping the oldest first.

### Storage
Everything is saved to your browser's `localStorage` (`dsh-mini-notes.v2`) 0.3 s after you stop typing, and again when the panel closes. Refresh or reopen the page and it is all still there. **Your data never leaves your browser** — no account, no sync, no request.

## How it works

- Purely client-side. The Host half (`index.js`) is an empty `apply`.
- One module-level store (a `state` object plus a `Set` of listeners) consumed through `useSyncExternalStore`. Writes are debounced 300 ms and flushed immediately when the panel closes and on `pagehide`.
- Pages, trash, view and zoom live in **one JSON object**, written in a single pass.
- Two slots: `conversation.session.header.utilities` (the button) and `shell.overlay` (the panel). While closed the panel component returns `null`, so it costs no DOM and no rendering; the button subscribes to a single boolean.
- Styling uses theme tokens only (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-elevation-*`), so it follows light and dark themes.

### Known limits

- Plain text only — no images, no rich formatting.

## Files

| File | Purpose |
|---|---|
| `package.json` | Manifest; declares both halves via `dsh.bundle.patch` and `dsh.client` |
| `cordis.patch.yml` | Inserts one Host row (its only job is mounting the package) |
| `index.js` | Host half: empty |
| `client.js` | Browser half: store, button, panel, styles, slot registrations |
| `locale/{zh,en}.json` | Titles and descriptions for the plugin manager |
| `icon.svg` | Plugin icon |
| `.smoke/harness.mjs.cjs` | Offline behaviour check (fake DOM + fake React, not a real browser) |

## Development

No build step — edit `client.js` and reload.

Run the offline check:

```bash
node .smoke/harness.mjs.cjs client.js
```

It stubs a DOM, React and storage, then drives the real client code through opening, typing, Enter handling, tabs, drag-to-reorder, zoom, trash and reload. It is a behavioural check, not a browser.

## License

MIT
