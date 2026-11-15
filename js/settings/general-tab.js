// Settings → General: spin length, sound, confetti, and the grown-up PIN.
import * as store from '../state.js';
import { TICK_STYLES, getTheme } from '../themes.js';
import { previewTicks } from '../effects.js';
import { icon } from '../icons.js';
import { $, escapeHtml } from '../util.js';

export function render(view) {
  view.body.innerHTML = `
    ${spinSection()}
    ${pinSection()}
  `;
  bindSpin(view);
  bindPin(view);
}

// ---------------------------------------------------------------- spin & sound

function spinSection() {
  return `
    <h3>Spin</h3>
    <div class="field">
      <label for="g-duration">Spin length: <output id="g-duration-out" for="g-duration"></output></label>
      <input type="range" id="g-duration" min="2" max="15" step="1">
    </div>
    <div class="toggles">
      <label class="switch"><input type="checkbox" id="g-sound"><span>Sound effects</span></label>
      <label class="switch"><input type="checkbox" id="g-confetti"><span>Confetti</span></label>
    </div>
    <div class="field">
      <label for="g-tick">Spinning sound</label>
      <div class="row">
        <select id="g-tick">
          <option value="auto">Match each wheel's theme</option>
          ${Object.entries(TICK_STYLES).map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('')}
        </select>
        <button type="button" class="btn" id="g-tick-preview">${icon('play', { size: 18 })} Preview</button>
      </div>
    </div>`;
}

function bindSpin(view) {
  const { settings } = store.getState();
  const duration = $('#g-duration', view.body);
  const durationOut = $('#g-duration-out', view.body);
  const showDuration = () => (durationOut.textContent = `${duration.value} seconds`);
  duration.value = settings.spinSeconds;
  showDuration();
  duration.addEventListener('input', () => {
    showDuration();
    store.updateSettings({ spinSeconds: Number(duration.value) }, { soon: true });
  });

  for (const [id, key] of [['#g-sound', 'sound'], ['#g-confetti', 'confetti']]) {
    const toggle = $(id, view.body);
    toggle.checked = settings[key];
    toggle.addEventListener('change', () => store.updateSettings({ [key]: toggle.checked }));
  }

  const tick = $('#g-tick', view.body);
  tick.value = settings.tickSound;
  /** The style to preview: the chosen one, or the active wheel's theme default. */
  const tickStyle = () => (tick.value === 'auto' ? getTheme(store.activeWheel()?.theme ?? settings.theme).tick : tick.value);
  tick.addEventListener('change', () => {
    store.updateSettings({ tickSound: tick.value });
    previewTicks(tickStyle());
  });
  $('#g-tick-preview', view.body).addEventListener('click', () => previewTicks(tickStyle()));
}

// ---------------------------------------------------------------- PIN

function pinSection() {
  const hasPin = Boolean(store.getState().settings.pin);
  return `
    <h3>Grown-up PIN</h3>
    <p class="hint">Optional. When set, opening settings asks for the PIN — so kids can't undo spins, grant themselves extra spins, or peek at surprises. Switching wheels doesn't need it. It's kid-proofing, not real security.</p>
    <form class="settings-form" id="g-pin-form">
      <div class="row wrap">
        <input id="g-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"
          placeholder="${hasPin ? 'New PIN' : 'e.g. 1234'}" aria-label="${hasPin ? 'New PIN' : 'PIN'}" class="pin-field">
        <input id="g-pin-again" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"
          placeholder="Type it again" aria-label="Type the PIN again" class="pin-field">
      </div>
      <div class="row wrap">
        <button class="btn">${hasPin ? 'Change PIN' : 'Set PIN'}</button>
        ${hasPin ? '<button type="button" class="btn danger" id="g-pin-clear">Remove PIN</button>' : ''}
      </div>
    </form>
    <p class="hint" id="g-pin-msg" role="status">${hasPin ? 'A PIN is set. Forgot it? Choose “Forgot the PIN?” when asked for it.' : ''}</p>`;
}

function bindPin(view) {
  const message = (text) => ($('#g-pin-msg', view.body).textContent = text);

  $('#g-pin-form', view.body).addEventListener('submit', (event) => {
    event.preventDefault();
    const pin = $('#g-pin', view.body).value.trim();
    const again = $('#g-pin-again', view.body).value.trim();
    if (!/^\d{4,8}$/.test(pin)) return message('Use 4–8 digits.');
    if (pin !== again) return message("The two PINs don't match. Try again.");
    store.updateSettings({ pin });
    view.showTab('general', { keepScroll: true });
    message('PIN saved. Settings will ask for it next time.');
  });

  $('#g-pin-clear', view.body)?.addEventListener('click', () => {
    store.updateSettings({ pin: '' });
    view.showTab('general', { keepScroll: true });
    message('PIN removed.');
  });
}
