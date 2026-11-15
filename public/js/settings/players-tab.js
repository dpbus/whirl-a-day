// Settings → Players: who plays this wheel. One row per player (name, a short status, and a "⋯"
// menu with everything you can do for them), "Add a name", and for an online wheel the QR code
// plus a few rarely needed joining options under "More options".
import * as store from '../state.js';
import { alertDialog, confirmDialog, menuDialog, promptDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { plural } from '../templates.js';
import { hostAction, showInvite } from '../online-ui.js';
import { bindWheelRow, progressActions, runProgressAction, summary, wheelRow } from './progress.js';
import { $, displayName, escapeHtml } from '../util.js';

export function render(view) {
  const wheel = store.activeWheel();
  view.body.innerHTML = `
    ${wheel.online ? `<button type="button" class="btn primary" id="p-invite">${icon('qr-code', { size: 18 })} Show QR code</button>` : ''}
    <h3>Players</h3>
    ${wheel.players.length ? `<p class="hint">${playersHint(wheel)}</p>` : ''}
    ${wheel.sharedWheel && wheel.players.length ? `<div id="p-wheel">${wheelRow(wheel)}</div>` : ''}
    ${wheel.players.length ? '<ul class="row-list" id="p-list"></ul>' : `<p class="hint">${noPlayersHint(wheel)}</p>`}
    ${addPlayerForm(wheel)}
    ${wheel.online ? moreOptions(wheel) : ''}
  `;
  $('#p-invite', view.body)?.addEventListener('click', () => showInvite(wheel));
  if (wheel.players.length) renderPlayerList(view, wheel);
  const wheelBox = $('#p-wheel', view.body);
  if (wheelBox) bindWheelRow(wheelBox, wheel, () => changed(view));
  bindAddPlayer(view, wheel);
  if (wheel.online) bindMoreOptions(view, wheel);
}

const refresh = (view) => view.showTab('players', { keepScroll: true });
const changed = (view) => {
  view.changed();
  refresh(view);
};

function playersHint(wheel) {
  if (wheel.sharedWheel) return 'Everyone spins the same wheel. Tap ⋯ to undo a spin or start over.';
  return 'Each player has their own copy of the wheel. Tap ⋯ next to a name for their options.';
}

function noPlayersHint(wheel) {
  if (wheel.online) return 'Nobody has joined yet. Show the QR code to invite people, or add names below for them to tap.';
  return 'No players yet, so everyone shares this wheel. Add players to give each person their own.';
}

// ---------------------------------------------------------------- player rows

/** "You" / "Joined" / "Not joined yet" (online wheels only). */
function joinStatus(wheel, player) {
  if (!wheel.online) return '';
  if (store.isHostPlayer(wheel, player.id)) return 'You';
  return player.claimed ? 'Joined' : 'Not joined yet';
}

function renderPlayerList(view, wheel) {
  const list = $('#p-list', view.body);
  list.innerHTML = wheel.players
    .map((player) => {
      const status = [joinStatus(wheel, player), summary(wheel, player.id)].filter(Boolean).join(' · ');
      return `
        <li class="list-row" data-id="${escapeHtml(player.id)}">
          <span class="row-text"><strong>${escapeHtml(displayName(player))}</strong><span class="hint">${escapeHtml(status)}</span></span>
          <button type="button" class="icon-btn small" data-menu aria-label="Options for ${escapeHtml(displayName(player))}">${icon('ellipsis', { size: 18 })}</button>
        </li>`;
    })
    .join('');

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-menu]');
    if (!button) return;
    const player = store.findPlayer(wheel, button.closest('[data-id]').dataset.id);
    if (!player) return;
    const action = await menuDialog(displayName(player), playerMenu(wheel, player));
    if (action && (await runPlayerAction(wheel, player, action))) changed(view);
  });
}

/** Everything that can be done for one player, in the order people look for it. */
function playerMenu(wheel, player) {
  const items = [...progressActions(wheel, player.id)];
  if (wheel.online) {
    if (store.isHostPlayer(wheel, player.id)) items.push({ id: 'not-me', label: 'This isn’t me' });
    else if (player.claimed) items.push({ id: 'sign-out', label: 'Sign out their device' });
    else if (!wheel.online.hostPlayerId) items.push({ id: 'me', label: 'This is me (I’m playing too)' });
  }
  items.push({ id: 'rename', label: 'Rename' });
  items.push({ id: 'remove', label: 'Remove', danger: true });
  return items;
}

async function runPlayerAction(wheel, player, action) {
  const name = displayName(player);
  switch (action) {
    case 'rename': {
      const newName = await promptDialog('Name', { title: `Rename ${name}`, value: player.name, maxLength: store.MAX_NAME_LENGTH });
      const current = store.getWheel(wheel.id);
      if (!newName || !current) return false;
      store.renamePlayer(current, player.id, newName);
      store.flushSave();
      return true;
    }
    case 'me':
      return setHostPlayer(wheel, player.id);
    case 'not-me':
      return setHostPlayer(wheel, null);
    case 'sign-out': {
      const ok = await confirmDialog(
        `Sign out the device that joined as ${name}? Their progress stays. They can scan the QR code and tap their name again, on that device or another one.`,
        { title: 'Sign out their device?', ok: 'Sign out' },
      );
      if (!ok || !store.getWheel(wheel.id)) return false;
      return runHostAction(wheel, 'release', { playerId: player.id });
    }
    case 'remove': {
      const lastOne = !wheel.online && wheel.players.length === 1 ? ' With no players left, everyone shares the wheel.' : '';
      const signedOut = wheel.online && player.claimed ? ' Their device is signed out.' : '';
      const ok = await confirmDialog(`Remove ${name} and their spins?${lastOne}${signedOut}`, { title: `Remove ${name}?`, ok: 'Remove', danger: true });
      const current = store.getWheel(wheel.id);
      if (!ok || !current) return false;
      store.removePlayer(current, player.id);
      return true;
    }
    default:
      return runProgressAction(wheel, player.id, action);
  }
}

/** Make a name the host's own (or none): theirs to spin, and nobody else can join as it. */
async function setHostPlayer(wheel, playerId) {
  const done = await runHostAction(wheel, 'set-host-player', { playerId });
  if (done && playerId) store.setActivePlayer(wheel, playerId);
  return done;
}

async function runHostAction(wheel, name, args) {
  try {
    await hostAction(wheel, name, args);
    return true;
  } catch (err) {
    alertDialog(err.message, { title: "That didn't work" });
    return false;
  }
}

// ---------------------------------------------------------------- adding a name

function addPlayerForm(wheel) {
  if (!store.canAddPlayer(wheel)) return `<p class="hint">This wheel has the most players allowed (${store.MAX_PLAYERS}).</p>`;
  const canBeMe = wheel.online && !wheel.online.hostPlayerId;
  return `
    <form class="settings-form" id="p-add">
      <div class="field">
        <label for="p-name">Add a name</label>
        <div class="row">
          <input id="p-name" maxlength="${store.MAX_NAME_LENGTH}" required placeholder="e.g. Lily">
          <button class="btn primary">Add</button>
        </div>
        ${wheel.online ? '<p class="hint">People can tap their name when they join, instead of typing it.</p>' : ''}
      </div>
      ${canBeMe ? `<div class="toggles"><label class="switch"><input type="checkbox" id="p-me"><span>This is me (I'm playing too, on this device)</span></label></div>` : ''}
    </form>`;
}

function bindAddPlayer(view, wheel) {
  $('#p-add', view.body)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#p-name', view.body).value.trim();
    if (!name) return;
    // On this device, the first player turns a shared wheel into one where each player has
    // their own copy, so the spins so far (nobody's in particular) are cleared.
    const sharedSpins = !wheel.online && store.isShared(wheel) ? wheel.spins.length : 0;
    if (sharedSpins) {
      const ok = await confirmDialog(
        `With players, each person gets their own copy of the wheel, so the ${plural(sharedSpins, 'spin')} so far will be cleared. (A snapshot is kept.)`,
        { title: 'Add the first player?', ok: 'Add player' },
      );
      if (!ok || !store.getWheel(wheel.id)) return;
    }
    const player = store.addPlayer(store.getWheel(wheel.id), name);
    if ($('#p-me', view.body)?.checked) await setHostPlayer(wheel, player.id);
    changed(view);
  });
}

// ---------------------------------------------------------------- more options (online)

function moreOptions(wheel) {
  const limitToggle = wheel.sharedWheel
    ? wheel.spinsPerDay
      ? `<label class="switch"><input type="checkbox" id="p-group-limit"><span>Share the day's spins as a group</span></label>
         <p class="hint">Off: everyone gets ${plural(wheel.spinsPerDay, 'spin')} a day. On: ${plural(wheel.spinsPerDay, 'spin')} a day for the whole group, first come, first served.</p>`
      : ''
    : `<label class="switch"><input type="checkbox" id="p-share-spins"><span>Players see each other's spins</span></label>
       <p class="hint">They see what the others got, but not their surprises.</p>`;
  return `
    <details class="more">
      <summary>More options</summary>
      <div class="toggles">
        <label class="switch"><input type="checkbox" id="p-join-open"><span>Let new people join</span></label>
      </div>
      <p class="hint">Turn this off once everyone has joined.</p>
      <div class="toggles">${limitToggle}</div>
      <button type="button" class="btn small" id="p-new-code">Make a new QR code</button>
      <p class="hint">If the QR code was shared somewhere it shouldn't have been. The old one stops working; people who already joined stay in.</p>
    </details>`;
}

function bindMoreOptions(view, wheel) {
  const open = $('#p-join-open', view.body);
  open.checked = wheel.online.joinOpen;
  open.addEventListener('change', async () => {
    await runHostAction(wheel, 'set-join-open', { open: open.checked });
    refresh(view);
  });
  const groupLimit = $('#p-group-limit', view.body);
  if (groupLimit) {
    groupLimit.checked = wheel.sharedDailyLimit === true;
    groupLimit.addEventListener('change', () => {
      store.setWheelProps(wheel, { sharedDailyLimit: groupLimit.checked });
      changed(view);
    });
  }
  const shareSpins = $('#p-share-spins', view.body);
  if (shareSpins) {
    shareSpins.checked = wheel.showSpinsToEveryone === true;
    shareSpins.addEventListener('change', () => {
      store.setWheelProps(wheel, { showSpinsToEveryone: shareSpins.checked });
      view.changed();
    });
  }
  $('#p-new-code', view.body).addEventListener('click', async () => {
    const ok = await confirmDialog('Make a new QR code? The old one stops working. People who already joined stay in.', {
      title: 'New QR code?',
      ok: 'Make a new one',
    });
    if (ok && (await runHostAction(wheel, 'rotate-code'))) refresh(view);
  });
}
