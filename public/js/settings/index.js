// The settings dialog: a tab bar, plus one module per tab.
//
// Each tab module exports render(view), which fills view.body and wires up its own controls.
// `view` is the small API tabs use to talk back:
//   view.body                 the tab panel element
//   view.showTab(tab, opts)   re-render a tab ({ keepScroll: true } keeps the scroll position)
//   view.changed()            the data changed: redraw the main screen
//   view.changedSoon()        same, but waits for typing to pause
//   view.close()              close the dialog
//
// Handlers that await a confirmation look the wheel up again afterwards (by id), because the
// data may have been reloaded from another tab while the confirmation was open.
import * as store from '../state.js';
import { pinPrompt } from '../dialogs.js';
import { $, debounce } from '../util.js';
import * as wheelTab from './wheel-tab.js';
import * as playersTab from './players-tab.js';
import * as generalTab from './general-tab.js';
import * as backupTab from './backup-tab.js';
import { onWelcomeDone } from './welcome.js';

export { openWelcome } from './welcome.js';

// Settings are for the wheel on screen (plus app-wide General and Backup). The list of wheels and
// "New wheel" live in the wheels menu (main.js), so it's clear which wheel these settings change.
const TABS = { wheel: wheelTab, players: playersTab, general: generalTab, backup: backupTab };

let dialog;
let tabBar;
let hooks = { onChange() {}, syncFromStorage() {} };
let currentTab = 'wheel';

const view = {
  body: null,
  showTab: (tab, options) => showTab(tab, options),
  changed: () => hooks.onChange(),
  changedSoon: debounce(() => hooks.onChange(), 300),
  close: () => dialog.close(),
};

export function initSettings(callbacks) {
  hooks = { ...hooks, ...callbacks };
  onWelcomeDone(() => hooks.onChange());
  dialog = $('#settings-dialog');
  tabBar = dialog.querySelector('.settings-tabs');
  view.body = $('#settings-body');

  tabBar.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) showTab(tab.dataset.tab);
  });
  tabBar.addEventListener('keydown', moveBetweenTabs);

  dialog.addEventListener('close', () => {
    store.flushSave();
    store.pruneBlankOptions();
    hooks.onChange();
  });
}

export async function openSettings(tab = 'wheel') {
  hooks.syncFromStorage();
  const { pin } = store.getState().settings;
  if (pin) {
    const result = await pinPrompt(pin);
    if (result === 'cancelled') return;
    if (result === 'forgot') {
      store.updateSettings({ pin: '' });
      tab = 'general';
    }
  }
  showTab(tab);
  dialog.showModal();
}

/**
 * The data was just reloaded (another tab of the app saved, e.g. an online wheel's update):
 * redraw the open tab from the fresh data, keeping the scroll position, rather than closing.
 */
export function refreshSettings() {
  if (!dialog.open) return;
  // Don't redraw under someone who's typing: wait until they leave the field.
  const typing = view.body.contains(document.activeElement) && document.activeElement.matches('input, textarea');
  if (!typing) return showTab(currentTab, { keepScroll: true });
  view.body.addEventListener('focusout', () => setTimeout(() => dialog.open && showTab(currentTab, { keepScroll: true })), { once: true });
}

function showTab(tab, { keepScroll = false } = {}) {
  // Without a wheel there's nothing to set up but the app; a phone that joined someone else's
  // online wheel sees the wheel (to leave it) but not its players.
  const wheel = store.activeWheel();
  const available = { wheel: Boolean(wheel), players: Boolean(wheel) && store.canManage(wheel), general: true, backup: true };
  if (!available[tab]) tab = available.wheel ? 'wheel' : 'general';
  currentTab = tab;
  for (const [name, shown] of Object.entries(available)) tabBar.querySelector(`[data-tab="${name}"]`).hidden = !shown;
  const { body } = view;
  const scrollTop = body.scrollTop;
  // Redrawing the same tab keeps any "More options" panels that were open.
  const openPanels = keepScroll ? [...body.querySelectorAll('details')].map((d) => d.open) : [];

  for (const button of tabBar.querySelectorAll('[data-tab]')) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  body.setAttribute('aria-labelledby', `settings-tab-${tab}`);
  body.innerHTML = '';
  TABS[tab].render(view);
  body.querySelectorAll('details').forEach((d, i) => {
    if (openPanels[i]) d.open = true;
  });
  body.scrollTop = keepScroll ? scrollTop : 0;
}


/** Arrow keys move between tabs, as screen-reader users expect from a tab list. */
function moveBetweenTabs(event) {
  const tabs = [...tabBar.querySelectorAll('[data-tab]:not([hidden])')];
  const index = tabs.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (index < 0 || !step) return;
  event.preventDefault();
  const next = tabs[(index + step + tabs.length) % tabs.length];
  showTab(next.dataset.tab);
  next.focus();
}
