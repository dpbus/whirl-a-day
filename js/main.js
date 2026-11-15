// Entry point: renders the main screen (the active wheel) and runs spins.
//
// Naming: `wheel` is always a wheel's data (from state.js); `wheelView` is the canvas that draws it.
import * as store from './state.js';
import { applyTheme } from './themes.js';
import { WheelView } from './wheel.js';
import * as fx from './effects.js';
import { discardSettings, initSettings, openSettings, openWelcome } from './settings/index.js';
import { alertDialog } from './dialogs.js';
import { icon, hydrateIcons } from './icons.js';
import { wheelButton } from './templates.js';
import { $, displayName, escapeHtml, formatDay, prefersReducedMotion, randomInt, todayKey } from './util.js';

const APP_NAME = 'Whirl-a-Day';

const els = {
  title: $('#wheel-title'),
  switcher: $('#wheel-switcher'),
  players: $('#players'),
  canvas: $('#wheel'),
  pointer: $('#pointer'),
  spinBtn: $('#spin-btn'),
  status: $('#status'),
  progress: $('#progress'),
  progressTitle: $('#progress-title'),
  history: $('#history'),
  settingsBtn: $('#settings-btn'),
  ambient: $('#ambient'),
  confetti: $('#confetti'),
  result: $('#result-dialog'),
  wheelsMenu: $('#wheels-dialog'),
  wheelsList: $('#wheels-menu-list'),
  warning: $('#storage-warning'),
};

let wheelView;
let theme; // the active theme object (colors, sounds, confetti)
let themeId = null;
let spinning = false;
let syncAfterSpin = false;
let currentDay = todayKey();

function init() {
  hydrateIcons();
  store.load();
  store.dailySnapshot();
  store.requestPersistentStorage();
  if (store.getState().settings.sound) fx.preloadSounds();
  wheelView = new WheelView(els.canvas, { onTick });
  initSettings({ onChange: render, syncFromStorage });
  bindEvents();
  render();
  if (!store.getState().wheels.length && store.getLoadProblem() !== 'newer-version') openWelcome();
  announceLoadProblem();

  // Labels were measured with the fallback font until the web font arrives.
  document.fonts?.ready.then(() => wheelView.invalidateLabels());
  setInterval(checkNewDay, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      store.flushSave(); // don't lose a half-typed edit if the app is closed
      return;
    }
    syncFromStorage();
    checkNewDay();
  });
  window.addEventListener('pagehide', () => store.flushSave());
  // Another tab/window of the app changed the data: load it so we never save over it.
  window.addEventListener('storage', (event) => {
    if (event.key === store.STORAGE_KEY || event.key === null) syncFromStorage();
  });
  // A page restored from the back/forward cache may be holding old data.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) syncFromStorage();
  });
  registerServiceWorker();
}

function announceLoadProblem() {
  const problem = store.getLoadProblem();
  if (problem !== 'unreadable' && problem !== 'unreadable-readonly') return;
  const from = store.getRecoveredFrom();
  const loaded = from
    ? `the automatic snapshot from ${new Date(from).toLocaleString()} was loaded`
    : 'there was no snapshot to fall back on, so the app started empty';
  const kept =
    problem === 'unreadable'
      ? 'A copy of the unreadable data was kept'
      : "There wasn't room to copy the unreadable data, so nothing will be saved until it's dealt with";
  alertDialog(`The saved progress on this device couldn't be read, so ${loaded}. ${kept}; see Settings → Backup.`, {
    title: 'Saved progress needs attention',
  });
}

/** Reload from storage if another copy of the app changed it. Returns true if it reloaded. */
function syncFromStorage() {
  if (!store.storageChangedElsewhere()) return false;
  if (spinning) {
    syncAfterSpin = true;
    return false;
  }
  // Open dialogs hold references to the old data, so close them (settings without saving).
  // The welcome and result dialogs are safe to leave open.
  discardSettings();
  for (const dialog of document.querySelectorAll('dialog[open]')) {
    if (dialog !== els.result && !dialog.classList.contains('welcome')) dialog.close();
  }
  store.load();
  render();
  return true;
}

/** Use the active wheel's theme (or the app default before any wheel exists). */
function syncTheme() {
  const wanted = store.activeWheel()?.theme ?? store.getState().settings.theme;
  if (wanted === themeId) return;
  themeId = wanted;
  theme = applyTheme(wanted);
  wheelView.setTheme(theme.wheel);
  fx.setAmbient(els.ambient, theme.ambient);
}

function bindEvents() {
  els.spinBtn.addEventListener('click', spin);
  els.canvas.addEventListener('click', spin);
  els.settingsBtn.addEventListener('click', () => {
    if (!spinning) openSettings();
  });
  els.switcher.addEventListener('click', () => {
    if (!spinning) openWheelsMenu();
  });

  els.players.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const wheel = store.activeWheel();
    if (spinning || !button || !wheel) return;
    if (button.hasAttribute('data-add')) {
      openSettings('players');
    } else {
      store.setActivePlayer(wheel, button.dataset.id);
      render();
    }
  });

  els.history.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-option]');
    const wheel = store.activeWheel();
    if (spinning || !chip || !wheel) return;
    const progress = store.activeProgress(wheel);
    const option = wheel.options.find((o) => o.id === chip.dataset.option);
    const entry = progress.history.findLast((h) => h.optionId === chip.dataset.option);
    if (option && entry) showResult(wheel, progress, option, { entry });
  });

  els.result.addEventListener('close', () => {
    document.body.append(els.confetti);
    if (syncAfterSpin) {
      syncAfterSpin = false;
      if (syncFromStorage()) return;
    }
    render();
  });

  // Wheels menu: switching wheels is open to everyone; making one goes through settings (PIN).
  els.wheelsList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-wheel]');
    if (!item) return;
    store.setActiveWheel(item.dataset.wheel);
    els.wheelsMenu.close();
    render();
  });
  $('#wheels-new').addEventListener('click', () => {
    els.wheelsMenu.close();
    openSettings('wheels');
  });
  $('#wheels-close').addEventListener('click', () => els.wheelsMenu.close());
}

// ---------------------------------------------------------------- Rendering

function render() {
  // While spinning, the result is already saved: redrawing now would reveal it early.
  // The result dialog's close handler renders once the spin is over.
  if (spinning) return;
  syncTheme();
  renderWarnings();
  const wheel = store.activeWheel();
  renderPlayers(wheel);

  if (!wheel) {
    els.title.textContent = APP_NAME;
    document.title = APP_NAME;
    wheelView.setLabels([]);
    els.spinBtn.disabled = true;
    els.status.textContent = store.getLoadProblem() === 'newer-version' ? '' : 'Open Settings to make a wheel.';
    els.progress.hidden = true;
    return;
  }

  const progress = store.activeProgress(wheel);
  els.title.textContent = store.wheelTitle(wheel);
  document.title = `${store.wheelTitle(wheel)} · ${APP_NAME}`;
  wheelView.setLabels(store.spinPool(wheel, progress).map((o) => o.label));
  renderStatus(wheel, progress);
  renderProgress(wheel, progress);
}

function renderWarnings() {
  const messages = {
    unavailable: "⚠️ This browser is blocking storage (private browsing?), so spins won't be remembered.",
    'unreadable-readonly': "⚠️ Saved data couldn't be read and storage is full, so changes aren't being saved. See Settings → Backup.",
    'newer-version': '⚠️ This data was saved by a newer version of Whirl-a-Day. Reload the page to update the app.',
  };
  let message = messages[store.getLoadProblem()] ?? '';
  if (!message && !store.saveHealthy()) {
    message = "⚠️ Couldn't save the latest change on this device. Download a backup from Settings → Backup.";
  }
  els.warning.textContent = message;
  els.warning.hidden = !message;

}

/** One button per player (pressed = selected). Shared wheels (no players) show none. */
function renderPlayers(wheel) {
  els.players.hidden = !wheel || store.isShared(wheel);
  if (els.players.hidden) {
    els.players.innerHTML = '';
    return;
  }
  const selected = store.activePlayer(wheel);
  const badge = (player) => {
    if (!wheel.spinsPerDay) return '';
    return store.spinStatus(wheel, player).ok
      ? '<span class="tab-badge ready" aria-hidden="true"></span><span class="visually-hidden">(ready to spin)</span>'
      : '<span class="tab-badge done" aria-hidden="true">✓</span><span class="visually-hidden">(done for today)</span>';
  };
  els.players.innerHTML =
    wheel.players
      .map(
        (player) => `
        <button type="button" class="tab" aria-pressed="${player.id === selected.id}" data-id="${escapeHtml(player.id)}">
          ${escapeHtml(displayName(player))}${badge(player)}
        </button>`,
      )
      .join('') + `<button type="button" class="tab tab-add" data-add aria-label="Add player" title="Add player">${icon('plus')}</button>`;
}

function renderStatus(wheel, progress) {
  const status = store.spinStatus(wheel, progress);
  const player = store.activePlayer(wheel);
  // "Ready for today's spin, Ava!" for a player; "Ready for today's spin!" for a shared wheel.
  const say = (text) => `${text}${player ? `, ${displayName(player)}` : ''}!`;

  els.spinBtn.disabled = !status.ok;
  els.spinBtn.textContent = status.reason === 'locked' ? 'See you tomorrow!' : 'Spin!';

  const manySpins = wheel.spinsPerDay > 1 || store.bonusToday(progress) > 0;
  const messages = {
    empty: 'This wheel has no options yet. Add some in Settings.',
    done: `${say('All done')} Every one has been spun. 🎉`,
    locked: `${say(`That's ${manySpins ? 'all the spins' : 'the spin'} for today`)} Come back tomorrow. 🌙`,
  };
  els.status.textContent = status.ok ? readyMessage(wheel, progress, say) : messages[status.reason];
}

function readyMessage(wheel, progress, say) {
  if (!wheel.spinsPerDay) return '';
  const left = store.spinsLeftToday(wheel, progress);
  const usedSome = store.spinsToday(progress) > 0;
  if (left === 1) return usedSome ? say('One more spin today') : say("Ready for today's spin");
  return say(usedSome ? `${left} spins left today` : `${left} spins today`);
}

function renderProgress(wheel, progress) {
  if (!wheel.options.length) {
    els.progress.hidden = true;
    return;
  }
  els.progress.hidden = false;
  if (wheel.removeAfterSpin) renderOpenedGrid(wheel, progress);
  else renderRecentSpins(progress);
}

/** Every option as a tile; spun ones are "opened" and can be tapped to see the result again. */
function renderOpenedGrid(wheel, progress) {
  const opened = store.openedOptions(wheel, progress);
  const today = todayKey();
  els.progressTitle.textContent = `${opened.size} of ${wheel.options.length} opened`;
  els.history.className = 'history-grid';
  els.history.innerHTML = wheel.options
    .map((option) => {
      const entry = opened.get(option.id);
      const classes = ['chip', entry && 'opened', entry?.date === today && 'today', option.label.length > 3 && 'long'].filter(Boolean).join(' ');
      const label = `<span class="chip-label">${escapeHtml(option.label)}</span>`;
      return entry
        ? `<button type="button" class="${classes}" data-option="${escapeHtml(option.id)}" title="Spun ${formatDay(entry.date)}">${label}<small>${formatDay(entry.date)}</small></button>`
        : `<div class="${classes}">${label}</div>`;
    })
    .join('');
}

function renderRecentSpins(progress) {
  els.progressTitle.textContent = 'Recent spins';
  els.history.className = '';
  const recent = progress.history.slice(-10).reverse();
  els.history.innerHTML = recent.length
    ? `<ul class="history-list">${recent.map((h) => `<li><span>${escapeHtml(h.label)}</span><small>${formatDay(h.date)}</small></li>`).join('')}</ul>`
    : '<p class="empty-note">No spins yet.</p>';
}

function openWheelsMenu() {
  const { wheels } = store.getState();
  const active = store.activeWheel();
  els.wheelsList.innerHTML = wheels.length
    ? wheels.map((wheel) => `<li>${wheelButton(wheel, { current: wheel.id === active?.id, attrs: `data-wheel="${escapeHtml(wheel.id)}"` })}</li>`).join('')
    : '<li class="empty-note">No wheels yet.</li>';
  els.wheelsMenu.showModal();
}

// ---------------------------------------------------------------- Spinning

async function spin() {
  if (spinning) return;
  // If another copy of the app spun meanwhile, pick up its data first (and re-check the limit).
  if (syncFromStorage()) return;
  const wheel = store.activeWheel();
  if (!wheel) return;
  const progress = store.activeProgress(wheel);
  if (!store.spinStatus(wheel, progress).ok) return;

  const { settings } = store.getState();
  if (settings.sound) fx.unlockAudio();

  // Decide the result first (fair, crypto-random), then animate to it.
  const pool = store.spinPool(wheel, progress);
  const index = randomInt(pool.length);
  const option = pool[index];

  spinning = true;
  document.body.classList.add('is-spinning');
  store.recordSpin(wheel, progress, option); // saved now, so refreshing mid-spin can't re-roll
  renderWarnings();
  els.spinBtn.disabled = true;
  els.status.textContent = 'Spinning…';

  const reducedMotion = prefersReducedMotion();
  const seconds = reducedMotion ? Math.min(settings.spinSeconds, 1.5) : settings.spinSeconds;
  try {
    await wheelView.spinTo(index, seconds * 1000, { turns: reducedMotion ? 1 : undefined });
  } finally {
    spinning = false;
    document.body.classList.remove('is-spinning');
  }
  showResult(wheel, progress, option, { celebrate: true });
}

function onTick() {
  const { sound, tickSound } = store.getState().settings;
  if (sound) fx.playTick(tickSound === 'auto' ? theme.tick : tickSound);
  els.pointer.classList.remove('flick');
  void els.pointer.offsetWidth; // restart the CSS animation
  els.pointer.classList.add('flick');
}

/** Show a result: right after a spin (`celebrate`), or again from a history tile (`entry`). */
function showResult(wheel, progress, option, { celebrate = false, entry = null } = {}) {
  if (els.result.open) return;
  const { settings } = store.getState();
  const player = progress === wheel.shared ? null : progress;
  const who = player ? displayName(player) : store.wheelTitle(wheel);
  $('#result-emoji').textContent = theme.resultEmoji;
  $('#result-kicker').textContent = celebrate ? (player ? `${who} got…` : 'And the wheel says…') : `${who} · ${formatDay(entry.date)}`;
  $('#result-label').textContent = option.label;
  const surprise = $('#result-surprise');
  surprise.textContent = option.surprise;
  surprise.hidden = !option.surprise.trim();

  // Dialogs render above everything, so confetti must live inside the open dialog.
  els.result.append(els.confetti);
  els.result.showModal();
  if (celebrate) {
    if (settings.confetti) fx.confettiBurst(els.confetti, theme.confetti);
    if (settings.sound) fx.playMelody(theme.melody);
  }
}

// ---------------------------------------------------------------- Misc

function checkNewDay() {
  if (spinning || els.result.open) return;
  const day = todayKey();
  if (day !== currentDay) {
    currentDay = day;
    store.dailySnapshot();
    render();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
}

init();
