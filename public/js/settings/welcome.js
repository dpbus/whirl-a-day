// First-run setup: pick a theme and a preset, name the players, and create the first wheel.
import * as store from '../state.js';
import { getTheme } from '../themes.js';
import { DEFAULT_PRESET_ID } from '../presets.js';
import { $ } from '../util.js';
import { PLAYERS_HINT, bindPlayerNames, bindThemeCards, isIOS, isInstalled, playerNamesField, presetOptions, themeCards } from './shared.js';

let onDone = () => {};

/** Set what happens once setup finishes (main.js redraws the screen). */
export function onWelcomeDone(callback) {
  onDone = callback;
}

export function openWelcome() {
  const { settings } = store.getState();
  const welcome = document.createElement('dialog');
  welcome.className = 'dialog welcome';
  welcome.setAttribute('aria-labelledby', 'wl-title');
  welcome.innerHTML = `
    <form method="dialog" class="dialog-body">
      <div class="welcome-emoji" aria-hidden="true">${getTheme(settings.theme).emoji}</div>
      <h2 id="wl-title">Welcome to Whirl-a-Day!</h2>
      <p class="welcome-sub">Let's set up your first wheel. You can add more later.</p>
      <div class="field">
        <span class="field-label" id="wl-theme-label">Pick a theme</span>
        <div class="theme-grid compact" id="wl-themes" role="group" aria-labelledby="wl-theme-label">${themeCards(settings.theme)}</div>
      </div>
      <div class="field">
        <label for="wl-preset">What's it for?</label>
        <select id="wl-preset">${presetOptions(DEFAULT_PRESET_ID)}</select>
      </div>
      ${playerNamesField('wl', { hint: PLAYERS_HINT })}
      ${isIOS() && !isInstalled() ? `
      <p class="tip">📱 <strong>On iPhone or iPad?</strong> Tap Share → <strong>Add to Home Screen</strong> first, and set things up from there. The Home Screen app keeps its own data, and it's safer from being cleared.</p>` : ''}
      <div class="dialog-actions">
        <button class="btn primary big">Let's go!</button>
      </div>
    </form>`;
  document.body.append(welcome);

  // If nobody picks a theme, the wheel uses its preset's theme (e.g. Christmas for 12 Days).
  let pickedTheme;
  bindThemeCards($('#wl-themes', welcome), (themeId) => {
    pickedTheme = themeId;
    store.updateSettings({ theme: themeId }); // also the default for later wheels
    $('.welcome-emoji', welcome).textContent = getTheme(themeId).emoji;
    onDone(); // redraw so the page takes on the theme straight away
  });

  const players = bindPlayerNames(welcome, 'wl');

  welcome.addEventListener('close', () => {
    store.addWheel({ presetId: $('#wl-preset', welcome).value, theme: pickedTheme, playerNames: players.names() });
    store.requestPersistentStorage();
    welcome.remove();
    onDone();
  });

  welcome.showModal();
  // Don't pop the on-screen keyboard over the theme picker on phones.
  if (!window.matchMedia?.('(pointer: coarse)').matches) $('#wl-first', welcome).focus({ preventScroll: true });
}
