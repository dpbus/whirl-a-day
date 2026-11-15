// Small promise-based dialogs (instead of window.confirm/prompt, which look out of place
// and can't be styled). Each one is built on demand and removed when it closes.
import { escapeHtml, uid } from './util.js';
import { icon } from './icons.js';

/** Create a modal <dialog> whose heading (an element with id = titleId) names it. */
export function makeDialog(className, html, titleId) {
  const dialog = document.createElement('dialog');
  dialog.className = `dialog ${className}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = html;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return dialog;
}

/** Resolves true if the user chose OK. */
export function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const titleId = `dlg-${uid()}`;
    const dialog = makeDialog(
      'small',
      `<form method="dialog" class="dialog-body">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>${escapeHtml(cancel)}</button>
          <button class="btn ${danger ? 'danger-fill' : 'primary'}" value="ok">${escapeHtml(ok)}</button>
        </div>
      </form>`,
      titleId,
    );
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'));
    dialog.showModal();
  });
}

export function alertDialog(message, { title = 'Heads up', ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    const titleId = `dlg-${uid()}`;
    const dialog = makeDialog(
      'small',
      `<form method="dialog" class="dialog-body">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="dialog-actions"><button class="btn primary">${escapeHtml(ok)}</button></div>
      </form>`,
      titleId,
    );
    dialog.addEventListener('close', () => resolve());
    dialog.showModal();
  });
}

/**
 * Ask for the grown-up PIN. Resolves 'unlocked', 'cancelled', or 'forgot' (the grown-up
 * confirmed they want the PIN removed: progress is kept, only the PIN goes).
 */
export function pinPrompt(expected) {
  const FORGOT_PHRASE = 'remove pin';
  return new Promise((resolve) => {
    const titleId = `dlg-${uid()}`;
    const dialog = makeDialog(
      'small',
      `<form method="dialog" class="dialog-body" data-step="pin">
        <h2 class="with-icon" id="${titleId}">${icon('lock', { size: 22 })} Grown-ups only</h2>
        <div class="pin-step">
          <p>Enter the PIN to open settings.</p>
          <input class="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="PIN">
          <button type="button" class="link-btn" data-forgot>Forgot the PIN?</button>
        </div>
        <div class="forgot-step" hidden>
          <p>Removing the PIN keeps all wheels and progress. To confirm, type <strong>${FORGOT_PHRASE}</strong> below.</p>
          <input class="forgot-input" autocomplete="off" aria-label="Type ${FORGOT_PHRASE} to confirm">
        </div>
        <p class="error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button class="btn primary" data-submit>Unlock</button>
        </div>
      </form>`,
      titleId,
    );
    const form = dialog.querySelector('form');
    const pinInput = dialog.querySelector('.pin-input');
    const forgotInput = dialog.querySelector('.forgot-input');
    const error = dialog.querySelector('.error');
    let result = 'cancelled';

    const fail = (message, input) => {
      error.textContent = message;
      input.value = '';
      input.focus();
      dialog.classList.remove('shake');
      void dialog.offsetWidth; // restart the animation
      dialog.classList.add('shake');
    };

    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-forgot]').addEventListener('click', () => {
      form.dataset.step = 'forgot';
      dialog.querySelector('.pin-step').hidden = true;
      dialog.querySelector('.forgot-step').hidden = false;
      dialog.querySelector('[data-submit]').textContent = 'Remove PIN';
      error.textContent = '';
      forgotInput.focus();
    });
    form.addEventListener('submit', (event) => {
      if (form.dataset.step === 'pin') {
        if (pinInput.value === expected) result = 'unlocked';
        else {
          event.preventDefault();
          fail("That's not it — try again.", pinInput);
        }
      } else if (forgotInput.value.trim().toLowerCase() === FORGOT_PHRASE) {
        result = 'forgot';
      } else {
        event.preventDefault();
        fail(`Type “${FORGOT_PHRASE}” exactly to remove the PIN.`, forgotInput);
      }
    });
    dialog.addEventListener('close', () => resolve(result));
    dialog.showModal();
    pinInput.focus();
  });
}

/**
 * A short list of actions (e.g. for one player). `items`: [{ id, label, danger? }].
 * Resolves the chosen id, or null if cancelled.
 */
export function menuDialog(title, items) {
  return new Promise((resolve) => {
    const titleId = `dlg-${uid()}`;
    const dialog = makeDialog(
      'small menu',
      `<form method="dialog" class="dialog-body">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <div class="menu-items">
          ${items.map((item) => `<button class="btn menu-item${item.danger ? ' danger' : ''}" value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`).join('')}
        </div>
        <div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancel</button></div>
      </form>`,
      titleId,
    );
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close(''));
    dialog.addEventListener('close', () => resolve(items.some((i) => i.id === dialog.returnValue) ? dialog.returnValue : null));
    dialog.showModal();
  });
}

/** Ask for a line of text. Resolves the trimmed text, or null if cancelled or left empty. */
export function promptDialog(label, { title = label, value = '', maxLength = 100, ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    const titleId = `dlg-${uid()}`;
    const dialog = makeDialog(
      'small',
      `<form method="dialog" class="dialog-body">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <input class="prompt-input" maxlength="${maxLength}" aria-label="${escapeHtml(label)}" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button class="btn primary" value="ok">${escapeHtml(ok)}</button>
        </div>
      </form>`,
      titleId,
    );
    const input = dialog.querySelector('.prompt-input');
    input.value = value;
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close(''));
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null));
    dialog.showModal();
    input.select();
  });
}
