// Small HTML snippets shared by the main screen and the settings dialog.
// Anything that came from a user (titles, names) is escaped here.
import * as store from './state.js';
import { getTheme } from './themes.js';
import { icon } from './icons.js';
import { displayName, escapeHtml } from './util.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Who spins a wheel: "Ava, Ben", "Everyone", or for online wheels e.g. "Online · You're Ava". */
export function whoSpins(wheel) {
  const names = wheel.players.length ? wheel.players.map(displayName).join(', ') : 'Everyone';
  if (!wheel.online) return names;
  if (wheel.online.role === 'player') {
    const me = wheel.players.find((p) => p.id === wheel.online.playerId);
    return me ? `Online · You're ${displayName(me)}` : 'Online';
  }
  return `Online · ${wheel.players.length ? names : 'Nobody has joined yet'}`;
}

/** A button showing a wheel's theme emoji, title and who spins it. `attrs` is trusted markup. */
export function wheelButton(wheel, { current = false, attrs = '' } = {}) {
  return `
    <button type="button" class="wheel-row" ${attrs} ${current ? 'aria-current="true"' : ''}>
      <span class="theme-emoji" aria-hidden="true">${getTheme(wheel.theme).emoji}</span>
      <span class="wheel-row-text">
        <strong>${escapeHtml(store.wheelTitle(wheel))}</strong>
        <span class="hint">${escapeHtml(whoSpins(wheel))}</span>
      </span>
    </button>`;
}

/** Move up / move down / remove buttons for one item of a reorderable list. */
export function listItemControls(itemName, index, count) {
  const name = escapeHtml(itemName);
  return `
    <button type="button" class="icon-btn small" data-move="-1" aria-label="Move ${name} up" ${index === 0 ? 'disabled' : ''}>${icon('chevron-up', { size: 18 })}</button>
    <button type="button" class="icon-btn small" data-move="1" aria-label="Move ${name} down" ${index === count - 1 ? 'disabled' : ''}>${icon('chevron-down', { size: 18 })}</button>
    <button type="button" class="icon-btn small danger" data-delete aria-label="Remove ${name}">${icon('trash-2', { size: 18 })}</button>`;
}

/** Route clicks on listItemControls (and optional [data-open] buttons) in a list of [data-id] items. */
export function onListItemAction(list, { onMove, onDelete, onOpen }) {
  list.addEventListener('click', (event) => {
    const id = event.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    const move = event.target.closest('[data-move]');
    if (move) onMove(id, Number(move.dataset.move));
    else if (event.target.closest('[data-delete]')) onDelete(id);
    else if (onOpen && event.target.closest('[data-open]')) onOpen(id);
  });
}
