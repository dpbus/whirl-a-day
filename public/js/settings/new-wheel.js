// "New wheel": pick a preset, title, theme and players, and how it'll be played (on this
// device, or online on everyone's phones). Opened from the wheels list.
import * as store from '../state.js';
import { DEFAULT_PRESET_ID, getPreset } from '../presets.js';
import { alertDialog, makeDialog, pinPrompt } from '../dialogs.js';
import { icon } from '../icons.js';
import { startOnline } from '../online-ui.js';
import { $, escapeHtml, uid } from '../util.js';
import {
  PLAYERS_HINT,
  bindPlayMode,
  bindPlayerNames,
  bindThemeCards,
  playModeField,
  playerNamesField,
  presetOptions,
  selectThemeCard,
  themeCards,
} from './shared.js';

let onDone = () => {};

/** Set what happens once a wheel is made (main.js redraws the screen). */
export function onNewWheel(callback) {
  onDone = callback;
}

/** A preset's own theme (e.g. Christmas for 12 Days), or the app's default theme. */
const defaultThemeFor = (presetId) => getPreset(presetId).theme ?? store.getState().settings.theme;

export async function openNewWheel() {
  if (!store.canAddWheel()) {
    alertDialog(`You have the most wheels the app allows (${store.MAX_WHEELS}). Remove one to make another.`, { title: 'No room for another wheel' });
    return;
  }
  // Making wheels is for grown-ups, like the rest of settings.
  const { pin } = store.getState().settings;
  if (pin) {
    const result = await pinPrompt(pin);
    if (result === 'cancelled') return;
    if (result === 'forgot') store.updateSettings({ pin: '' });
  }

  const active = store.activeWheel();
  const preset = getPreset(DEFAULT_PRESET_ID);
  const titleId = `dlg-${uid()}`;
  const dialog = makeDialog(
    'new-wheel',
    `<form method="dialog" class="dialog-body">
      <h2 id="${titleId}">New wheel</h2>
      <div class="field">
        <label for="nw-preset">Start from</label>
        <select id="nw-preset">${presetOptions(DEFAULT_PRESET_ID)}</select>
      </div>
      <div class="field">
        <label for="nw-title">Title</label>
        <input id="nw-title" maxlength="${store.MAX_TITLE_LENGTH}" placeholder="${escapeHtml(preset.title)}">
      </div>
      <div class="field">
        <span class="field-label" id="nw-theme-label">Theme</span>
        <div class="theme-grid compact" id="nw-themes" role="group" aria-labelledby="nw-theme-label">${themeCards(defaultThemeFor(DEFAULT_PRESET_ID))}</div>
      </div>
      ${playModeField()}
      ${playerNamesField('nw', {
        hint: PLAYERS_HINT,
        extraButtons:
          active?.players.length && store.canManage(active)
            ? `<button type="button" class="btn small" id="nw-copy-players">Use the same players as “${escapeHtml(store.wheelTitle(active))}”</button>`
            : '',
      })}
      <div class="dialog-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button class="btn primary" value="create">${icon('plus', { size: 18 })} Create wheel</button>
      </div>
    </form>`,
    titleId,
  );
  const form = dialog.querySelector('form');
  const presetSelect = $('#nw-preset', form);
  const themes = $('#nw-themes', form);

  // The theme follows the chosen preset until someone picks one themselves.
  let theme = defaultThemeFor(presetSelect.value);
  let themePicked = false;
  bindThemeCards(themes, (picked) => {
    theme = picked;
    themePicked = true;
  });
  presetSelect.addEventListener('change', () => {
    $('#nw-title', form).placeholder = getPreset(presetSelect.value).title;
    if (!themePicked) {
      theme = defaultThemeFor(presetSelect.value);
      selectThemeCard(themes, theme);
    }
  });

  const players = bindPlayerNames(form, 'nw');
  const playMode = bindPlayMode(form);
  $('#nw-copy-players', form)?.addEventListener('click', () => players.setNames(active.players.map((p) => p.name)));
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'create') return;
    let wheel;
    try {
      wheel = store.addWheel({ presetId: presetSelect.value, title: $('#nw-title', form).value, theme, playerNames: players.names() });
    } catch (err) {
      alertDialog(err.message, { title: "Couldn't make the wheel" }); // e.g. another tab made the last one allowed
      return;
    }
    const mode = playMode();
    onDone();
    if (mode !== 'local') startOnline(wheel, { sharedWheel: mode === 'shared' });
  });
  dialog.showModal();
}
