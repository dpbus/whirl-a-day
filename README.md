# Whirl-a-Day

Spin-the-wheel picker that remembers what's been drawn, for advent calendars, chore charts and
dinner decisions.

A friend wanted something for her kids' 12 Days of Christmas: each morning they spin a wheel,
open whichever day it lands on, and that number is gone for the rest of the season. Every
spinner I found online forgot everything between visits, so I built one that doesn't. It turned
out to be handy for other things too, like a chore wheel or settling "what's for dinner?".

## How it works

- **Make a wheel** from a preset (12 Days of Christmas, Advent, chores, dinner, yes/no) or write
  your own options. Each option can hide a surprise, like "Hot cocoa movie night", that's
  revealed when it comes up.
- **Add players**, and each kid gets their own tab and their own wheel to work through. Or skip
  players for a wheel the whole family shares.
- **Set the rules:** results can come off the wheel once they're spun, and you can limit spins
  per day (one a day for an advent calendar, unlimited for dinner).
- **Keep as many wheels as you like** and switch between them from the title at the top. Each
  one has its own theme: Christmas, Winter Wonderland, Halloween, Birthday, Classic or Midnight.
- **Grown-up settings** can sit behind an optional PIN so nobody gives themselves an extra spin.
  If you forget the PIN, type "remove pin" at the prompt; your progress stays put.

There's confetti, a little falling snow for the winter themes, and real recorded sounds: a
wooden click, a music box or sleigh bells as the wheel ticks past each slice.

### Your data

Everything stays in the browser on the device you're using. Nothing is sent anywhere, and
there's no account. That also means progress lives on that one device, so the app keeps a few
safety nets:

- You can save a backup file from Settings → Backup, and restore it later or on another device.
  (The PIN is never included in backups.)
- It takes automatic snapshots at the start of each day and before anything drastic, like a
  reset or deleting a wheel, so mistakes can be undone.
- If the saved data is ever damaged, the app keeps a copy instead of writing over it, and falls
  back to the latest snapshot.

**On an iPhone or iPad,** use Share → *Add to Home Screen* and open it from there. Safari may
clear a website's data if you haven't visited for a week, but home-screen apps are left alone.
The home-screen app also keeps its data separately from Safari, so set things up from the
home-screen version (or move your progress over with a backup file).

## Running it

It's plain HTML, CSS and JavaScript, with no build step and no dependencies. The website is the
`public/` folder; everything outside it (docs, tests, config) stays in the repo. It needs to be
served over HTTP rather than opened as a file, because it uses JavaScript modules:

```sh
npm start        # same as: python3 -m http.server 8765 --directory public
```

Then open http://localhost:8765.

Updates reach people right away: the service worker checks the network first and only uses its
offline copy when the connection is down or very slow.

### Deploying

whirladay.com runs on Cloudflare as an assets-only Worker (`wrangler.jsonc`), deployed by
Cloudflare Workers Builds on every push to `main`. One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository**, and pick this repo.
2. Project name: `whirl-a-day` (it must match `name` in `wrangler.jsonc`).
3. Leave the build command empty. The deploy command is `npx wrangler deploy` (the default), and
   the production branch is `main`.

The custom domain comes from `routes` in `wrangler.jsonc`, so the domain has to be in the same
Cloudflare account. Other branches get preview URLs.

Only `public/` is uploaded, and `public/_headers` adds security headers to every response. Any
other static host works too: just upload `public/`.

### Tests

```sh
npm test
```

This uses Node's built-in test runner, so there's nothing to install. The tests cover the data
layer in `public/js/state.js`: the spinning rules, saving, backups, migrations from older versions, the
safety nets above, and damaged or deliberately malicious backup files.

## Notes for contributors

- **Spins are decided before the wheel moves.** The result is picked with
  `crypto.getRandomValues` and saved immediately, then the animation lands on it. Refreshing
  mid-spin can't re-roll.
- **Saved data has a version.** If you change its shape, bump `SCHEMA_VERSION` in `public/js/state.js`
  and teach `normalize()` to read the old shape, so existing saves and backup files keep
  working. (Version 3 added multiple wheels; `migratePlayersToWheels()` converts older saves.)
  Storage keys still start with `spinner.`, from before the app had a name; changing them would
  strand everyone's saved progress.
- **Anything from storage or a backup file is untrusted.** It all goes through `normalize()`,
  which checks every field and caps sizes. Anything a user typed is escaped (`escapeHtml()`) or
  set with `textContent`/`.value` before it reaches the page.
- **The Content-Security-Policy** in `public/index.html` (and `public/_headers`) only allows the app's own files, with no inline
  scripts or `style=""` attributes. Set styles from JavaScript instead.
- **If you add a file the app needs offline,** list it in `CORE_FILES` in `public/sw.js`.

## Credits

- Sounds from [VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE)
  by Sam Gossner and Simon Dalzell (CC0). `docs/sounds.md` explains how they were trimmed.
- Icons from [Lucide](https://lucide.dev) (ISC).
- Confetti by [canvas-confetti](https://github.com/catdad/canvas-confetti) from Kiril Vatev (ISC).
- Fonts via [Fontsource](https://fontsource.org): Fredoka and Creepster (OFL 1.1), Mountains of
  Christmas (Apache 2.0).

Built with the help of [Claude Code](https://claude.com/claude-code).

## License

[MIT](LICENSE) © 2026 David Busse. The bundled fonts, sounds, icons and libraries keep their own
licenses, listed above.
