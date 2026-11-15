// Settings → Players: the active wheel's players (rename, reorder, remove, add).
import * as store from '../state.js';
import { confirmDialog } from '../dialogs.js';
import { listItemControls, onListItemAction, plural } from '../templates.js';
import { $, displayName, escapeHtml } from '../util.js';

export function render(view) {
  const wheel = store.activeWheel();
  view.body.innerHTML = `
    <h3>Players on “${escapeHtml(store.wheelTitle(wheel))}”</h3>
    <p class="hint">Each player has their own progress on this wheel. With no players, it's a shared wheel that everyone spins together.</p>
    ${wheel.players.length ? '<ul class="player-list" id="p-list"></ul>' : '<p class="hint"><em>No players: this is a shared wheel.</em></p>'}
    ${addPlayerForm(wheel)}
  `;
  if (wheel.players.length) renderPlayerList(view, wheel);
  bindAddPlayer(view, wheel);
}

const refresh = (view) => view.showTab('players', { keepScroll: true });

function renderPlayerList(view, wheel) {
  const list = $('#p-list', view.body);
  list.innerHTML = wheel.players
    .map(
      (player, i) => `
      <li data-id="${escapeHtml(player.id)}">
        <input class="p-name" maxlength="${store.MAX_NAME_LENGTH}" aria-label="Name of player ${i + 1}">
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

  onListItemAction(list, {
    onMove(id, delta) {
      store.movePlayer(wheel, id, delta);
      view.changed();
      refresh(view);
    },
    async onDelete(id) {
      const player = wheel.players.find((p) => p.id === id);
      const becomesShared = wheel.players.length === 1 ? ' With no players left, it becomes a shared wheel.' : '';
      const ok = await confirmDialog(
        `Remove ${displayName(player)} and their spins on this wheel?${becomesShared} (A snapshot is kept, so this can be undone from Backup.)`,
        { title: 'Remove player?', ok: 'Remove', danger: true },
      );
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
      <h3>Add a player</h3>
      <div class="field">
        <label for="p-name">Name</label>
        <input id="p-name" maxlength="${store.MAX_NAME_LENGTH}" required placeholder="e.g. Lily">
      </div>
      <button class="btn primary">Add player</button>
    </form>`;
}

function bindAddPlayer(view, wheel) {
  $('#p-add', view.body)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#p-name', view.body).value.trim();
    if (!name) return;
    // The first player turns a shared wheel into a per-player one, which clears the shared spins.
    const sharedSpins = store.isShared(wheel) ? wheel.shared.history.length : 0;
    if (sharedSpins) {
      const ok = await confirmDialog(
        `Adding a player gives everyone their own progress, so this wheel's ${plural(sharedSpins, 'shared spin')} will be cleared. (A snapshot is kept.)`,
        { title: 'Add the first player?', ok: 'Add player' },
      );
      if (!ok || !store.getWheel(wheel.id)) return;
    }
    store.addPlayer(store.getWheel(wheel.id), name);
    view.changed();
    refresh(view);
  });
}
