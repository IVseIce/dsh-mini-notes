# dsh-mini-notes

English | [中文](README.zh.md)

A tiny notepad for the DSH Web UI. One button in the session header opens a panel you can type into — like Windows Notepad: no formatting, no menus, saves as you type.

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
`−` / percentage / `+` in the tools row scales the page content — text and images together (70%–250%). Click the percentage to return to 100%. Window chrome (tab bar, footer) does not scale. Your zoom level is remembered.

### Images
- Two ways in: **drag a file onto the panel**, or **paste** into the text. The image is inserted at the caret and shown at its natural aspect ratio — default width is `min(panel width − 48, 1600px)`, capped at 520px, so text inside screenshots stays readable.
- **Drag an image's left or right edge to resize** it (60px up to panel width − 40). Stored pixels never change, so enlarging stays sharp, and the caret never jumps.
- **Click an image to select it** (blue outline), then press `Backspace` or `Delete` to remove it. Click elsewhere or press `Esc` to deselect.
- Images are compressed on the way in: longest edge 1600px, WebP quality 0.82 — a typical screenshot lands around 100–300 KB.
- `localStorage` gives roughly 5 MB, so expect 15–25 images. When it is full the footer shows a red "image too large to save" message — nothing is dropped silently.
- Images belong to their page: closing a page into the trash carries them along, restoring brings them back, and bytes are only released when you delete the page permanently or empty the trash.

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
- **Image bytes are not in that object.** A page only records `{ id, w, h, dw }`; the bytes live under `dsh-mini-notes.img.<id>`. Typing therefore rewrites a few hundred bytes, never megabytes. Data URLs are additionally cached in memory, so rendering never touches storage.
- **The body is a `contenteditable` document editor, but storage is plain text.** Each image is exactly one placeholder character (`\uFFFC`), and the `images` array describes them in document order. Nothing HTML-ish, no base64 in the text, no XSS surface — the DOM is rebuilt from the markers on load.
- **The caret is tracked as a single text offset**, never as a DOM range across renders. The DOM is only rebuilt when it actually disagrees with stored state; dragging an image edge touches numbers only and never the DOM.
- Two slots: `conversation.session.header.utilities` (the button) and `shell.overlay` (the panel). While closed the panel component returns `null`, so it costs no DOM and no rendering; the button subscribes to a single boolean.
- Styling uses theme tokens only (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-elevation-*`), so it follows light and dark themes.

### Known limits

- Text plus inline images only — no bold, lists, or headings.
- Images are bounded by the ~5 MB `localStorage` quota; more or larger images would need IndexedDB.
- Images are block-level: they insert at the caret, but occupy their own line.

## Files

| File | Purpose |
|---|---|
| `package.json` | Manifest; declares both halves via `dsh.bundle.patch` and `dsh.client` |
| `cordis.patch.yml` | Inserts one Host row (its only job is mounting the package) |
| `index.js` | Host half: empty |
| `client.js` | Browser half: store, button, panel, editor, styles, slot registrations |
| `locale/{zh,en}.json` | Titles and descriptions for the plugin manager |
| `icon.svg` | Plugin icon |
| `.smoke/harness.mjs.cjs` | Offline behaviour check (fake DOM + fake React, not a real browser) |

## Development

No build step — edit `client.js` and reload.

Run the offline check:

```bash
node .smoke/harness.mjs.cjs client.js
```

It stubs a DOM, React and storage, then drives the real client code through opening, typing, tabs, drag-to-reorder, images, zoom, trash and reload. It is a behavioural check, not a browser.

## License

MIT
