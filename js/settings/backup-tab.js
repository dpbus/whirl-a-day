// Settings → Backup: backup files (save/restore), automatic snapshots, recovery of unreadable
// data, and "erase everything".
import * as store from '../state.js';
import { alertDialog, confirmDialog } from '../dialogs.js';
import { icon } from '../icons.js';
import { whoSpins } from '../templates.js';
import { $, escapeHtml, formatDay, todayKey } from '../util.js';
import { isIOS, isInstalled } from './shared.js';
import { openWelcome } from './welcome.js';

const MAX_BACKUP_BYTES = 5_000_000;

export function render(view) {
  view.body.innerHTML = `
    ${backupFileSection()}
    ${snapshotSection()}
    ${unreadableSection()}
    ${iosSection()}
    <h3>Start over</h3>
    <button type="button" class="btn danger" id="b-wipe">Erase everything</button>
  `;
  bindBackupFile(view);
  bindSnapshots(view);
  bindUnreadable(view);
  bindErase(view);
}

// ---------------------------------------------------------------- backup files

function backupFileSection() {
  const { settings } = store.getState();
  const lastBackup = settings.lastBackup ? `Last backup: ${formatDay(settings.lastBackup)}.` : 'No backup yet.';
  return `
    <h3>Back up to a file</h3>
    <p>Progress is saved in this browser on this device. A backup file is the only copy that survives clearing browser data or a lost device.</p>
    <div class="row wrap">
      <button type="button" class="btn primary" id="b-export">${icon('download', { size: 18 })} Save backup file</button>
      <span class="hint">${lastBackup}</span>
    </div>

    <h3>Restore from a file</h3>
    <p class="hint">Replaces everything on this device with what's in the backup file. (An automatic snapshot is taken first, so this can be undone.)</p>
    <button type="button" class="btn" id="b-import">${icon('upload', { size: 18 })} Choose backup file…</button>
    <input type="file" id="b-import-file" accept="application/json,.json" hidden>`;
}

function bindBackupFile(view) {
  $('#b-export', view.body).addEventListener('click', async () => {
    if (!(await saveBackupFile())) return;
    store.updateSettings({ lastBackup: todayKey() });
    view.changed();
    view.showTab('backup', { keepScroll: true });
  });

  // A real button opens the (hidden) file picker, so keyboard users can reach it.
  const fileInput = $('#b-import-file', view.body);
  $('#b-import', view.body).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) await restoreFromFile(view, file);
  });
}

async function saveBackupFile() {
  const file = new File([store.exportJson()], `whirl-a-day-backup-${todayKey()}.json`, { type: 'application/json' });

  // On phones/tablets the share sheet ("Save to Files", AirDrop, email…) is the reliable path;
  // plain downloads misbehave in iOS home-screen apps.
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Whirl-a-Day backup' });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // Otherwise fall through to a normal download.
    }
  }
  downloadFile(file);
  return true;
}

async function restoreFromFile(view, file) {
  if (file.size > MAX_BACKUP_BYTES) {
    alertDialog('That file is too big to be a Whirl-a-Day backup.', { title: "Couldn't restore" });
    return;
  }
  let data;
  let next;
  try {
    data = JSON.parse(await file.text());
    next = store.parseBackup(data); // validates everything; throws if it isn't a usable backup
  } catch (err) {
    alertDialog(err instanceof SyntaxError ? "That file isn't a valid backup." : err.message, { title: "Couldn't restore" });
    return;
  }

  const contents = next.wheels.map((w) => `${store.wheelTitle(w)} (${whoSpins(w)})`).join('; ') || 'no wheels';
  const exportedAt = typeof data.exportedAt === 'string' ? new Date(data.exportedAt) : null;
  const when = exportedAt && !Number.isNaN(exportedAt.getTime()) ? ` from ${exportedAt.toLocaleString()}` : '';
  const notes = [
    store.getState().settings.pin && "This device's PIN stays the same.",
    store.isReadOnly() && 'The unreadable data on this device will be replaced; download it first (below) if you want to keep it.',
  ].filter(Boolean);
  const ok = await confirmDialog(`Restore the backup${when}: ${contents}? This replaces what's on this device now. ${notes.join(' ')}`, {
    title: 'Restore backup?',
    ok: 'Restore',
    danger: true,
  });
  if (!ok) return;

  store.replaceState(next);
  view.changed();
  view.showTab('backup');
  if (store.saveHealthy()) alertDialog('Your backup has been restored.', { title: 'All set 🎉' });
  else alertDialog("The backup was loaded, but it couldn't be saved on this device (storage may be full).", { title: 'Not saved' });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------- snapshots

function snapshotSection() {
  const snapshots = store.listSnapshots();
  const when = (at) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `
    <h3>Automatic snapshots</h3>
    <p class="hint">Saved on this device at the start of each day and before anything like a reset or restore, in case of mistakes. They don't replace a backup file: clearing browser data removes them too.</p>
    ${
      snapshots.length
        ? `<ul class="snapshot-list" id="b-snapshots">${snapshots
            .map(
              (s) => `
          <li>
            <div>
              <strong>${escapeHtml(when(s.at))}</strong> · ${escapeHtml(s.reason)}
              <span class="hint">${escapeHtml(s.summary)}</span>
            </div>
            <button type="button" class="btn small" data-snapshot="${escapeHtml(s.at)}" aria-label="Restore the snapshot from ${escapeHtml(when(s.at))}">Restore</button>
          </li>`,
            )
            .join('')}</ul>`
        : '<p class="hint"><em>None yet.</em></p>'
    }`;
}

function bindSnapshots(view) {
  $('#b-snapshots', view.body)?.addEventListener('click', async (event) => {
    const at = event.target.closest('[data-snapshot]')?.dataset.snapshot;
    const snapshot = store.listSnapshots().find((s) => s.at === at);
    if (!snapshot) return;
    const ok = await confirmDialog(`Go back to how things were (${snapshot.summary})? What's here now is snapshotted first, so you can switch back.`, {
      title: 'Restore snapshot?',
      ok: 'Restore',
    });
    if (!ok) return;
    try {
      store.restoreSnapshot(snapshot.at);
    } catch (err) {
      alertDialog(err.message, { title: "Couldn't restore" });
      return;
    }
    view.changed();
    view.showTab('backup');
  });
}

// ---------------------------------------------------------------- unreadable data

function unreadableSection() {
  if (!store.listUnreadableData().length) return '';
  return `
    <h3>Unreadable saved data</h3>
    <p class="hint">Saved data on this device couldn't be read, so a copy was kept. Download it if you want to try recovering it by hand (it's a text file).</p>
    <button type="button" class="btn" id="b-unreadable">${icon('download', { size: 18 })} Download unreadable data</button>`;
}

function bindUnreadable(view) {
  $('#b-unreadable', view.body)?.addEventListener('click', () => {
    const text = store
      .listUnreadableData()
      .map((item) => `--- saved ${item.savedAt} ---\n${item.raw}`)
      .join('\n\n');
    downloadFile(new File([text], `whirl-a-day-unreadable-${todayKey()}.txt`, { type: 'text/plain' }));
  });
}

// ---------------------------------------------------------------- iOS tip & erase

function iosSection() {
  if (!isIOS()) return '';
  const tip = isInstalled()
    ? "You're using the Home Screen app. 👍 Its progress is separate from Safari's."
    : 'Tap Share → <strong>Add to Home Screen</strong> and always open it from there. Safari may clear website data after 7 days without a visit; Home Screen apps are kept. Note the Home Screen app has its <strong>own separate data</strong>, so move progress over with a backup file.';
  return `<h3>iPhone &amp; iPad</h3><p class="hint">${tip}</p>`;
}

function bindErase(view) {
  $('#b-wipe', view.body).addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Delete all wheels, players, history and the PIN on this device? (An automatic snapshot is kept, but download a backup file first to be safe.)',
      { title: 'Erase everything?', ok: 'Erase', danger: true },
    );
    if (!ok) return;
    store.eraseAll();
    view.close();
    openWelcome();
  });
}
