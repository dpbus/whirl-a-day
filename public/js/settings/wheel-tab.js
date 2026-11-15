// Settings → This wheel: the active wheel's title, theme and rules, its options, putting it
// online, and removing it. (Progress tools: see progress.js.)
import * as store from '../state.js';
import { getPreset } from '../presets.js';
import { alertDialog, confirmDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { plural } from '../templates.js';
import { dayKey } from '../rules.js';
import * as online from '../store/online.js';
import { keepLocalCopy, putOnline, showHostLink, takeOffline } from '../online-ui.js';
import { $, displayName, escapeHtml, formatDay, range } from '../util.js';
import { bindThemeCards, presetOptions, themeCards } from './shared.js';
import { bindWheelProgress, wheelProgressSection } from './progress.js';

export function render(view) {
  const wheel = store.activeWheel();
  if (!store.canManage(wheel)) return renderJoined(view, wheel);
  view.body.innerHTML = `
    ${rulesSection(wheel)}
    ${optionsSection()}
    <div id="w-progress">${wheel.players.length ? progressPointer() : wheelProgressSection(wheel)}</div>
    ${onlineSection(wheel)}
    ${removeSection(wheel)}
  `;
  bindRules(view, wheel);
  bindOptions(view, wheel);
  bindWheelProgress($('#w-progress', view.body), wheel, () => {
    view.changed();
    refresh(view);
  });
  $('#w-to-players', view.body)?.addEventListener('click', () => view.showTab('players'));
  bindOnline(view, wheel);
  bindRemove(view, wheel);
}

/** A wheel someone else hosts: who you are on it, and leaving it. */
function renderJoined(view, wheel) {
  const me = store.activePlayer(wheel);
  view.body.innerHTML = `
    <h3>“${escapeHtml(store.wheelTitle(wheel))}”</h3>
    <p>${me ? `You joined as <strong>${escapeHtml(displayName(me))}</strong>.` : 'You joined this wheel.'} It's hosted by someone else, so only they can change it.</p>
    ${removeSection(wheel)}`;
  bindRemove(view, wheel);
}

// ================================================================ remove / leave

function removeSection(wheel) {
  const role = store.roleOf(wheel);
  return `
    <h3>${role === 'player' ? 'Leave this wheel' : 'Remove this wheel'}</h3>
    <p class="hint">${
      role === 'owner'
        ? 'Removes it from this device with everyone’s progress. A snapshot is kept, so it can be undone from Backup.'
        : role === 'host'
          ? 'Removes it from this device only: it stays online for everyone else until it expires. To delete it from whirladay.com, take it offline first (above).'
          : 'Removes it from this device. To come back, scan the QR code again; the host may need to release your name first.'
    }</p>
    <button type="button" class="btn danger" id="w-remove-wheel">${icon('trash-2', { size: 18 })} ${role === 'player' ? 'Leave wheel' : 'Remove wheel'}</button>`;
}

function bindRemove(view, wheel) {
  $('#w-remove-wheel', view.body).addEventListener('click', async () => {
    const role = store.roleOf(wheel);
    const message =
      role === 'owner'
        ? `Remove “${store.wheelTitle(wheel)}” and everyone's progress on it? (A snapshot is kept, so this can be undone from Backup.)`
        : role === 'host'
          ? `Remove “${store.wheelTitle(wheel)}” from this device? It stays online for everyone else until it expires, and you can only manage it again with its host link.`
          : `Leave “${store.wheelTitle(wheel)}”? To come back, scan the QR code again.`;
    const ok = await confirmDialog(message, { title: role === 'player' ? 'Leave wheel?' : 'Remove wheel?', ok: role === 'player' ? 'Leave' : 'Remove', danger: true });
    if (!ok || !store.getWheel(wheel.id)) return;
    store.removeWheel(wheel.id);
    view.changed();
    view.close();
  });
}

/** Re-render this tab without jumping back to the top. */
const refresh = (view) => view.showTab('wheel', { keepScroll: true });

// ================================================================ title, theme & rules

function rulesSection(wheel) {
  const perDayChoices = [[0, 'No limit'], ...range(1, store.MAX_SPINS_PER_DAY).map((n) => [Number(n), `${n} per day`])];
  return `
    <div class="field">
      <label for="w-title">Wheel title</label>
      <input id="w-title" maxlength="${store.MAX_TITLE_LENGTH}" placeholder="e.g. 12 Days of Christmas">
    </div>

    <div class="field">
      <span class="field-label" id="w-theme-label">Theme</span>
      <div class="theme-grid compact" id="w-themes" role="group" aria-labelledby="w-theme-label">${themeCards(wheel.theme)}</div>
    </div>

    <div class="field">
      <label for="w-preset">Start from a preset</label>
      <div class="row">
        <select id="w-preset"><option value="">Choose…</option>${presetOptions()}</select>
        <button type="button" class="btn" id="w-preset-load">Load</button>
      </div>
      <p class="hint">Replaces this wheel's options and starts everyone's progress on it over.</p>
    </div>

    <div class="toggles">
      <label class="switch"><input type="checkbox" id="w-remove"><span>Remove each result once it's been spun</span></label>
    </div>

    <div class="field">
      <label for="w-per-day">Spins per day</label>
      <select id="w-per-day">
        ${perDayChoices.map(([n, label]) => `<option value="${n}" ${n === (wheel.spinsPerDay ?? 0) ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <p class="hint">For example, 2 per day gets through a 24-number wheel in 12 days.</p>
    </div>`;
}

function bindRules(view, wheel) {
  const title = $('#w-title', view.body);
  title.value = wheel.title;
  title.addEventListener('input', () => {
    store.setWheelProps(wheel, { title: title.value });
    view.changedSoon();
  });

  bindThemeCards($('#w-themes', view.body), (theme) => {
    store.setWheelProps(wheel, { theme });
    view.changed();
  });

  const removeAfterSpin = $('#w-remove', view.body);
  removeAfterSpin.checked = wheel.removeAfterSpin;
  removeAfterSpin.addEventListener('change', () => {
    store.setWheelProps(wheel, { removeAfterSpin: removeAfterSpin.checked });
    view.changed();
    refresh(view);
  });

  $('#w-per-day', view.body).addEventListener('change', (event) => {
    store.setWheelProps(wheel, { spinsPerDay: Number(event.target.value) });
    view.changed();
    refresh(view);
  });

  $('#w-preset-load', view.body).addEventListener('click', async () => {
    const presetId = $('#w-preset', view.body).value;
    if (!presetId) return;
    const ok = await confirmDialog(
      `Replace the options on “${store.wheelTitle(wheel)}” with “${getPreset(presetId).name}” and start everyone's progress on it over?`,
      { title: 'Load preset?', ok: 'Replace', danger: true },
    );
    const current = store.getWheel(wheel.id);
    if (!ok || !current) return;
    store.loadPreset(current, presetId);
    view.changed();
    refresh(view);
  });
}

// ================================================================ options

function optionsSection() {
  return `
    <h3>Options <span class="count" id="w-count"></span></h3>
    <p class="hint">Optionally add a surprise to each — it's revealed when that option is spun (e.g. “Hot cocoa movie night”).</p>
    <ol class="option-list" id="w-options"></ol>
    <div class="row wrap">
      <button type="button" class="btn" id="w-add">${icon('plus', { size: 18 })} Add option</button>
    </div>
    <details class="more">
      <summary>Add several at once</summary>
      <div class="row wrap">
        <span>Numbers</span>
        <input type="number" id="w-from" value="1" class="num-input" aria-label="From">
        <span>to</span>
        <input type="number" id="w-to" value="12" class="num-input" aria-label="To">
        <button type="button" class="btn" id="w-add-range">Add</button>
      </div>
      <textarea id="w-paste" rows="4" aria-label="Options to add, one per line" placeholder="Or paste a list — one option per line"></textarea>
      <button type="button" class="btn" id="w-add-paste">Add list</button>
    </details>`;
}

function renderOptionRows(view, wheel) {
  const list = $('#w-options', view.body);
  const opened = store.openedOptions(wheel, store.activePlayerId(wheel));
  const { options } = wheel;

  $('#w-count', view.body).textContent = `(${options.length})`;
  list.innerHTML = options.length
    ? options
        .map((option, i) => {
          const entry = opened.get(option.id);
          return `
          <li class="option-row" data-id="${escapeHtml(option.id)}">
            <span class="opt-num" aria-hidden="true">${i + 1}</span>
            <input class="opt-label" maxlength="${store.MAX_LABEL_LENGTH}" placeholder="Option" aria-label="Option ${i + 1}">
            <button type="button" class="icon-btn small opt-del" aria-label="Remove option ${i + 1}">${icon('x', { size: 18 })}</button>
            <input class="opt-surprise" maxlength="${store.MAX_SURPRISE_LENGTH}" placeholder="🎁 Surprise (optional)" aria-label="Surprise for option ${i + 1}">
            ${entry ? `<span class="opt-status">✓ spun ${formatDay(dayKey(entry.at, wheel.timeZone))}</span>` : ''}
          </li>`;
        })
        .join('')
    : '<li class="empty-note">No options yet — add some below.</li>';

  // Values are set as properties, never through the HTML.
  list.querySelectorAll('.option-row').forEach((row, i) => {
    row.querySelector('.opt-label').value = options[i].label;
    row.querySelector('.opt-surprise').value = options[i].surprise;
  });
}

function bindOptions(view, wheel) {
  renderOptionRows(view, wheel);

  /** Add as many labels as fit, and say so if some didn't. */
  const add = (labels) => {
    if (!labels.length) return [];
    const room = store.optionRoom(wheel);
    if (labels.length > room) {
      alertDialog(`A wheel can have up to ${store.MAX_OPTIONS} options, so ${room ? `only the first ${plural(room, 'one')} fit` : "there's no room for more"}.`, {
        title: 'Wheel is full',
      });
    }
    const added = store.addOptions(wheel, labels);
    view.changed();
    renderOptionRows(view, wheel);
    return added;
  };

  $('#w-add', view.body).addEventListener('click', () => {
    if (!add(['']).length) return;
    const labels = view.body.querySelectorAll('.opt-label');
    labels[labels.length - 1]?.focus();
  });
  $('#w-add-range', view.body).addEventListener('click', () => {
    const from = Math.trunc(Number($('#w-from', view.body).value));
    const to = Math.trunc(Number($('#w-to', view.body).value));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from >= store.MAX_OPTIONS) {
      alertDialog(`Pick a "from" and "to" with "to" at least as big as "from" (up to ${store.MAX_OPTIONS} numbers).`);
      return;
    }
    add(range(from, to));
  });
  $('#w-add-paste', view.body).addEventListener('click', () => {
    const area = $('#w-paste', view.body);
    add(area.value.split('\n').map((line) => line.trim()).filter(Boolean));
    area.value = '';
  });

  // One delegated listener per event, so re-rendering the rows doesn't lose them.
  const list = $('#w-options', view.body);
  list.addEventListener('input', (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const field = event.target.classList.contains('opt-label') ? 'label' : 'surprise';
    store.updateOption(wheel, row.dataset.id, { [field]: event.target.value });
    view.changedSoon();
  });
  list.addEventListener('click', (event) => {
    const remove = event.target.closest('.opt-del');
    if (!remove) return;
    store.removeOption(wheel, remove.closest('[data-id]').dataset.id);
    view.changed();
    renderOptionRows(view, wheel);
  });
}

// ================================================================ progress
//
// With players, each one's progress tools are on their row in the Players tab. A shared wheel
// without players has nobody to list, so its tools are here.

function progressPointer() {
  return `
    <h3>Progress</h3>
    <p class="hint">To undo a spin, give an extra spin or reset progress, go to Players.</p>
    <button type="button" class="btn small" id="w-to-players">Go to Players</button>`;
}

// ================================================================ online

function onlineSection(wheel) {
  if (!wheel.online) {
    return `
      <h3>Play on everyone's own devices</h3>
      <p class="hint">Put this wheel online and everyone can spin on their own phone, tablet or computer: you share one QR code, and you see everyone's spins here.</p>
      <button type="button" class="btn" id="w-put-online">${icon('cloud-upload', { size: 18 })} Put online…</button>`;
  }
  const status = online.connectionStatus(wheel);
  if (status === 'gone' || status === 'signed-out') {
    return `
      <h3>Online</h3>
      <p class="hint">${status === 'gone' ? 'This wheel was deleted from whirladay.com.' : "This device isn't signed in to this wheel anymore. Open your host link here to manage it again."} You can keep the last copy as a wheel on this device.</p>
      <button type="button" class="btn" id="w-keep-copy">Keep a copy on this device</button>`;
  }
  return `
    <h3>Online</h3>
    <p class="hint">${wheel.sharedWheel ? 'One wheel for everyone: every spin plays on every screen.' : 'Everyone gets their own wheel.'} It lives on whirladay.com and is deleted automatically 60 days after it was last used.</p>
    <div class="toggles">
      ${wheel.sharedWheel
        ? `<label class="switch"><input type="checkbox" id="w-group-limit" ${wheel.spinsPerDay ? '' : 'disabled'}><span>The whole group shares the day's spins</span></label>`
        : '<label class="switch"><input type="checkbox" id="w-share-spins"><span>Players see each other’s spins</span></label>'}
    </div>
    ${wheel.sharedWheel && !wheel.spinsPerDay ? '' : `<p class="hint">${wheel.sharedWheel ? 'Off: each person gets the spins per day. On: that many for the whole group, first come, first served.' : 'Off: only you see everyone’s spins. On: each player also sees the others’ results (not their surprises).'}</p>`}
    <div class="row wrap">
      <button type="button" class="btn" id="w-host-link">${icon('link', { size: 18 })} Host link</button>
      <button type="button" class="btn danger" id="w-take-offline">Take offline…</button>
    </div>
    <p class="hint">The host link lets you manage this wheel from another device. Taking it offline deletes it from whirladay.com and keeps it here.</p>`;
}

function bindOnline(view, wheel) {
  $('#w-put-online', view.body)?.addEventListener('click', () => {
    view.close();
    putOnline(wheel);
  });
  $('#w-keep-copy', view.body)?.addEventListener('click', () => {
    keepLocalCopy(wheel);
    refresh(view);
  });
  const groupLimit = $('#w-group-limit', view.body);
  if (groupLimit) {
    groupLimit.checked = wheel.sharedDailyLimit === true;
    groupLimit.addEventListener('change', () => {
      store.setWheelProps(wheel, { sharedDailyLimit: groupLimit.checked });
      view.changed();
      refresh(view);
    });
  }
  const shareSpins = $('#w-share-spins', view.body);
  if (shareSpins) {
    shareSpins.checked = wheel.showSpinsToEveryone === true;
    shareSpins.addEventListener('change', () => {
      store.setWheelProps(wheel, { showSpinsToEveryone: shareSpins.checked });
      view.changed();
    });
  }
  $('#w-host-link', view.body)?.addEventListener('click', () => showHostLink(wheel));
  $('#w-take-offline', view.body)?.addEventListener('click', async () => {
    if (await takeOffline(wheel)) refresh(view);
  });
}
