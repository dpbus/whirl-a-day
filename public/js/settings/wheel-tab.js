// Settings → This wheel: the wheel on screen. Title, theme, its two rules, its options, and
// playing online; rarer things (adding many options, managing from another device, stopping
// sharing, removing the wheel) are under "More options". Progress tools are in Players, except on
// a shared wheel with no players, which has nobody to list (see progress.js).
import * as store from '../state.js';
import { alertDialog, confirmDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { plural } from '../templates.js';
import { dayKey } from '../rules.js';
import * as online from '../store/online.js';
import { keepLocalCopy, putOnline, showHostLink, takeOffline } from '../online-ui.js';
import { $, displayName, escapeHtml, formatDay, range } from '../util.js';
import { bindThemeCards, themeCards } from './shared.js';
import { bindWheelRow, wheelRow } from './progress.js';

export function render(view) {
  const wheel = store.activeWheel();
  if (!store.canManage(wheel)) return renderJoined(view, wheel);
  view.body.innerHTML = `
    ${basicsSection(wheel)}
    ${optionsSection()}
    ${wheel.players.length ? '' : `<div id="w-progress"><h3>Progress</h3>${wheelRow(wheel) || '<p class="hint">No spins yet.</p>'}</div>`}
    ${onlineSection(wheel)}
    ${moreOptions(wheel)}
  `;
  bindBasics(view, wheel);
  bindOptions(view, wheel);
  const progress = $('#w-progress', view.body);
  if (progress) bindWheelRow(progress, wheel, () => changed(view));
  bindOnline(view, wheel);
  bindMoreOptions(view, wheel);
}

/** Re-render this tab without jumping back to the top. */
const refresh = (view) => view.showTab('wheel', { keepScroll: true });
const changed = (view) => {
  view.changed();
  refresh(view);
};

/** A wheel someone else hosts: who you are on it, and leaving it. */
function renderJoined(view, wheel) {
  const me = store.activePlayer(wheel);
  view.body.innerHTML = `
    <h3>“${escapeHtml(store.wheelTitle(wheel))}”</h3>
    <p>${me ? `You joined as <strong>${escapeHtml(displayName(me))}</strong>.` : 'You joined this wheel.'} Someone else runs it, so only they can change it.</p>
    <button type="button" class="btn danger" id="w-remove-wheel">Leave this wheel</button>
    <p class="hint">To come back later, scan the QR code again.</p>`;
  bindRemove(view, wheel);
}

// ================================================================ title, theme & rules

function basicsSection(wheel) {
  const perDayChoices = [[0, 'No limit'], ...range(1, store.MAX_SPINS_PER_DAY).map((n) => [Number(n), `${n} per day`])];
  return `
    <div class="field">
      <label for="w-title">Title</label>
      <input id="w-title" maxlength="${store.MAX_TITLE_LENGTH}" placeholder="e.g. 12 Days of Christmas">
    </div>

    <div class="field">
      <span class="field-label" id="w-theme-label">Theme</span>
      <div class="theme-grid compact" id="w-themes" role="group" aria-labelledby="w-theme-label">${themeCards(wheel.theme)}</div>
    </div>

    <div class="toggles">
      <label class="switch"><input type="checkbox" id="w-remove"><span>Each option can only come up once</span></label>
    </div>

    <div class="field">
      <label for="w-per-day">Spins per day</label>
      <select id="w-per-day">
        ${perDayChoices.map(([n, label]) => `<option value="${n}" ${n === (wheel.spinsPerDay ?? 0) ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <p class="hint">${wheel.sharedWheel && wheel.players.length ? 'For each person. ' : ''}For example, 2 per day gets through a 24-number wheel in 12 days.</p>
    </div>`;
}

function bindBasics(view, wheel) {
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
    changed(view);
  });

  $('#w-per-day', view.body).addEventListener('change', (event) => {
    store.setWheelProps(wheel, { spinsPerDay: Number(event.target.value) });
    changed(view);
  });
}

// ================================================================ options

function optionsSection() {
  return `
    <h3>Options <span class="count" id="w-count"></span></h3>
    <p class="hint">Each option can hide a surprise that's shown when it comes up, like “Hot cocoa movie night”.</p>
    <ol class="option-list" id="w-options"></ol>
    <button type="button" class="btn" id="w-add">${icon('plus', { size: 18 })} Add option</button>`;
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
    : '<li class="empty-note">No options yet. Add some below.</li>';

  // Values are set as properties, never through the HTML.
  list.querySelectorAll('.option-row').forEach((row, i) => {
    row.querySelector('.opt-label').value = options[i].label;
    row.querySelector('.opt-surprise').value = options[i].surprise;
  });
}

/** Add as many labels as fit, and say so if some didn't. */
function addOptions(view, wheel, labels) {
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
}

function bindOptions(view, wheel) {
  renderOptionRows(view, wheel);

  $('#w-add', view.body).addEventListener('click', () => {
    if (!addOptions(view, wheel, ['']).length) return;
    const labels = view.body.querySelectorAll('.opt-label');
    labels[labels.length - 1]?.focus();
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

// ================================================================ online

function onlineSection(wheel) {
  if (!wheel.online) {
    return `
      <h3>Play on everyone's own devices</h3>
      <p class="hint">Share one QR code, and everyone spins on their own phone, tablet or computer.</p>
      <button type="button" class="btn" id="w-put-online">${icon('cloud-upload', { size: 18 })} Put online…</button>`;
  }
  const status = online.connectionStatus(wheel);
  if (status === 'gone' || status === 'signed-out') {
    return `
      <h3>Online</h3>
      <p class="hint">${status === 'gone' ? 'This wheel was deleted from whirladay.com.' : "This device isn't signed in to this wheel anymore."} You can keep the last copy as a wheel on this device.</p>
      <button type="button" class="btn" id="w-keep-copy">Keep a copy on this device</button>`;
  }
  return `
    <h3>Online</h3>
    <p class="hint">${wheel.sharedWheel ? 'One wheel for everyone.' : 'Everyone has their own copy.'} Deleted automatically 60 days after it was last used.</p>`;
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
}

// ================================================================ more options

function moreOptions(wheel) {
  const host = store.roleOf(wheel) === 'host' && !store.isSignedOut(wheel) && online.connectionStatus(wheel) !== 'gone';
  return `
    <details class="more">
      <summary>More options</summary>

      <h3>Add several options at once</h3>
      <div class="row wrap">
        <span>Numbers</span>
        <input type="number" id="w-from" value="1" class="num-input" aria-label="From">
        <span>to</span>
        <input type="number" id="w-to" value="12" class="num-input" aria-label="To">
        <button type="button" class="btn" id="w-add-range">Add</button>
      </div>
      <textarea id="w-paste" rows="4" aria-label="Options to add, one per line" placeholder="Or paste a list, one option per line"></textarea>
      <button type="button" class="btn" id="w-add-paste">Add list</button>

      ${
        host
          ? `<h3>Manage from another device</h3>
             <p class="hint">Get a private link that opens this wheel, with all its controls, on another phone or computer. Save it somewhere safe in case you lose this device.</p>
             <button type="button" class="btn" id="w-host-link">${icon('link', { size: 18 })} Get the link</button>

             <h3>Stop sharing online</h3>
             <p class="hint">Deletes the wheel from whirladay.com so nobody else can use it, and keeps it on this device with everyone's progress.</p>
             <button type="button" class="btn danger" id="w-take-offline">Stop sharing…</button>`
          : ''
      }

      <h3>Remove this wheel</h3>
      <p class="hint">${
        wheel.online
          ? 'Removes it from this device only. It stays online for everyone else until it expires.'
          : 'Removes it and everyone’s progress from this device. You can bring it back from Backup.'
      }</p>
      <button type="button" class="btn danger" id="w-remove-wheel">${icon('trash-2', { size: 18 })} Remove wheel</button>
    </details>`;
}

function bindMoreOptions(view, wheel) {
  $('#w-add-range', view.body).addEventListener('click', () => {
    const from = Math.trunc(Number($('#w-from', view.body).value));
    const to = Math.trunc(Number($('#w-to', view.body).value));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from >= store.MAX_OPTIONS) {
      alertDialog(`Pick a "from" and "to" with "to" at least as big as "from" (up to ${store.MAX_OPTIONS} numbers).`);
      return;
    }
    addOptions(view, wheel, range(from, to));
  });
  $('#w-add-paste', view.body).addEventListener('click', () => {
    const area = $('#w-paste', view.body);
    addOptions(view, wheel, area.value.split('\n').map((line) => line.trim()).filter(Boolean));
    area.value = '';
  });
  $('#w-host-link', view.body)?.addEventListener('click', () => showHostLink(wheel));
  $('#w-take-offline', view.body)?.addEventListener('click', async () => {
    if (await takeOffline(wheel)) refresh(view);
  });
  bindRemove(view, wheel);
}

function bindRemove(view, wheel) {
  $('#w-remove-wheel', view.body).addEventListener('click', async () => {
    const role = store.roleOf(wheel);
    const title = store.wheelTitle(wheel);
    const message =
      role === 'owner'
        ? `Remove “${title}” and everyone's progress on it? You can bring it back from Backup.`
        : role === 'host'
          ? `Remove “${title}” from this device? It stays online for everyone else until it expires. To manage it again you'd need its link from “Manage from another device”.`
          : `Leave “${title}”? To come back, scan the QR code again.`;
    const ok = await confirmDialog(message, { title: role === 'player' ? 'Leave wheel?' : 'Remove wheel?', ok: role === 'player' ? 'Leave' : 'Remove', danger: true });
    if (!ok || !store.getWheel(wheel.id)) return;
    store.removeWheel(wheel.id);
    view.changed();
    view.close();
  });
}
