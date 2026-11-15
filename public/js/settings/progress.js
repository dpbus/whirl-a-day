// Progress, for the Players and This wheel tabs: short summaries, and the progress actions
// (undo, extra spin, start over) offered in each row's "⋯" menu.
//
// `playerId` null means the whole wheel: a shared wheel's undo and start over are the wheel's.
import * as store from '../state.js';
import { confirmDialog, menuDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { plural } from '../templates.js';
import { dayKey } from '../rules.js';
import { displayName, escapeHtml, formatDay } from '../util.js';

const day = (wheel, spin) => formatDay(dayKey(spin.at, wheel.timeZone));
const optionLabel = (wheel, spin) => store.findOption(wheel, spin.optionId)?.label ?? 'a removed option';

/** On a shared wheel, is the daily limit the whole group's (so extra spins are too)? */
const groupLimit = (wheel) => wheel.sharedWheel && wheel.sharedDailyLimit === true;

/** Does `playerId` (null: the whole wheel) have their own daily limit to top up? */
function hasOwnLimit(wheel, playerId) {
  if (!wheel.spinsPerDay) return false;
  if (playerId === null) return !wheel.players.length || groupLimit(wheel);
  return !groupLimit(wheel);
}

/** The spins counted for a row: the player's own (even on a shared wheel), or all of them. */
const rowSpins = (wheel, playerId) => (playerId === null ? wheel.spins : wheel.spins.filter((s) => s.playerId === playerId));

/** e.g. "3 spins · 1 left today", "5 spins · last: Pasta", "No spins yet" */
export function summary(wheel, playerId) {
  const spins = rowSpins(wheel, playerId);
  const parts = [spins.length ? plural(spins.length, 'spin') : 'No spins yet'];
  if (hasOwnLimit(wheel, playerId)) {
    const left = store.spinsLeftToday(wheel, playerId);
    parts.push(left ? `${left} left today` : 'done for today');
  } else if (spins.length) {
    parts.push(`last: ${optionLabel(wheel, spins.at(-1))}`);
  }
  return parts.join(' · ');
}

/** The progress actions that make sense for this row right now. */
export function progressActions(wheel, playerId) {
  const whole = playerId === null;
  // On a shared wheel, undo and start over belong to the whole wheel's row.
  const ownProgress = whole || !wheel.sharedWheel;
  const hasSpins = (whole ? wheel.spins : store.spinsFor(wheel, playerId)).length > 0;
  const items = [];
  if (ownProgress && hasSpins) items.push({ id: 'undo', label: 'Undo last spin' });
  if (hasOwnLimit(wheel, playerId)) items.push({ id: 'extra', label: 'Give an extra spin today' });
  if (ownProgress && hasSpins) items.push({ id: 'reset', label: whole ? 'Start the wheel over' : 'Start over', danger: true });
  return items;
}

/** Carry out a progress action (asking first where it can't be taken back). Returns true if done. */
export async function runProgressAction(wheel, playerId, action) {
  const player = store.findPlayer(wheel, playerId);
  const name = player ? displayName(player) : null;
  if (action === 'extra') {
    store.allowExtraSpin(wheel, playerId);
    return true;
  }
  if (action === 'undo') {
    const last = playerId === null ? wheel.spins.at(-1) : store.spinsFor(wheel, playerId).at(-1);
    if (!last) return false;
    const whose = store.findPlayer(wheel, last.playerId);
    const ok = await confirmDialog(
      `Take back ${whose ? `${displayName(whose)}'s ` : ''}“${optionLabel(wheel, last)}” from ${day(wheel, last)}? It goes back on the wheel and can come up again.`,
      { title: 'Undo last spin?', ok: 'Undo' },
    );
    // The data may have been reloaded while the question was open.
    const current = store.getWheel(wheel.id);
    if (!ok || !current) return false;
    store.undoLastSpin(current, playerId);
    return true;
  }
  if (action === 'reset') {
    const ok = await confirmDialog(
      name ? `Start ${name} over? All their options go back on and their history is cleared.` : 'Start the wheel over? Every option goes back on and the history is cleared.',
      { title: 'Start over?', ok: 'Start over', danger: true },
    );
    const current = store.getWheel(wheel.id);
    if (!ok || !current) return false;
    store.resetProgress(current, playerId);
    return true;
  }
  return false;
}

// ================================================================ the whole wheel's row

/** A row for a shared wheel's own progress, with a "⋯" menu. Wire it up with bindWheelRow(). */
export function wheelRow(wheel) {
  if (!progressActions(wheel, null).length && !wheel.spins.length) return '';
  return `
    <ul class="row-list">
      <li class="list-row">
        <span class="row-text"><strong>${wheel.players.length ? 'Everyone' : 'This wheel'}</strong><span class="hint">${escapeHtml(summary(wheel, null))}</span></span>
        ${progressActions(wheel, null).length ? `<button type="button" class="icon-btn small" data-wheel-menu aria-label="Progress options">${icon('ellipsis', { size: 18 })}</button>` : ''}
      </li>
    </ul>`;
}

export function bindWheelRow(container, wheel, done) {
  container.querySelector('[data-wheel-menu]')?.addEventListener('click', async () => {
    const action = await menuDialog(wheel.players.length ? 'Everyone' : 'This wheel', progressActions(wheel, null));
    if (action && (await runProgressAction(wheel, null, action))) done();
  });
}
