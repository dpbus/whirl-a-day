// Small HTML snippets shared by the main screen and the settings dialog.
// Anything that came from a user (titles, names) is escaped here.
import * as store from './state.js';
import { getTheme } from './themes.js';
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
