// Helpers used by more than one settings tab.
import { THEMES } from '../themes.js';
import { PRESETS } from '../presets.js';
import * as store from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../util.js';

/** A grid of theme cards. Wire it up with bindThemeCards(). */
export const themeCards = (selectedId) =>
  Object.entries(THEMES)
    .map(
      ([id, theme]) => `
      <button type="button" class="theme-card" data-theme-id="${id}" aria-pressed="${selectedId === id}">
        <span class="theme-emoji" aria-hidden="true">${theme.emoji}</span>
        <span class="theme-name">${escapeHtml(theme.name)}</span>
        <span class="swatches" aria-hidden="true">${theme.wheel.segments.map((s) => `<i data-color="${escapeHtml(s.bg)}"></i>`).join('')}</span>
      </button>`,
    )
    .join('');

/** Make theme cards clickable. `onPick(themeId)` decides what the choice applies to. */
export function bindThemeCards(container, onPick) {
  // Colors are set through the DOM rather than style="" attributes, which the CSP blocks.
  for (const swatch of container.querySelectorAll('[data-color]')) swatch.style.background = swatch.dataset.color;
  container.addEventListener('click', (event) => {
    const card = event.target.closest('[data-theme-id]');
    if (!card) return;
    selectThemeCard(container, card.dataset.themeId);
    onPick(card.dataset.themeId);
  });
}

export function selectThemeCard(container, themeId) {
  for (const card of container.querySelectorAll('[data-theme-id]')) {
    card.setAttribute('aria-pressed', String(card.dataset.themeId === themeId));
  }
}

/** <option>s for every preset. */
export const presetOptions = (selectedId = '') =>
  PRESETS.map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Running as a home-screen app rather than in a browser tab. */
export const isInstalled = () => navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;

export const PLAYERS_HINT =
  'Each player gets their own progress. Leave the names blank for a wheel everyone shares, like a dinner picker.';
const ONLINE_PLAYERS_HINT =
  "Optional: names you add here are ready for people to tap when they join. Anyone else types their own.";

/** "How will you play?": on this device, or online (each their own wheel, or one shared wheel). */
export function playModeField() {
  const choice = (value, title, hint, checked = false) => `
    <label class="choice">
      <input type="radio" name="play" value="${value}" ${checked ? 'checked' : ''}>
      <span><strong>${title}</strong><span class="hint">${hint}</span></span>
    </label>`;
  return `
    <fieldset class="choices">
      <legend class="field-label">How will you play?</legend>
      ${choice('local', 'On this device', 'Take turns on one phone or tablet. Everything stays on this device.', true)}
      ${choice('individual', "On everyone's phones, each their own wheel", 'Like an advent calendar: share a QR code, and each person works through their own copy. You see everyone’s progress.')}
      ${choice('shared', "On everyone's phones, one wheel", 'Like game night: every spin plays on every phone, and the history shows who spun.')}
    </fieldset>`;
}

/**
 * Wire up a playModeField inside `form`: keeps the players hint in step with the choice.
 * Returns () => 'local' | 'individual' | 'shared'.
 */
export function bindPlayMode(form) {
  const mode = () => form.querySelector('input[name="play"]:checked')?.value ?? 'local';
  const hint = form.querySelector('[data-players-hint]');
  form.addEventListener('change', (event) => {
    if (event.target.name === 'play' && hint) hint.textContent = mode() === 'local' ? PLAYERS_HINT : ONLINE_PLAYERS_HINT;
  });
  return mode;
}

/**
 * Name fields for the players of a new wheel, plus "Another player". Blank names are ignored,
 * and no names at all means a shared wheel. Wire it up with bindPlayerNames().
 */
export function playerNamesField(idPrefix, { hint = '', extraButtons = '' } = {}) {
  const input = (attrs) => `<input maxlength="${store.MAX_NAME_LENGTH}" placeholder="Name" ${attrs}>`;
  return `
    <div class="field">
      <label for="${idPrefix}-first">Who's playing?</label>
      <div class="name-list" id="${idPrefix}-names">
        ${input(`id="${idPrefix}-first"`)}
        ${input('aria-label="Another name"')}
      </div>
      <div class="row wrap">
        <button type="button" class="btn small" data-add-name>${icon('plus', { size: 16 })} Another player</button>
        ${extraButtons}
      </div>
      ${hint ? `<p class="hint" data-players-hint>${hint}</p>` : ''}
    </div>`;
}

/** Returns { names(), setNames(list) } for a playerNamesField inside `container`. */
export function bindPlayerNames(container, idPrefix) {
  const list = container.querySelector(`#${idPrefix}-names`);
  const addInput = (value = '') => {
    const input = document.createElement('input');
    input.maxLength = store.MAX_NAME_LENGTH;
    input.placeholder = 'Name';
    input.setAttribute('aria-label', 'Another name');
    input.value = value;
    list.append(input);
    return input;
  };
  container.querySelector('[data-add-name]').addEventListener('click', () => addInput().focus());

  return {
    names: () => [...list.querySelectorAll('input')].map((input) => input.value.trim()).filter(Boolean),
    setNames(names) {
      const inputs = [...list.querySelectorAll('input')];
      names.forEach((name, i) => (inputs[i] ? (inputs[i].value = name) : addInput(name)));
      inputs.slice(names.length).forEach((input) => (input.value = ''));
    },
  };
}
