// Entry point: renders the main screen (the active wheel) and runs spins.
//
// Naming: `wheel` is always a wheel's data (from state.js); `wheelView` is the canvas that draws it.
// A local wheel is spun right here. An online wheel is spun by the server, which tells every
// connected phone (store/online.js); each spin then plays here through the same animation.
import * as store from './state.js';
import * as online from './store/online.js';
import { dayKey } from './rules.js';
import { applyTheme } from './themes.js';
import { WheelView } from './wheel.js';
import * as fx from './effects.js';
import { initSettings, openSettings, openWelcome, refreshSettings } from './settings/index.js';
import { onNewWheel, openNewWheel } from './settings/new-wheel.js';
import { alertDialog, confirmDialog } from './dialogs.js';
import { icon, hydrateIcons } from './icons.js';
import { wheelButton } from './templates.js';
import { handleLinkInUrl, initOnlineUi, showInvite, statusText } from './online-ui.js';
import { $, displayName, escapeHtml, formatDay, prefersReducedMotion } from './util.js';

const APP_NAME = 'Whirl-a-Day';
const RESULT_MIN_MS = 2500; // with another spin queued, a result stays up at least this long

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
  inviteBtn: $('#invite-btn'),
  newWheelBtn: $('#new-wheel-btn'),
  ambient: $('#ambient'),
  confetti: $('#confetti'),
  result: $('#result-dialog'),
  wheelsMenu: $('#wheels-dialog'),
  wheelsList: $('#wheels-menu-list'),
  warning: $('#storage-warning'),
  onlineStatus: $('#online-status'),
  toast: $('#toast'),
};

let wheelView;
let theme; // the active theme object (colors, sounds, confetti)
let themeId = null;
let spinning = false; // the wheel is animating
let waitingForServer = false; // an online spin was asked for and not yet decided
let syncAfterSpin = false;
let currentDay = '';
const spinQueue = []; // online spins waiting to play, in order
let resultShownAt = 0;

function init() {
  hydrateIcons();
  store.load();
  store.dailySnapshot();
  store.requestPersistentStorage();
  if (store.getState().settings.sound) fx.preloadSounds();
  wheelView = new WheelView(els.canvas, { onTick });
  initSettings({ onChange: render, syncFromStorage });
  initOnlineUi({ onChange: render });
  onNewWheel(render);
  bindEvents();
  render();
  const openedFromLink = handleLinkInUrl();
  if (!openedFromLink && !store.getState().wheels.length && store.getLoadProblem() !== 'newer-version') openWelcome();
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
  // A QR code scanned while the app is already open.
  window.addEventListener('hashchange', () => handleLinkInUrl());
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
  if (spinning || waitingForServer) {
    syncAfterSpin = true;
    return false;
  }
  // Dialogs stay open: settings redraws from the fresh data, and every other dialog looks its
  // wheel up again by id when it acts.
  store.load();
  refreshSettings();
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

/** Keep a live connection to the wheel on screen, if it's an online one. */
function syncConnection(wheel) {
  online.connectTo(wheel, {
    onChange: render,
    onStatus: render,
    onSpun,
  });
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
  els.newWheelBtn.addEventListener('click', () => {
    if (!spinning) openNewWheel();
  });
  els.inviteBtn.addEventListener('click', () => {
    const wheel = store.activeWheel();
    if (!spinning && wheel?.online?.joinCode) showInvite(wheel);
  });

  els.players.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const wheel = store.activeWheel();
    if (spinning || waitingForServer || !button || !wheel) return;
    if (button.hasAttribute('data-add')) {
      openSettings('players');
    } else {
      store.setActivePlayer(wheel, button.dataset.id);
      render();
    }
  });

  els.history.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-spin]');
    const wheel = store.activeWheel();
    if (spinning || !chip || !wheel) return;
    const spin = wheel.spins.find((s) => s.id === chip.dataset.spin);
    const option = spin && store.findOption(wheel, spin.optionId);
    if (option) showResult(wheel, spin, option);
  });

  els.result.addEventListener('close', () => {
    document.body.append(els.confetti);
    if (syncAfterSpin && !spinQueue.length) {
      syncAfterSpin = false;
      if (syncFromStorage()) return;
    }
    render();
    playQueue();
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
    openNewWheel();
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
  syncConnection(wheel);
  renderOnlineStatus(wheel);
  // The host of an online wheel can always get the QR code back from the top bar.
  els.inviteBtn.hidden = !(store.roleOf(wheel) === 'host' && wheel.online.joinCode && wheel.online.token);
  renderPlayers(wheel);
  currentDay = dayKey(new Date(), wheel?.timeZone);

  // With no wheel yet, "New wheel" is the main thing to do.
  els.newWheelBtn.classList.toggle('primary', !wheel);
  if (!wheel) {
    els.title.textContent = APP_NAME;
    document.title = APP_NAME;
    wheelView.setLabels([]);
    els.spinBtn.disabled = true;
    els.status.textContent = store.getLoadProblem() === 'newer-version' ? '' : 'Make a wheel to get started.';
    els.progress.hidden = true;
    return;
  }

  const playerId = store.activePlayerId(wheel);
  els.title.textContent = store.wheelTitle(wheel);
  document.title = `${store.wheelTitle(wheel)} · ${APP_NAME}`;
  wheelView.setLabels(store.spinPool(wheel, playerId).map((o) => o.label));
  renderStatus(wheel, playerId);
  renderProgress(wheel, playerId);
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

function renderOnlineStatus(wheel) {
  const text = statusText(wheel, online.connectionStatus(wheel));
  els.onlineStatus.textContent = text;
  els.onlineStatus.hidden = !text;
}

/**
 * One button per player (pressed = selected). Not shown on a shared wheel without players, or
 * on a phone that joined an online wheel (it always spins as itself).
 */
function renderPlayers(wheel) {
  const role = store.roleOf(wheel);
  els.players.hidden = !wheel || role === 'player' || !wheel.players.length;
  if (els.players.hidden) {
    els.players.innerHTML = '';
    return;
  }
  const selected = store.activePlayer(wheel);
  const badge = (player) => {
    if (!wheel.spinsPerDay || wheel.sharedWheel) return '';
    return store.spinStatus(wheel, player.id).ok
      ? '<span class="tab-badge ready" aria-hidden="true"></span><span class="visually-hidden">(ready to spin)</span>'
      : '<span class="tab-badge done" aria-hidden="true">✓</span><span class="visually-hidden">(done for today)</span>';
  };
  els.players.innerHTML =
    wheel.players
      .map(
        (player) => `
        <button type="button" class="tab" aria-pressed="${player.id === selected?.id}" data-id="${escapeHtml(player.id)}">
          ${escapeHtml(displayName(player))}${store.isHostPlayer(wheel, player.id) ? ' <span class="tab-you">(you)</span>' : ''}${badge(player)}
        </button>`,
      )
      .join('') + `<button type="button" class="tab tab-add" data-add aria-label="Add player" title="Add player">${icon('plus')}</button>`;
}

function renderStatus(wheel, playerId) {
  const status = store.spinStatus(wheel, playerId);
  const player = store.findPlayer(wheel, playerId);
  const connected = !wheel.online || online.connectionStatus(wheel) === 'online';
  // "Ready for today's spin, Ava!" for a player; "Ready for today's spin!" for a shared wheel.
  const say = (text) => `${text}${player ? `, ${displayName(player)}` : ''}!`;

  els.spinBtn.disabled = !status.ok || !connected || waitingForServer;
  els.spinBtn.textContent = status.reason === 'locked' ? 'See you tomorrow!' : 'Spin!';
  if (waitingForServer) {
    els.status.textContent = 'Spinning…';
    return;
  }

  const manySpins = wheel.spinsPerDay > 1 || store.bonusToday(wheel, playerId) > 0;
  const messages = {
    empty: store.canManage(wheel) ? 'This wheel has no options yet. Add some in Settings.' : 'This wheel has no options yet.',
    done: `${say('All done')} Every one has been spun. 🎉`,
    locked: `${say(`That's ${manySpins ? 'all the spins' : 'the spin'} for today`)} Come back tomorrow. 🌙`,
    'no-player': wheel.online ? 'Waiting for players to join. Show the QR code from Settings → Players.' : 'Add a player to spin.',
  };
  els.status.textContent = status.ok ? readyMessage(wheel, playerId, say) : messages[status.reason];
}

function readyMessage(wheel, playerId, say) {
  if (!wheel.spinsPerDay) return '';
  const left = store.spinsLeftToday(wheel, playerId);
  const usedSome = store.spinsToday(wheel, playerId) > 0;
  if (left === 1) return usedSome ? say('One more spin today') : say("Ready for today's spin");
  return say(usedSome ? `${left} spins left today` : `${left} spins today`);
}

/** The day a spin happened, in the wheel's time zone, e.g. "Dec 3". */
const spinDay = (wheel, spin) => formatDay(dayKey(spin.at, wheel.timeZone));

/** "Maya" for a spin on a wheel where who spun matters; '' otherwise. */
function spinnerName(wheel, spin) {
  if (!wheel.sharedWheel || !spin.playerId) return '';
  return displayName(store.findPlayer(wheel, spin.playerId));
}

function renderProgress(wheel, playerId) {
  if (!wheel.options.length) {
    els.progress.hidden = true;
    return;
  }
  els.progress.hidden = false;
  if (wheel.removeAfterSpin) renderOpenedGrid(wheel, playerId);
  else renderRecentSpins(wheel, playerId);
}

/** Every option as a tile; spun ones are "opened" and can be tapped to see the result again. */
function renderOpenedGrid(wheel, playerId) {
  const opened = store.openedOptions(wheel, playerId);
  const today = dayKey(new Date(), wheel.timeZone);
  els.progressTitle.textContent = `${opened.size} of ${wheel.options.length} opened`;
  els.history.className = 'history-grid';
  els.history.innerHTML = wheel.options
    .map((option) => {
      const spin = opened.get(option.id);
      const day = spin ? dayKey(spin.at, wheel.timeZone) : '';
      const classes = ['chip', spin && 'opened', day === today && 'today', option.label.length > 3 && 'long'].filter(Boolean).join(' ');
      const label = `<span class="chip-label">${escapeHtml(option.label)}</span>`;
      if (!spin) return `<div class="${classes}">${label}</div>`;
      const who = spinnerName(wheel, spin);
      const note = who ? `${who} · ${spinDay(wheel, spin)}` : spinDay(wheel, spin);
      return `<button type="button" class="${classes}" data-spin="${escapeHtml(spin.id)}" title="Spun ${escapeHtml(note)}">${label}<small>${escapeHtml(note)}</small></button>`;
    })
    .join('');
}

function renderRecentSpins(wheel, playerId) {
  els.progressTitle.textContent = 'Recent spins';
  els.history.className = '';
  const recent = store
    .spinsFor(wheel, playerId)
    .slice(-10)
    .reverse();
  els.history.innerHTML = recent.length
    ? `<ul class="history-list">${recent
        .map((spin) => {
          const option = store.findOption(wheel, spin.optionId);
          const who = spinnerName(wheel, spin);
          const note = who ? `${who} · ${spinDay(wheel, spin)}` : spinDay(wheel, spin);
          return `<li><span>${escapeHtml(option?.label ?? 'Removed option')}</span><small>${escapeHtml(note)}</small></li>`;
        })
        .join('')}</ul>`
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
  if (spinning || waitingForServer || spinQueue.length) return;
  // If another copy of the app spun meanwhile, pick up its data first (and re-check the limit).
  if (syncFromStorage()) return;
  const wheel = store.activeWheel();
  if (!wheel) return;
  const playerId = store.activePlayerId(wheel);
  if (!store.spinStatus(wheel, playerId).ok) return;
  if (store.getState().settings.sound) fx.unlockAudio();

  if (wheel.online) {
    // The server picks the result and tells every phone; onSpun() plays it.
    if (!(await confirmSpinForSomeoneElse(wheel, playerId))) return;
    const connection = online.currentConnection();
    if (connection?.wheel !== wheel || connection.status !== 'online') return;
    waitingForServer = true;
    render();
    try {
      await connection.spin(playerId);
    } catch (err) {
      alertDialog(err.message, { title: "Couldn't spin" });
    } finally {
      waitingForServer = false;
      if (!spinning) render();
    }
    return;
  }

  // Decide the result first (fair, crypto-random), then animate to it. It's saved before the
  // wheel moves, so refreshing mid-spin can't re-roll.
  const labels = store.spinPool(wheel, playerId).map((o) => o.label);
  const { spin: entry, option, index } = store.spinLocal(wheel, playerId);
  renderWarnings();
  await playSpin({ wheel, spin: entry, option, index, labels });
}

/**
 * On an online wheel, players spin on their own phones. The host's phone can still spin for
 * someone (a kid without a phone, say), but asks first, so it doesn't happen by accident.
 * Spinning as the host's own name doesn't ask.
 */
async function confirmSpinForSomeoneElse(wheel, playerId) {
  if (store.roleOf(wheel) !== 'host' || !playerId || store.isHostPlayer(wheel, playerId)) return true;
  const player = store.findPlayer(wheel, playerId);
  const name = displayName(player);
  const why = player?.claimed ? `${name} usually spins on their own device.` : `${name} hasn't joined from their own device yet.`;
  return confirmDialog(`${why} Spin for ${name} from here?`, { title: `Spin for ${name}?`, ok: 'Spin for them' });
}

/** A spin decided by the server (this phone's, or someone else's). */
function onSpun(event) {
  const wheel = store.activeWheel();
  if (online.currentConnection()?.wheel !== wheel) return;
  // A shared wheel shows every spin. Otherwise only the spins of whoever is on screen play;
  // others (the host watching, or players who share spins) get a short note instead.
  const onScreen = wheel.sharedWheel || event.spin.playerId === store.activePlayerId(wheel);
  if (!onScreen || event.index < 0) {
    const player = store.findPlayer(wheel, event.spin.playerId);
    toast(`${player ? displayName(player) : 'Someone'} got ${event.option.label}!`);
    render();
    return;
  }
  spinQueue.push({ wheel, ...event });
  playQueue();
}

/** Play queued online spins one after another. */
async function playQueue() {
  if (spinning || !spinQueue.length) return;
  if (els.result.open) {
    // Let the last result be seen for a moment, then make way for the next spin.
    const wait = resultShownAt + RESULT_MIN_MS - Date.now();
    if (wait > 0) {
      setTimeout(playQueue, wait);
      return;
    }
    els.result.close(); // its close handler calls playQueue() again
    return;
  }
  const next = spinQueue.shift();
  if (next.wheel !== store.activeWheel()) {
    playQueue();
    return;
  }
  await playSpin(next);
}

async function playSpin({ wheel, spin, option, index, labels }) {
  const { settings } = store.getState();
  spinning = true;
  document.body.classList.add('is-spinning');
  els.spinBtn.disabled = true;
  els.status.textContent = 'Spinning…';
  wheelView.setLabels(labels); // the wheel as it was before this spin

  const reducedMotion = prefersReducedMotion();
  const seconds = reducedMotion ? Math.min(settings.spinSeconds, 1.5) : settings.spinSeconds;
  try {
    await wheelView.spinTo(index, seconds * 1000, { turns: reducedMotion ? 1 : undefined });
  } finally {
    spinning = false;
    document.body.classList.remove('is-spinning');
  }
  showResult(wheel, spin, option, { celebrate: true });
}

function onTick() {
  const { sound, tickSound } = store.getState().settings;
  if (sound) fx.playTick(tickSound === 'auto' ? theme.tick : tickSound);
  els.pointer.classList.remove('flick');
  void els.pointer.offsetWidth; // restart the CSS animation
  els.pointer.classList.add('flick');
}

/** Show a result: right after a spin (`celebrate`), or again from a history tile. */
function showResult(wheel, spin, option, { celebrate = false } = {}) {
  if (els.result.open) return;
  const { settings } = store.getState();
  const player = store.findPlayer(wheel, spin.playerId);
  const who = player ? displayName(player) : store.wheelTitle(wheel);
  $('#result-emoji').textContent = theme.resultEmoji;
  $('#result-kicker').textContent = celebrate ? (player ? `${who} got…` : 'And the wheel says…') : `${who} · ${spinDay(wheel, spin)}`;
  $('#result-label').textContent = option.label;
  const surprise = $('#result-surprise');
  surprise.textContent = option.surprise;
  surprise.hidden = !option.surprise.trim();

  // Dialogs render above everything, so confetti must live inside the open dialog.
  els.result.append(els.confetti);
  els.result.showModal();
  resultShownAt = Date.now();
  if (celebrate) {
    if (settings.confetti) fx.confettiBurst(els.confetti, theme.confetti);
    if (settings.sound) fx.playMelody(theme.melody);
  }
  if (spinQueue.length) setTimeout(playQueue, RESULT_MIN_MS);
}

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 4000);
}

// ---------------------------------------------------------------- Misc

function checkNewDay() {
  if (spinning || els.result.open) return;
  if (dayKey(new Date(), store.activeWheel()?.timeZone) !== currentDay) {
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
