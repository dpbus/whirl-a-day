// Settings → Wheels: the list of wheels (open, reorder, remove) and the "New wheel" form.
import * as store from '../state.js';
import { DEFAULT_PRESET_ID, getPreset } from '../presets.js';
import { confirmDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { listItemControls, onListItemAction, wheelButton } from '../templates.js';
import { $, escapeHtml } from '../util.js';
import { PLAYERS_HINT, bindPlayerNames, bindThemeCards, playerNamesField, presetOptions, selectThemeCard, themeCards } from './shared.js';

export function render(view) {
  const { wheels } = store.getState();
  view.body.innerHTML = `
    <h3>Your wheels</h3>
    ${wheels.length ? '<ul class="wheel-list" id="ws-list"></ul>' : '<p class="hint">No wheels yet. Make one below.</p>'}
    ${newWheelForm()}
  `;
  if (wheels.length) renderWheelList(view);
  bindNewWheelForm(view);
}

// ---------------------------------------------------------------- wheel list

function renderWheelList(view) {
  const { wheels } = store.getState();
  const active = store.activeWheel();
  const list = $('#ws-list', view.body);

  list.innerHTML = wheels
    .map(
      (wheel, i) => `
      <li data-id="${escapeHtml(wheel.id)}">
        ${wheelButton(wheel, { current: wheel.id === active?.id, attrs: 'data-open' })}
        ${listItemControls(store.wheelTitle(wheel), i, wheels.length)}
      </li>`,
    )
    .join('');

  onListItemAction(list, {
    onOpen(id) {
      store.setActiveWheel(id);
      view.changed();
      view.showTab('wheel');
    },
    onMove(id, delta) {
      store.moveWheel(id, delta);
      view.changed();
      view.showTab('wheels', { keepScroll: true });
    },
    async onDelete(id) {
      const ok = await confirmDialog(
        `Remove “${store.wheelTitle(store.getWheel(id))}” and everyone's progress on it? (A snapshot is kept, so this can be undone from Backup.)`,
        { title: 'Remove wheel?', ok: 'Remove', danger: true },
      );
      if (!ok || !store.getWheel(id)) return;
      store.removeWheel(id);
      view.changed();
      view.showTab('wheels', { keepScroll: true });
    },
  });
}

// ---------------------------------------------------------------- new wheel

function newWheelForm() {
  const active = store.activeWheel();
  const preset = getPreset(DEFAULT_PRESET_ID);
  if (!store.canAddWheel()) {
    return `<p class="hint">You have the most wheels the app allows (${store.MAX_WHEELS}). Remove one to make another.</p>`;
  }
  return `
    <form class="settings-form" id="ws-new">
      <h3>New wheel</h3>
      <div class="field">
        <label for="ws-preset">Start from</label>
        <select id="ws-preset">${presetOptions(DEFAULT_PRESET_ID)}</select>
      </div>
      <div class="field">
        <label for="ws-title">Title</label>
        <input id="ws-title" maxlength="${store.MAX_TITLE_LENGTH}" placeholder="${escapeHtml(preset.title)}">
      </div>
      <div class="field">
        <span class="field-label" id="ws-theme-label">Theme</span>
        <div class="theme-grid compact" id="ws-themes" role="group" aria-labelledby="ws-theme-label">${themeCards(defaultThemeFor(DEFAULT_PRESET_ID))}</div>
      </div>
      ${playerNamesField('ws', {
        hint: PLAYERS_HINT,
        extraButtons: active?.players.length
          ? `<button type="button" class="btn small" id="ws-copy-players">Use the same players as “${escapeHtml(store.wheelTitle(active))}”</button>`
          : '',
      })}
      <button class="btn primary">${icon('plus', { size: 18 })} Create wheel</button>
    </form>`;
}

/** A preset's own theme (e.g. Christmas for 12 Days), or the app's default theme. */
const defaultThemeFor = (presetId) => getPreset(presetId).theme ?? store.getState().settings.theme;

function bindNewWheelForm(view) {
  const form = $('#ws-new', view.body);
  if (!form) return;
  const preset = $('#ws-preset', form);
  const themes = $('#ws-themes', form);

  // The theme follows the chosen preset until someone picks one themselves.
  let theme = defaultThemeFor(preset.value);
  let themePicked = false;
  bindThemeCards(themes, (picked) => {
    theme = picked;
    themePicked = true;
  });
  preset.addEventListener('change', () => {
    $('#ws-title', form).placeholder = getPreset(preset.value).title;
    if (!themePicked) {
      theme = defaultThemeFor(preset.value);
      selectThemeCard(themes, theme);
    }
  });

  const players = bindPlayerNames(form, 'ws');
  $('#ws-copy-players', form)?.addEventListener('click', () => {
    players.setNames(store.activeWheel().players.map((p) => p.name));
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    store.addWheel({ presetId: preset.value, title: $('#ws-title', form).value, theme, playerNames: players.names() });
    view.changed();
    view.showTab('wheel');
  });
}
