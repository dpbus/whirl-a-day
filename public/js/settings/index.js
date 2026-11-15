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
import * as wheelsTab from './wheels-tab.js';
import * as wheelTab from './wheel-tab.js';
import * as playersTab from './players-tab.js';
import * as generalTab from './general-tab.js';
import * as backupTab from './backup-tab.js';
import { onWelcomeDone } from './welcome.js';

export { openWelcome } from './welcome.js';

const TABS = { wheels: wheelsTab, wheel: wheelTab, players: playersTab, general: generalTab, backup: backupTab };
const TABS_NEEDING_A_WHEEL = new Set(['wheel', 'players']);

let dialog;
let tabBar;
let hooks = { onChange() {}, syncFromStorage() {} };
let saveOnClose = true;

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
    if (saveOnClose) {
      store.flushSave();
      store.pruneBlankOptions();
    }
    saveOnClose = true;
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

/** Close without saving pending edits (used when the data was just reloaded from another tab). */
export function discardSettings() {
  if (!dialog.open) return;
  saveOnClose = false;
  dialog.close();
}

function showTab(tab, { keepScroll = false } = {}) {
  // A phone that joined someone else's online wheel can't edit it, so those tabs are hidden.
  const canManage = Boolean(store.activeWheel()) && store.canManage(store.activeWheel());
  if (TABS_NEEDING_A_WHEEL.has(tab) && !canManage) tab = 'wheels';
  for (const name of TABS_NEEDING_A_WHEEL) tabBar.querySelector(`[data-tab="${name}"]`).hidden = !canManage;
  const { body } = view;
  const scrollTop = body.scrollTop;

  for (const button of tabBar.querySelectorAll('[data-tab]')) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  body.setAttribute('aria-labelledby', `settings-tab-${tab}`);
  body.innerHTML = '';
  TABS[tab].render(view);
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
