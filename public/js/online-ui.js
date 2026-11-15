// Screens for online wheels: putting a wheel online, the invite QR code, joining from a QR
// code, opening a host link, and taking a wheel back offline.
import * as store from './state.js';
import * as online from './store/online.js';
import { qrSvg } from './qr.js';
import { alertDialog, confirmDialog, makeDialog } from './dialogs.js';
import { icon } from './icons.js';
import { deviceTimeZone, wheelTitle } from './rules.js';
import { displayName, escapeHtml, uid } from './util.js';

let hooks = { onChange() {} };

export function initOnlineUi(callbacks) {
  hooks = { ...hooks, ...callbacks };
}

const RETENTION_NOTE =
  'The wheel, its surprises and the names people type are stored on whirladay.com, and deleted automatically 60 days after it was last used (or as soon as you delete it). No accounts, no ads, nothing else is kept.';

// ================================================================ Links that open the app

/**
 * Handle a link the app was opened with: #j=CODE (a QR code) or #host=WHEEL.SECRET (a host
 * link). The fragment is removed from the address bar straight away, so a host secret doesn't
 * linger in the history. Returns true if there was a link to handle.
 */
export function handleLinkInUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('j');
  const host = params.get('host');
  if (!code && !host) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (code) openJoin(code.toUpperCase());
  else openHostLink(host);
  return true;
}

// ================================================================ Joining

export async function openJoin(code) {
  let info;
  try {
    info = await online.lookupJoinCode(code);
  } catch (err) {
    alertDialog(err.message, { title: "Couldn't open that wheel" });
    return;
  }
  // Scanning again on a phone that already joined goes straight back to its spot.
  const mine = store.getState().wheels.find((w) => w.online?.wheelId === info.wheelId && w.online.token);
  if (mine) {
    store.setActiveWheel(mine.id);
    hooks.onChange();
    return;
  }
  showJoinDialog(code, info);
}

function showJoinDialog(code, info) {
  const titleId = `dlg-${uid()}`;
  const free = info.players.filter((p) => !p.claimed);
  const taken = info.players.filter((p) => p.claimed);
  const dialog = makeDialog(
    'small join',
    `<form method="dialog" class="dialog-body">
      <h2 id="${titleId}">Join “${escapeHtml(wheelTitle(info))}”</h2>
      ${
        info.joinOpen
          ? `${free.length ? `<p>Tap your name:</p><div class="name-buttons">${free.map((p) => `<button type="button" class="btn name-btn" data-player="${escapeHtml(p.id)}">${escapeHtml(displayName(p))}</button>`).join('')}</div>` : ''}
             <div class="field">
               <label for="jn-name">${free.length ? 'Not on the list? Type your name' : 'Your name'}</label>
               <input id="jn-name" maxlength="${store.MAX_NAME_LENGTH}" autocomplete="nickname" placeholder="First name or nickname">
             </div>`
          : '<p>Joining is closed right now. Ask the host to open it, then scan the code again.</p>'
      }
      ${taken.length ? `<p class="hint">Already joined: ${escapeHtml(taken.map(displayName).join(', '))}</p>` : ''}
      <p class="hint">This wheel lives on whirladay.com, so your name and spins are stored there until the wheel is deleted (60 days after it was last used).</p>
      <p class="error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-cancel>${info.joinOpen ? 'Cancel' : 'OK'}</button>
        ${info.joinOpen ? '<button class="btn primary">Join</button>' : ''}
      </div>
    </form>`,
    titleId,
  );
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.error');
  const buttons = () => dialog.querySelectorAll('button');

  const join = async (args) => {
    error.textContent = '';
    buttons().forEach((b) => (b.disabled = true));
    try {
      const result = await online.joinWheel(info.wheelId, { ...args, joinCode: code });
      store.addOnlineWheel(result.wheel, {
        wheelId: result.wheelId,
        role: 'player',
        token: result.token,
        playerId: result.playerId,
        joinOpen: result.meta?.joinOpen,
      });
      dialog.close();
      hooks.onChange();
    } catch (err) {
      error.textContent = err.message;
      buttons().forEach((b) => (b.disabled = false));
    }
  };

  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('.name-buttons')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-player]');
    if (button) join({ playerId: button.dataset.player });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = dialog.querySelector('#jn-name').value.trim();
    if (!name) {
      error.textContent = 'Type your name, or tap it above.';
      return;
    }
    join({ name });
  });
  dialog.showModal();
}

// ================================================================ Host links

async function openHostLink(value) {
  const [wheelId, token] = String(value).split('.');
  if (!store.isWheelId(wheelId) || !store.isToken(token)) {
    alertDialog("That link isn't complete. Copy the whole link and try again.", { title: "Couldn't open the wheel" });
    return;
  }
  const existing = store.getState().wheels.find((w) => w.online?.wheelId === wheelId);
  if (existing?.online.role === 'host' && existing.online.token === token) {
    store.setActiveWheel(existing.id);
    hooks.onChange();
    return;
  }
  const ok = await confirmDialog(
    'Manage this wheel from this device too? Anyone with this link can change the wheel, so keep it private.',
    { title: 'Manage this wheel here?', ok: 'Yes, manage it here' },
  );
  if (!ok) return;
  // The server sends the wheel itself once the connection signs in.
  store.addOnlineWheel(existing ?? { title: 'Loading…' }, { wheelId, role: 'host', token, playerId: null });
  hooks.onChange();
}

export function showHostLink(wheel) {
  const link = online.hostLink(wheel);
  const titleId = `dlg-${uid()}`;
  const dialog = makeDialog(
    'small',
    `<form method="dialog" class="dialog-body">
      <h2 id="${titleId}">Manage from another device</h2>
      <p>Open this link on another device to manage “${escapeHtml(wheelTitle(wheel))}” from there too. Save it somewhere safe, like your notes or email to yourself, in case you lose this one.</p>
      <p class="hint"><strong>Keep it private:</strong> anyone with this link can change the wheel and see every surprise.</p>
      <input class="link-field" readonly aria-label="Link to manage this wheel">
      ${linkButtons()}
      <div class="dialog-actions"><button class="btn primary">Done</button></div>
    </form>`,
    titleId,
  );
  dialog.querySelector('.link-field').value = link;
  bindLinkButtons(dialog, link, `Manage ${wheelTitle(wheel)}`);
  dialog.showModal();
}

// ================================================================ Putting a wheel online

export function putOnline(wheel) {
  const titleId = `dlg-${uid()}`;
  const names = wheel.players.map(displayName);
  const dialog = makeDialog(
    'small',
    `<form method="dialog" class="dialog-body">
      <h2 id="${titleId}">Play on everyone's own devices</h2>
      <p>Put “${escapeHtml(wheelTitle(wheel))}” online and everyone can spin on their own phone, tablet or computer. You'll get one QR code to share.</p>
      <fieldset class="choices">
        <legend class="field-label">How should it work?</legend>
        <label class="choice">
          <input type="radio" name="kind" value="individual" ${wheel.sharedWheel ? '' : 'checked'}>
          <span><strong>Everyone gets their own wheel</strong><span class="hint">Like an advent calendar: each person works through their own copy. You see everyone's progress.</span></span>
        </label>
        <label class="choice">
          <input type="radio" name="kind" value="shared" ${wheel.sharedWheel ? 'checked' : ''}>
          <span><strong>One wheel for everyone</strong><span class="hint">Like game night: every spin plays on every screen, and the history shows who spun.</span></span>
        </label>
      </fieldset>
      ${names.length ? `<p class="hint">${escapeHtml(names.join(', '))} will be on the list for people to tap when they join.</p>` : ''}
      ${wheel.sharedWheel && wheel.spins.length ? `<p class="hint" data-lost-spins hidden>This wheel's spins so far belong to nobody in particular, so they can't carry over to each person's own wheel. (A snapshot is kept on this device.)</p>` : ''}
      <p class="hint">${RETENTION_NOTE}</p>
      <p class="error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-submit>${icon('cloud-upload', { size: 18 })} Put online</button>
      </div>
    </form>`,
    titleId,
  );
  const form = dialog.querySelector('form');
  const submit = dialog.querySelector('[data-submit]');
  const lostSpins = dialog.querySelector('[data-lost-spins]');
  form.addEventListener('change', () => {
    if (lostSpins) lostSpins.hidden = form.elements.kind.value !== 'individual';
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    dialog.querySelector('.error').textContent = '';
    try {
      const current = await goOnline(wheel, { sharedWheel: form.elements.kind.value === 'shared' });
      dialog.close();
      if (current) showInvite(current, { justCreated: true });
    } catch (err) {
      dialog.querySelector('.error').textContent = err.message;
      submit.disabled = false;
    }
  });
  dialog.showModal();
}

/**
 * Move a wheel from this device to the server, as its host. Returns the wheel (now online), or
 * null if it was removed meanwhile. Throws an OnlineError if the server can't be reached.
 */
export async function goOnline(wheel, { sharedWheel }) {
  store.takeSnapshot(`Before putting “${wheelTitle(wheel)}” online`);
  const result = await online.createOnlineWheel(wheel, { sharedWheel, timeZone: deviceTimeZone() });
  const current = store.getWheel(wheel.id);
  if (!current) return null;
  current.online = { wheelId: result.wheelId, role: 'host', token: result.hostSecret, playerId: null };
  store.applyServerWheel(current, result.wheel, result.meta);
  hooks.onChange();
  return current;
}

/**
 * Right after making a wheel: put it online if that's how it'll be played, and show the QR code.
 * If the server can't be reached, the wheel stays on this device and can go online later.
 */
export async function startOnline(wheel, { sharedWheel }) {
  try {
    const current = await goOnline(wheel, { sharedWheel });
    if (current) showInvite(current, { justCreated: true });
  } catch (err) {
    alertDialog(`${err.message} The wheel is saved on this device; put it online later from Settings → This wheel.`, {
      title: "Couldn't put it online",
    });
  }
}

/** The QR code and link that people use to join. */
export function showInvite(wheel, { justCreated = false } = {}) {
  const link = online.joinLink(wheel.online.joinCode);
  const titleId = `dlg-${uid()}`;
  const dialog = makeDialog(
    'small invite',
    `<form method="dialog" class="dialog-body">
      <h2 id="${titleId}">${justCreated ? 'It’s online! ' : ''}Invite people</h2>
      <p>Scan with a camera, or open the link below, to join “${escapeHtml(wheelTitle(wheel))}”:</p>
      <div class="qr-box">${qrSvg(link, { label: `QR code for ${link}` })}</div>
      <p class="join-link">${escapeHtml(link.replace(/^https?:\/\//, ''))}</p>
      ${linkButtons()}
      ${wheel.online.joinOpen ? '' : '<p class="hint">Joining is closed right now. Open it in Settings → Players.</p>'}
      <p class="hint">You can bring this QR code back any time with the QR button at the top of the screen.${justCreated ? ' To run it from another device too, see Settings → This wheel → More options.' : ''}</p>
      <div class="dialog-actions"><button class="btn primary">Done</button></div>
    </form>`,
    titleId,
  );
  bindLinkButtons(dialog, link, `Join ${wheelTitle(wheel)}`);
  dialog.showModal();
}

const linkButtons = () => `
  <div class="row wrap link-buttons">
    <button type="button" class="btn" data-copy>${icon('copy', { size: 18 })} Copy link</button>
    ${navigator.share ? `<button type="button" class="btn" data-share>${icon('share', { size: 18 })} Share</button>` : ''}
  </div>`;

function bindLinkButtons(dialog, link, title) {
  const copy = dialog.querySelector('[data-copy]');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.lastChild.textContent = ' Copied!';
    } catch {
      alertDialog(link, { title: 'Copy this link' });
    }
  });
  dialog.querySelector('[data-share]')?.addEventListener('click', () => {
    navigator.share({ title, url: link }).catch(() => {});
  });
}

// ================================================================ Host controls

/** Send a host-only change (release, set-join-open, rotate-code, delete) for the wheel on screen. */
export function hostAction(wheel, name, args) {
  // By server id: after a reload from storage, the screens may hold an older copy of the wheel.
  const connection = online.currentConnection();
  if (!wheel.online || connection?.wheel.online?.wheelId !== wheel.online.wheelId) return Promise.reject(new online.OnlineError('offline'));
  return connection.hostAction(name, args);
}

/** Delete the wheel from the server and keep it as a wheel on this device. */
export async function takeOffline(wheel) {
  const ok = await confirmDialog(
    `Stop sharing “${wheelTitle(wheel)}” online? It's deleted from whirladay.com and everyone else loses it. It stays on this device with everyone's progress so far.`,
    { title: 'Stop sharing online?', ok: 'Stop sharing', danger: true },
  );
  if (!ok) return false;
  try {
    await hostAction(wheel, 'delete');
  } catch (err) {
    alertDialog(err.message, { title: "Couldn't stop sharing it" });
    return false;
  }
  const current = store.getWheel(wheel.id); // may be a fresher copy if storage reloaded meanwhile
  if (current) store.makeLocal(current);
  hooks.onChange();
  return true;
}

/** A host's wheel that's gone from the server: keep the last-known copy as a local wheel. */
export function keepLocalCopy(wheel) {
  store.makeLocal(wheel);
  hooks.onChange();
}

/** A line about an online wheel's connection, or '' when all is well. */
export function statusText(wheel, status) {
  if (!wheel?.online) return '';
  const role = wheel.online.role;
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'offline':
      return 'Reconnecting… Spins need a connection.';
    case 'signed-out':
      return role === 'host'
        ? "This device isn't signed in to this wheel anymore. To manage it again, open its link from “Manage from another device”."
        : "This device isn't signed in to this wheel anymore. Scan the QR code again to rejoin.";
    case 'gone':
      return role === 'host'
        ? 'This wheel was deleted from whirladay.com. You can keep a copy on this device from Settings → This wheel.'
        : 'This wheel was deleted from whirladay.com.';
    default:
      return '';
  }
}
