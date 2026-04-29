# GitLab Pierre

Chrome extension that replaces the `gitlab.com` changes view with Pierre-powered diffs and a Pierre-powered changed-files tree.

<img width="3180" height="2410" alt="Google Chrome-2026-04-29-11 52 12" src="https://github.com/user-attachments/assets/ed40eb13-bc91-486d-b527-efb6d22d0a18" />


## Development

```bash
pnpm install
pnpm build
```

Load the generated `dist/` directory in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select `dist/`.

## Supported pages

- Merge request changes: `https://gitlab.com/<namespace>/<project>/-/merge_requests/<iid>/diffs`
- Commits: `https://gitlab.com/<namespace>/<project>/-/commit/<sha>`
- Compares: `https://gitlab.com/<namespace>/<project>/-/compare/<from>...<to>`

The manifest-declared content script is a small bootstrap. It dynamically loads the Pierre app bundle from the extension, fetches GitLab's same-origin raw `.diff` endpoint, parses it with `@pierre/diffs`, renders each parsed file with Pierre's `<FileDiff />`, and renders the changed file list with `@pierre/trees`.

Line comments are bridged to GitLab's native discussion UI. Click the `+` gutter control in the Pierre diff to reveal the matching GitLab line and open GitLab's own inline comment editor.

Use the **Theme** menu in the Pierre toolbar to switch between bundled Pierre/Shiki theme presets and system, light, or dark mode. The menu can also keep syntax colors from the selected theme while forcing diff backgrounds to GitLab's own page surface. Theme changes apply immediately and are saved with `chrome.storage.local`.

Pierre mode mirrors GitLab's changes controls: it shows the current commit/version context, file stats, file browser visibility, Tree/List file browser controls, expand/collapse controls, and **Show GitLab diffs** / **Show Pierre diffs** to temporarily switch between Pierre and GitLab's native changes UI.
