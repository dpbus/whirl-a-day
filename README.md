# Whirl-a-Day

Spin-the-wheel picker that remembers what's been drawn, for advent calendars, chore charts and
dinner decisions.

**Try it at [whirladay.com](https://whirladay.com).**

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
- **Play on everyone's phones.** Put a wheel online and share one QR code. Each person scans
  it, taps their name, and spins on their own phone. Either everyone gets their own copy (an
  advent calendar for each kid, and you see everyone's progress), or it's one wheel for the whole
  group, where every spin plays on every phone and the history shows who spun what (game night).
- **Keep as many wheels as you like** and switch between them from the title at the top. Each
  one has its own theme: Christmas, Winter Wonderland, Halloween, Birthday, Classic or Midnight.
- **Grown-up settings** can sit behind an optional PIN so nobody gives themselves an extra spin.
  If you forget the PIN, type "remove pin" at the prompt; your progress stays put.

There's confetti, a little falling snow for the winter themes, and real recorded sounds: a
wooden click, a music box or sleigh bells as the wheel ticks past each slice.

### Your data

Wheels stay in the browser on the device you're using. Nothing is sent anywhere, and there's no
account. That also means progress lives on that one device, so the app keeps a few safety nets:

- You can save a backup file from Settings → Backup, and restore it later or on another device.
  (The PIN is never included in backups.)
- It takes automatic snapshots at the start of each day and before anything drastic, like a
  reset or deleting a wheel, so mistakes can be undone.
- If the saved data is ever damaged, the app keeps a copy instead of writing over it, and falls
  back to the latest snapshot.

**Online wheels are the exception.** A wheel you put online is stored on whirladay.com: its
options and surprises, the names people type, and the spin history. Nothing else is kept: no
accounts, emails, IP addresses or analytics. It's deleted automatically 60 days after its last
spin, join or change, or straight away when the host takes it offline. Players
only ever receive their own surprises once they've spun them. Sign-in tokens for online wheels
stay on each phone and are never written to backup files.

**On an iPhone or iPad,** use Share → *Add to Home Screen* and open it from there. Safari may
clear a website's data if you haven't visited for a week, but home-screen apps are left alone.
The home-screen app also keeps its data separately from Safari, so set things up from the
home-screen version (or move your progress over with a backup file).

## Running it

The website is plain HTML, CSS and JavaScript in `public/`, with no build step and no
dependencies. Online wheels run on a small Cloudflare Worker in `server/`, also plain
JavaScript. The only dependency is Cloudflare's `wrangler` tool, for development:

```sh
npm install
npm start        # wrangler dev: the site and the server, at http://localhost:8765
```

Without the server (local wheels only), `npm run start:static` serves `public/` with Python.

To try online wheels with two "phones" on one computer, open the host at
http://localhost:8765 and the join link at `http://127.0.0.1:8765/j/<code>`. The two addresses
keep separate storage, like two devices.

Updates reach people right away: the service worker checks the network first and only uses its
offline copy when the connection is down or very slow.

### Deploying

whirladay.com runs on Cloudflare as a Worker with static assets (`wrangler.jsonc`), deployed by
Cloudflare Workers Builds on every push to `main`. Static files are served directly and are
free and unlimited. Only `/api/*` and `/j/*` run the Worker, and each online wheel is a
SQLite-backed Durable Object, which the free plan supports. One wheel for a family uses a few
hundred requests over the whole season, against a free allowance of 100,000 a day. One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository**, and pick this repo.
2. Project name: `whirl-a-day` (it must match `name` in `wrangler.jsonc`).
3. Leave the build command empty. The deploy command is `npx wrangler deploy` (the default), and
   the production branch is `main`.

The custom domain comes from `routes` in `wrangler.jsonc`, so the domain has to be in the same
Cloudflare account. Other branches get preview URLs.

Only `public/` is uploaded as static files, and `public/_headers` adds security headers to every
response. Deploying restarts the Durable Objects, which disconnects phones for a moment; they
reconnect on their own. Another static host can serve `public/` too, but only for local wheels.

### Tests

```sh
npm test
```

This uses Node's built-in test runner, so nothing extra is needed. The tests cover:

- the spin rules (`public/js/rules.js`): daily limits in the wheel's time zone, shared and
  individual wheels, undo and reset;
- this device's data (`public/js/state.js`): saving, backups, the safety nets above, online
  wheels' copies, and damaged or deliberately malicious backup files;
- the server (`server/room.js`, `server/directory.js`) with in-memory stand-ins for Durable
  Objects: joining, signing in, who sees what, two phones spinning at once, releasing names,
  expiry, and oversized or flooding messages.

## Notes for contributors

- **One set of rules, two places.** `public/js/rules.js` holds the wheel's shape and every rule
  and change (named actions like `add-options` or `extra-spin`). The app runs it for local
  wheels; the server imports the same file for online ones, so they can't disagree.
- **A wheel is a log of spins.** What's left on the wheel, today's count and undo are all worked
  out from `spins`, rather than kept separately.
- **Spins are decided before the wheel moves.** The result is picked with
  `crypto.getRandomValues` (on the server, for online wheels) and saved immediately, then the
  animation lands on it. Refreshing mid-spin can't re-roll.
- **Online wheels:** the screens work from this device's copy of the wheel. The host's changes
  apply to the copy straight away and go to the server (`public/js/store/online.js`); the
  server's reply replaces the copy. `server/room.js` decides who may do what and what each phone
  sees, such as players never receiving surprises they haven't spun.
- **Saved data has a version.** If you change its shape, bump `SCHEMA_VERSION` in
  `public/js/state.js` (or `WHEEL_VERSION` in `rules.js`) and teach the normalize functions to
  read the old shape, so existing saves, backup files and online wheels keep working.
- **Anything from storage, a backup file or another phone is untrusted.** It all goes through
  `normalizeWheel()` (and `normalize()` on this device), which checks every field and caps sizes.
  The server also limits message sizes, message rates, connections per wheel, and how many
  wheels one network can create per hour. Anything a user typed is escaped (`escapeHtml()`) or
  set with `textContent`/`.value` before it reaches the page.
- **The Content-Security-Policy** in `public/index.html` (and `public/_headers`) only allows the app's own files (and WebSockets
  to whirladay.com), with no inline scripts or `style=""` attributes. Set styles from JavaScript instead.
- **If you add a file the app needs offline,** list it in `CORE_FILES` in `public/sw.js`.

## Credits

- Sounds from [VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE)
  by Sam Gossner and Simon Dalzell (CC0). `docs/sounds.md` explains how they were trimmed.
- Icons from [Lucide](https://lucide.dev) (ISC).
- QR codes by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) from Kazuhiko
  Arase (MIT).
- Confetti by [canvas-confetti](https://github.com/catdad/canvas-confetti) from Kiril Vatev (ISC).
- Fonts via [Fontsource](https://fontsource.org): Fredoka and Creepster (OFL 1.1), Mountains of
  Christmas (Apache 2.0).

Built with the help of [Claude Code](https://claude.com/claude-code).

## License

[MIT](LICENSE) © 2026 David Busse. The bundled fonts, sounds, icons and libraries keep their own
licenses, listed above.
