// Progress tools (undo, extra spin, reset), shared by the This wheel and Players tabs.
//
// Where they live:
//   - a wheel with players: the Players tab. Each player's row has their own tools; a shared
//     wheel also gets a "Wheel progress" section, since its undo and reset are the wheel's.
//   - a shared wheel without players: the This wheel tab (there's no one to list).
import * as store from '../state.js';
import { confirmDialog } from '../dialogs.js';
import { plural } from '../templates.js';
import { dayKey } from '../rules.js';
import { displayName, escapeHtml, formatDay } from '../util.js';

const day = (wheel, spin) => formatDay(dayKey(spin.at, wheel.timeZone));
const optionLabel = (wheel, spin) => store.findOption(wheel, spin.optionId)?.label ?? 'a removed option';

/** e.g. "3 spins · last “7” on Dec 3 · today: 1 spun, 0 left (incl. 1 extra)" */
function summary(wheel, playerId, { spins = store.spinsFor(wheel, playerId), limit = true } = {}) {
  const last = spins.at(-1);
  const parts = [plural(spins.length, 'spin')];
  if (last) parts.push(`last “${optionLabel(wheel, last)}” on ${day(wheel, last)}`);
  if (limit && wheel.spinsPerDay) {
    const bonus = store.bonusToday(wheel, playerId);
    parts.push(`today: ${store.spinsToday(wheel, playerId)} spun, ${store.spinsLeftToday(wheel, playerId)} left${bonus ? ` (incl. ${bonus} extra)` : ''}`);
  }
  return parts.join(' · ');
}

/** On a shared wheel, is the daily limit the whole group's (so extra spins are too)? */
const groupLimit = (wheel) => wheel.sharedWheel && wheel.sharedDailyLimit === true;

// ================================================================ the whole wheel (shared wheels)

export function wheelProgressSection(wheel) {
  const hasSpins = wheel.spins.length > 0;
  const perPlayerLimit = wheel.players.length > 0 && !groupLimit(wheel);
  return `
    <h3>${wheel.players.length ? 'Wheel progress' : 'Progress'}</h3>
    <p class="hint">${escapeHtml(summary(wheel, null, { spins: wheel.spins, limit: !perPlayerLimit }))}</p>
    <div class="row wrap">
      <button type="button" class="btn small" data-wheel-undo ${hasSpins ? '' : 'disabled'}>Undo last spin</button>
      ${wheel.spinsPerDay && !perPlayerLimit ? '<button type="button" class="btn small" data-wheel-extra>+1 spin today</button>' : ''}
      <button type="button" class="btn small danger" data-wheel-reset ${hasSpins ? '' : 'disabled'}>Reset wheel</button>
    </div>
    ${perPlayerLimit && wheel.spinsPerDay ? '<p class="hint">Extra spins are per person: use “+1 spin today” on their row.</p>' : ''}`;
}

/** Wire up wheelProgressSection inside `container`. `done()` redraws after a change. */
export function bindWheelProgress(container, wheel, done) {
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-wheel-undo], [data-wheel-extra], [data-wheel-reset]');
    if (!button) return;
    if (button.hasAttribute('data-wheel-extra')) {
      store.allowExtraSpin(wheel, null);
    } else if (button.hasAttribute('data-wheel-undo')) {
      const last = wheel.spins.at(-1);
      if (!last) return;
      const who = store.findPlayer(wheel, last.playerId);
      const ok = await confirmDialog(`Undo ${who ? `${displayName(who)}'s ` : ''}“${optionLabel(wheel, last)}” (${day(wheel, last)})? It goes back on the wheel and can be spun again.`, {
        title: 'Undo last spin?',
        ok: 'Undo',
      });
      // The data may have been reloaded while the question was open.
      const current = store.getWheel(wheel.id);
      if (!ok || !current) return;
      store.undoLastSpin(current, null);
    } else {
      const ok = await confirmDialog('Reset this wheel? Every option goes back on and the history is cleared.', {
        title: 'Reset wheel?',
        ok: 'Reset',
        danger: true,
      });
      const current = store.getWheel(wheel.id);
      if (!ok || !current) return;
      store.resetProgress(current, null);
    }
    done();
  });
}

// ================================================================ one player (a row in Players)

export function playerProgressRow(wheel, player) {
  const name = escapeHtml(displayName(player));
  if (wheel.sharedWheel) {
    // Their spins on the shared wheel; undo and reset are the wheel's (above the list).
    const own = wheel.spins.filter((s) => s.playerId === player.id);
    const extra = wheel.spinsPerDay && !groupLimit(wheel);
    return `
      <div class="p-progress">
        <span class="hint">${escapeHtml(summary(wheel, player.id, { spins: own, limit: extra }))}</span>
        ${extra ? `<div class="row wrap"><button type="button" class="btn small" data-extra aria-label="Give ${name} 1 extra spin today">+1 spin today</button></div>` : ''}
      </div>`;
  }
  const hasSpins = store.spinsFor(wheel, player.id).length > 0;
  return `
    <div class="p-progress">
      <span class="hint">${escapeHtml(summary(wheel, player.id))}</span>
      <div class="row wrap">
        <button type="button" class="btn small" data-undo ${hasSpins ? '' : 'disabled'} aria-label="Undo ${name}'s last spin">Undo last</button>
        ${wheel.spinsPerDay ? `<button type="button" class="btn small" data-extra aria-label="Give ${name} 1 extra spin today">+1 spin today</button>` : ''}
        <button type="button" class="btn small danger" data-reset ${hasSpins ? '' : 'disabled'} aria-label="Reset ${name}'s progress">Reset</button>
      </div>
    </div>`;
}

/** Wire up playerProgressRow buttons in a list of [data-id] rows. `done()` redraws after a change. */
export function bindPlayerProgress(list, wheel, done) {
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-undo], [data-extra], [data-reset]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    const player = store.findPlayer(wheel, id);
    if (!player) return;
    const name = displayName(player);

    if (button.hasAttribute('data-extra')) {
      store.allowExtraSpin(wheel, id);
    } else if (button.hasAttribute('data-undo')) {
      const last = store.spinsFor(wheel, id).at(-1);
      if (!last) return;
      const ok = await confirmDialog(`Undo ${name}'s “${optionLabel(wheel, last)}” (${day(wheel, last)})? It goes back on their wheel and can be spun again.`, {
        title: 'Undo last spin?',
        ok: 'Undo',
      });
      const current = store.getWheel(wheel.id);
      if (!ok || !current) return;
      store.undoLastSpin(current, id);
    } else {
      const ok = await confirmDialog(`Reset ${name}'s progress on this wheel? Every option goes back on and their history is cleared.`, {
        title: 'Reset progress?',
        ok: 'Reset',
        danger: true,
      });
      const current = store.getWheel(wheel.id);
      if (!ok || !current) return;
      store.resetProgress(current, id);
    }
    done();
  });
}

