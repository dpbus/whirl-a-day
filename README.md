# Whirl-a-Day

A spinner wheel that remembers what each player has spun. Built for a 12-days-of-Christmas /
advent calendar: each kid spins once a day, and the number they get comes off **their** wheel.
It also handles everyday wheels, like a chore wheel or a family dinner picker.

Plain HTML, CSS and JavaScript. **No build step, no dependencies.** It makes no requests to any
other server: fonts, sounds, icons and the confetti library are all served with the app.

## Run it locally

ES modules need to be served over http (opening `index.html` directly won't work):

```sh
npm start          # or: python3 -m http.server 8765
# then open http://localhost:8765
```

## Tests

```sh
npm test           # Node's built-in test runner; nothing to install
```

The tests cover the data layer (`js/state.js`): spinning rules, saving, backups, migrations,
the safety nets below, and hostile or damaged backup files.

## Deploy

Upload the whole folder to any static host:

- **Netlify Drop**: drag the folder onto https://app.netlify.com/drop
- **GitHub Pages**: push to a repo → Settings → Pages → deploy from branch
- **Cloudflare Pages**: same idea

Updates show up immediately: the service worker checks the network first (falling back to its
cache when offline or on a very slow connection), so there's no cache to bust. **When you add a
file the app needs offline, add it to `CORE_FILES` in `sw.js`.**

## Features

- **Several wheels** (e.g. 12 Days of Christmas, Chore Wheel, What's for Dinner?), switched from
  the title at the top. Each wheel has its own options, surprises, rules and theme
- **Players per wheel**, one tab each with their own progress and history, or no players for a
  shared wheel that everyone spins together
- **Remove after spin** (per wheel): each result comes off the wheel for whoever spun it
- **Spins per day** (per wheel): no limit, or 1–10 a day, plus a grown-up "Give 1 extra spin today"
- Optional **surprise** text per option, revealed when spun ("Hot cocoa movie night!")
- Presets: 12 Days of Christmas, Advent 1–24/1–25, Yes/No, Dinner, Chores, Blank
- Themes: Christmas, Winter Wonderland, Halloween, Birthday, Classic, Midnight
- Adjustable spin length (2–15 s), confetti, falling snow, and real recorded sounds (wooden click,
  music box, or sleigh-bell tick, with a preview)
- Optional grown-up PIN for settings (kid-proofing, not real security). A forgotten PIN can be
  removed by typing "remove pin" at the prompt; progress is kept
- Backup/restore to a JSON file
- Installable to the home screen, and works offline after the first visit

Saved data keeps its original `spinner.*` storage keys, so renaming the app never orphans anyone's progress.

## Where the data lives

Everything is stored in the browser's `localStorage` on that one device. Nothing is sent anywhere.
The grown-up PIN stays on the device: it's never written to backup files, and restoring a backup
keeps the device's own PIN.

Ways it protects progress (see the top of `js/state.js`):

- **Backup files**: Settings → Backup. On phones this opens the share sheet ("Save to Files").
- **Automatic snapshots** (last 10, kept on the device): one at the start of each day, plus one
  before every reset, wheel or player removal, preset load, restore, or erase. They can be restored from
  Settings → Backup.
- **Unreadable saved data is never overwritten.** It's copied to `spinner.state.unreadable.<time>`
  (downloadable from Settings → Backup) and the newest snapshot is loaded instead. If there's no
  room to copy it, the app stops saving rather than overwrite it, until you restore a backup or
  erase everything.
- **Data from a newer version is never overwritten.** An out-of-date copy of the app (say, an
  old home-screen install) shows a "reload to update" message and saves nothing.
- **Multiple tabs or windows:** if another copy of the app changed the data, this one reloads it
  before spinning or opening settings, so a stale copy can't undo spins.
- **Failed saves show a warning banner** (storage full or blocked) instead of failing silently.

**iPhone/iPad:** use Share → *Add to Home Screen* and always open it from there. Safari can
clear storage for websites that haven't been visited in 7 days; home-screen apps are exempt.
The home-screen app also has **its own separate storage** from Safari, so set up from the
home-screen app (the setup screen says so on iOS), or move progress across with a backup file.

## Security

- **No HTML injection:** everything a user types, and everything read from a backup file, is
  escaped with `escapeHtml()` or set with `textContent`/`.value` before it reaches the page.
- **Untrusted data is validated:** storage, snapshots and backup files all go through `normalize()`
  in `js/state.js`, which type-checks every field and caps lengths and counts (wheels, options,
  players, history), so a damaged or crafted file can't break the app or lock anyone out.
- **Content-Security-Policy** (a `<meta>` tag in `index.html`): only the app's own files can load,
  with no inline scripts or style attributes. If your host can set headers, you can send the same
  policy as a header too.
- The PIN is kid-proofing, not real security: anyone with the device can clear site data.

## Code map

| File | What it does |
|---|---|
| `index.html` | Page structure and the static dialogs |
| `css/styles.css` | All styles; colors come from CSS variables set by the theme |
| `css/fonts.css`, `fonts/` | Self-hosted fonts (Fredoka, Mountains of Christmas, Creepster) and their licenses |
| `js/main.js` | Entry point: renders the main screen and runs spins |
| `js/templates.js` | Small HTML snippets shared by the main screen and settings |
| `js/state.js` | The data model (its shape is documented at the top), saving/loading, validation, migrations, and every action that changes data |
| `js/wheel.js` | `WheelView`: draws a wheel on a canvas and animates spins |
| `js/settings/` | The settings dialog: `index.js` (dialog and tabs), one file per tab (`wheels-tab.js`, `wheel-tab.js`, `players-tab.js`, `general-tab.js`, `backup-tab.js`), `shared.js` helpers, and `welcome.js` (first-run setup) |
| `js/themes.js` | Theme definitions and tick-sound names; **add a theme here** |
| `js/presets.js` | Wheel presets; **add a preset here** |
| `js/effects.js` | Sounds, confetti, snow |
| `js/dialogs.js` | Confirm / alert / PIN dialogs |
| `js/icons.js` | UI icons from [Lucide](https://lucide.dev) (ISC), inlined as SVG |
| `js/util.js` | Small shared helpers (dates, random numbers, escaping, debounce) |
| `js/vendor/` | [canvas-confetti](https://github.com/catdad/canvas-confetti) 1.9.4 (ISC), checked in as one file; no build step |
| `sounds/` | Recorded samples (CC0); see `sounds/README.md` for the source and how they were made |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline support |
| `tests/` | Tests for the data layer (`npm test`) |

The result of a spin is chosen first with `crypto.getRandomValues` and saved right away, so a
refresh mid-spin can't re-roll. The animation then lands on that result.

If you change the shape of the saved data, bump `SCHEMA_VERSION` in `state.js` and handle the old
shape in `normalize()`, so existing saves and backups keep working. (Version 3 introduced
multiple wheels; older saves are converted by `migratePlayersToWheels()`, which merges players
whose wheels were identical.)

## Credits

- Sounds: [VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE) by Sam Gossner & Simon Dalzell (CC0)
- Icons: [Lucide](https://lucide.dev) (ISC)
- Confetti: [canvas-confetti](https://github.com/catdad/canvas-confetti) by Kiril Vatev (ISC)
- Fonts via [Fontsource](https://fontsource.org): Fredoka (OFL 1.1), Creepster (OFL 1.1),
  Mountains of Christmas (Apache 2.0); license files are in `fonts/`

## License

[MIT](LICENSE) © 2026 David Busse. Bundled fonts, sounds, icons and libraries keep their own
licenses, listed under Credits.
