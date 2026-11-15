// Settings → Players: the active wheel's players (rename, reorder, remove, add). For an online
// wheel, also who has joined from which phone, and the controls for joining.
import * as store from '../state.js';
import { alertDialog, confirmDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { listItemControls, onListItemAction, plural } from '../templates.js';
import { hostAction, showInvite } from '../online-ui.js';
import { $, displayName, escapeHtml } from '../util.js';

export function render(view) {
  const wheel = store.activeWheel();
  view.body.innerHTML = `
    ${wheel.online ? joiningSection(wheel) : ''}
    <h3>Players on “${escapeHtml(store.wheelTitle(wheel))}”</h3>
    <p class="hint">${playersHint(wheel)}</p>
    ${wheel.players.length ? '<ul class="player-list" id="p-list"></ul>' : `<p class="hint"><em>${wheel.online ? 'Nobody yet.' : 'No players: this is a shared wheel.'}</em></p>`}
    ${addPlayerForm(wheel)}
  `;
  if (wheel.online) bindJoining(view, wheel);
  if (wheel.players.length) renderPlayerList(view, wheel);
  bindAddPlayer(view, wheel);
}

const refresh = (view) => view.showTab('players', { keepScroll: true });

function playersHint(wheel) {
  if (!wheel.online) return "Each player has their own progress on this wheel. With no players, it's a shared wheel that everyone spins together.";
  return wheel.sharedWheel
    ? 'Everyone spins the same wheel, and the history shows who spun what. Names you add here are ready for people to tap when they join. Playing too? Add your own name as “This is me”.'
    : 'Each player works through their own copy of the wheel. Names you add here are ready for people to tap when they join. Playing too? Add your own name as “This is me”.';
}

// ---------------------------------------------------------------- joining (online wheels)

function joiningSection(wheel) {
  return `
    <h3>Joining</h3>
    <div class="row wrap">
      <button type="button" class="btn primary" id="p-invite">${icon('qr-code', { size: 18 })} Show QR code</button>
    </div>
    <div class="toggles">
      <label class="switch"><input type="checkbox" id="p-join-open"><span>Let new people join</span></label>
    </div>
    <p class="hint">Turn this off once everyone's in. If the QR code got shared somewhere it shouldn't have, make a new one: the old code stops working.</p>
    <button type="button" class="btn small" id="p-new-code">New QR code</button>`;
}

function bindJoining(view, wheel) {
  const run = async (name, args) => {
    try {
      await hostAction(wheel, name, args);
    } catch (err) {
      alertDialog(err.message, { title: "That didn't work" });
    }
    if (store.getWheel(wheel.id)) refresh(view);
  };
  $('#p-invite', view.body).addEventListener('click', () => showInvite(wheel));
  const open = $('#p-join-open', view.body);
  open.checked = wheel.online.joinOpen;
  open.addEventListener('change', () => run('set-join-open', { open: open.checked }));
  $('#p-new-code', view.body).addEventListener('click', async () => {
    const ok = await confirmDialog('Make a new QR code? The old one (and its link) stops working; people who already joined stay in.', {
      title: 'New QR code?',
      ok: 'Make a new one',
    });
    if (ok) await run('rotate-code');
  });
}

// ---------------------------------------------------------------- player list

/** "You" / "Joined" / "Not joined yet" for online wheels, with what the host can do about it. */
function claimStatus(wheel, player) {
  if (!wheel.online) return '';
  if (store.isHostPlayer(wheel, player.id)) {
    return '<span class="claim joined">You</span><button type="button" class="btn small" data-not-me>Not me</button>';
  }
  if (player.claimed) return '<span class="claim joined">Joined</span><button type="button" class="btn small" data-release>Release</button>';
  return `<span class="claim">Not joined yet</span>${wheel.online.hostPlayerId ? '' : '<button type="button" class="btn small" data-me>This is me</button>'}`;
}

/** Make a name the host's own (or none): it's theirs to spin, and nobody else can join as it. */
async function setHostPlayer(view, wheel, playerId) {
  try {
    await hostAction(wheel, 'set-host-player', { playerId });
    if (playerId) store.setActivePlayer(wheel, playerId);
  } catch (err) {
    alertDialog(err.message, { title: "That didn't work" });
  }
  view.changed();
  refresh(view);
}

function renderPlayerList(view, wheel) {
  const list = $('#p-list', view.body);
  list.innerHTML = wheel.players
    .map(
      (player, i) => `
      <li data-id="${escapeHtml(player.id)}">
        <input class="p-name" maxlength="${store.MAX_NAME_LENGTH}" aria-label="Name of player ${i + 1}">
        ${claimStatus(wheel, player)}
        ${listItemControls(displayName(player), i, wheel.players.length)}
      </li>`,
    )
    .join('');
  list.querySelectorAll('.p-name').forEach((input, i) => (input.value = wheel.players[i].name));

  list.addEventListener('input', (event) => {
    const id = event.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    store.renamePlayer(wheel, id, event.target.value);
    view.changedSoon();
  });

  list.addEventListener('click', (event) => {
    const id = event.target.closest('[data-id]')?.dataset.id;
    if (event.target.closest('[data-me]')) setHostPlayer(view, wheel, id);
    else if (event.target.closest('[data-not-me]')) setHostPlayer(view, wheel, null);
  });

  list.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-release]')) return;
    const player = store.findPlayer(wheel, event.target.closest('[data-id]').dataset.id);
    const ok = await confirmDialog(
      `Release ${displayName(player)}'s name? The phone that joined as ${displayName(player)} is signed out, and their progress stays. Then they (or a new phone) can scan the QR code and tap the name again.`,
      { title: 'Release name?', ok: 'Release' },
    );
    if (!ok || !store.getWheel(wheel.id)) return;
    try {
      await hostAction(wheel, 'release', { playerId: player.id });
    } catch (err) {
      alertDialog(err.message, { title: "Couldn't release it" });
    }
    refresh(view);
  });

  onListItemAction(list, {
    onMove(id, delta) {
      store.movePlayer(wheel, id, delta);
      view.changed();
      refresh(view);
    },
    async onDelete(id) {
      const player = store.findPlayer(wheel, id);
      const becomesShared = !wheel.online && wheel.players.length === 1 ? ' With no players left, it becomes a shared wheel.' : '';
      const undo = wheel.online
        ? player.claimed
          ? ' Their phone is signed out.'
          : ''
        : ' (A snapshot is kept, so this can be undone from Backup.)';
      const ok = await confirmDialog(`Remove ${displayName(player)} and their spins on this wheel?${becomesShared}${undo}`, {
        title: 'Remove player?',
        ok: 'Remove',
        danger: true,
      });
      const current = store.getWheel(wheel.id);
      if (!ok || !current) return;
      store.removePlayer(current, id);
      view.changed();
      refresh(view);
    },
  });
}

function addPlayerForm(wheel) {
  if (!store.canAddPlayer(wheel)) {
    return `<p class="hint">This wheel has the most players allowed (${store.MAX_PLAYERS}).</p>`;
  }
  return `
    <form class="settings-form" id="p-add">
      <h3>${wheel.online ? 'Add a name' : 'Add a player'}</h3>
      <div class="field">
        <label for="p-name">Name</label>
        <input id="p-name" maxlength="${store.MAX_NAME_LENGTH}" required placeholder="e.g. Lily">
      </div>
      ${
        wheel.online && !wheel.online.hostPlayerId
          ? `<div class="toggles"><label class="switch"><input type="checkbox" id="p-me"><span>This is me: I'm playing too, from this phone</span></label></div>`
          : ''
      }
      <button class="btn primary">${wheel.online ? 'Add name' : 'Add player'}</button>
    </form>`;
}

function bindAddPlayer(view, wheel) {
  $('#p-add', view.body)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#p-name', view.body).value.trim();
    if (!name) return;
    // On this device, the first player turns a shared wheel into a per-player one, which
    // clears the shared spins.
    const sharedSpins = !wheel.online && store.isShared(wheel) ? wheel.spins.length : 0;
    if (sharedSpins) {
      const ok = await confirmDialog(
        `Adding a player gives everyone their own progress, so this wheel's ${plural(sharedSpins, 'shared spin')} will be cleared. (A snapshot is kept.)`,
        { title: 'Add the first player?', ok: 'Add player' },
      );
      if (!ok || !store.getWheel(wheel.id)) return;
    }
    const player = store.addPlayer(store.getWheel(wheel.id), name);
    if ($('#p-me', view.body)?.checked) return setHostPlayer(view, wheel, player.id);
    view.changed();
    refresh(view);
  });
}
