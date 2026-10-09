// The site's settings: account, language and appearance, apps, relays,
// backup, this device. Everything an app used to carry on its own.

import { t, tErr, LANGUAGES, currentLanguage, relTime, fmtDateTime } from './shared/i18n.js';
import { savedRelays, saveRelays, normalizeRelayUrl, DEFAULT_RELAYS } from './shared/relays.js';
import { loadIdentity, adoptIdentity, forgetIdentity } from './shared/account.js';
import { isHex64 } from './shared/events.js';
import { pubkeyOf } from './shared/account.js';
import { encryptBackup, decryptBackup } from './shared/backup.js';
import { theme } from './shared/theme.js';
import { npub, decodeKey } from './shared/account.js';
import { fingerprint } from './shared/events.js';
import { store } from './shared/util.js';
import { bootShell, net, suite, onSuite, onLanguage, chooseLanguage, chooseTheme, hiddenApps, setAppHidden, startPeople, blocks, people, $, $$, h, icon, toast } from './shell.js';
import { copyText } from './shared/ui.js';
import { MOUNTS } from './shared/apps.js';
import { DISTRIBUTION } from './shared/distribution.js';
import { cores, hardwareCores, CORES_KEY } from './shared/pow.js';
import { mountAccount, onAccountChange } from './account.js';
import { mountTopbar } from './shared/topbar.js';
import { statusPill, mountStatus } from './shared/status.js';

const LAST_BACKUP = 'wjs.lastBackup';
const infos = new Map();

function drawLanguage() {
  const select = $('#langSelect');
  select.innerHTML = Object.entries(LANGUAGES)
    .map(([code, name]) => `<option value="${code}" ${code === currentLanguage() ? 'selected' : ''}>${h(name)}</option>`)
    .join('');
  select.setAttribute('aria-label', t('lang.title'));
  $('#themeSeg').setAttribute('aria-label', t('account.appearance'));
  for (const input of $$('#themeSeg input')) input.checked = input.value === theme();
}

function drawApps() {
  const hidden = hiddenApps();
  $('#appToggles').innerHTML = MOUNTS.map(
    (app) => `<li><label class="check-row"><input type="checkbox" data-app="${app.id}" ${hidden.includes(app.id) ? '' : 'checked'}><span>${h(app.name)}</span></label></li>`,
  ).join('');
}

/** Proof of work is a device matter: how many cores the shared miner (shared/pow.js) may use. */
function drawPow() {
  $('#powText').textContent = t('settings.powText', { n: hardwareCores() });
  const max = Math.max(hardwareCores(), cores());
  $('#coresSelect').innerHTML = Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === cores() ? 'selected' : ''}>${n}</option>`)
    .join('');
}

async function drawRelays() {
  const list = $('#relayList');
  const { waiting } = await net.sync.outbox();
  const status = net.pool.status().relays;
  list.innerHTML = savedRelays()
    .map((url) => {
      const r = status.find((x) => x.url === url);
      const info = infos.get(url);
      const state = r?.open ? (r.latency != null ? t('relay.latency', { n: r.latency }) : t('relay.connected')) : t('relay.notConnected');
      const detail = [info?.countries?.join(', '), info?.name].filter(Boolean).join(' · ');
      const problems = [waiting[url] ? t('relay.waiting', { n: waiting[url] }) : '', r?.publishError ? t('relay.rejected', { error: r.publishError, when: relTime(r.publishErrorAt) }) : ''].filter(Boolean).join(' · ');
      return `<li class="${r?.open ? 'up' : 'down'}"><span class="dot"></span><span class="relay-name">${h(url.replace(/^wss?:\/\//, ''))}${detail ? ` <span class="relay-detail">${h(detail)}</span>` : ''}</span><span class="relay-state">${h(state)}</span>${problems ? `<span class="relay-problem small">${h(problems)}</span>` : ''}</li>`;
    })
    .join('');
  if (!$('#relayForm textarea').value) $('#relayForm textarea').value = savedRelays().join('\n');
}

/** The block list and People come from the shell; after a restart (new identity) they are bound again. */
function bindPeople() {
  blocks.onChange(drawBlocked);
  people.onChange(drawPeople);
  drawBlocked();
  drawPeople();
}

function drawPeople() {
  if (!people) return;
  $('#myNpub').textContent = npub(loadIdentity().pk);
  const fp = (pk) => `<code title="${h(npub(pk))}">${h(fingerprint(pk))}</code>`;
  const who = (name, pk) => `<span class="who">${name ? `<b>${h(name)}</b> ` : ''}${fp(pk)}</span>`;
  const requests = [
    ...people.incoming().map(
      (r) => `<li data-pk="${r.pk}">${who(r.name, r.pk)}<span class="muted small">${h(t('settings.requestIncoming'))}</span><span class="actions"><button type="button" class="btn btn-sm btn-primary" data-accept="${r.pk}">${h(t('settings.accept'))}</button><button type="button" class="btn btn-sm btn-ghost" data-ignore="${r.pk}">${h(t('settings.ignore'))}</button></span></li>`,
    ),
    ...people.outgoing().map((r) => `<li data-pk="${r.pk}">${who('', r.pk)}<span class="muted small">${h(t('settings.requestOutgoing'))}</span><span class="actions"><button type="button" class="btn btn-sm btn-ghost" data-cancel="${r.pk}">${h(t('settings.cancelRequest'))}</button></span></li>`),
  ];
  $('#requestList').innerHTML = requests.join('');
  $('#requestList').hidden = !requests.length;
  const friends = people.friends();
  $('#friendList').innerHTML = friends.length
    ? friends.map((f) => `<li data-pk="${f.pk}">${who(f.name, f.pk)}<span class="actions"><button type="button" class="btn btn-sm btn-ghost" data-remove="${f.pk}">${h(t('settings.removeFriend'))}</button></span></li>`).join('')
    : `<li class="muted small">${h(t('settings.noFriends'))}</li>`;
  $('#circleList').innerHTML = people
    .circles()
    .map(
      (c) => `<div class="circle" data-circle="${c.id}">
        <div class="circle-head"><b>${h(c.name)}</b><button type="button" class="btn btn-sm btn-ghost" data-circle-delete="${c.id}">${h(t('settings.circleDelete'))}</button></div>
        ${friends.length ? `<ul class="people-list">${friends.map((f) => `<li><label class="check-row"><input type="checkbox" data-circle-member="${c.id}" value="${f.pk}" ${c.members.includes(f.pk) ? 'checked' : ''}><span>${f.name ? `${h(f.name)} ` : ''}${fp(f.pk)}</span></label></li>`).join('')}</ul>` : `<p class="muted small">${h(t('settings.circleEmpty'))}</p>`}
      </div>`,
    )
    .join('');
}

function drawBlocked() {
  const list = $('#blockedList');
  const entries = blocks?.list() || [];
  list.innerHTML = entries.length
    ? entries
        .map((e) => `<li><code title="${h(npub(e.pubkey))}">${h(fingerprint(e.pubkey))}</code>${e.reason ? `<span class="muted small">${h(e.reason)}</span>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-unblock="${e.pubkey}">${h(t('settings.unblock'))}</button></li>`)
        .join('')
    : `<li class="muted small">${h(t('settings.blockedEmpty'))}</li>`;
}

function drawHow() {
  $('#howList').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<li>${t(`account.how.${i}`)}</li>`).join('');
}

function drawBackupNote() {
  const at = store.get(LAST_BACKUP);
  $('#lastBackup').textContent = at ? t('account.lastBackup', { when: fmtDateTime(at) }) : '';
}

async function diagnostics() {
  const id = loadIdentity();
  const box = await net.sync.outbox();
  const kinds = {};
  for (const ev of await net.db.byAuthor(id.pk)) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
  return JSON.stringify(
    {
      at: new Date().toISOString(),
      lang: currentLanguage(),
      account: Boolean(id.alias),
      pubkey: id.pk,
      ownEventsByKind: kinds,
      outbox: box,
      relays: net.pool.status().relays.map((r) => ({ url: r.url, open: r.open, latency: r.latency, lastOk: r.lastOkAt ? new Date(r.lastOkAt).toISOString() : null, publishError: r.publishError, connectError: r.error || null, info: infos.get(r.url)?.name || null })),
      userAgent: navigator.userAgent,
    },
    null,
    2,
  );
}

async function downloadBackup(pass) {
  const id = loadIdentity();
  const events = await net.db.all();
  const payload = { app: 'kiwi', v: 3, created: new Date().toISOString(), identity: id, events };
  const file = await encryptBackup(payload, pass);
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${DISTRIBUTION.id}-backup-${id.alias || 'device'}-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  store.set(LAST_BACKUP, Date.now());
  drawBackupNote();
  return events.length;
}

async function restoreBackup(fileObj, pass, onProgress) {
  const payload = await decryptBackup(JSON.parse(await fileObj.text()), pass);
  const id = payload.identity;
  if (!isHex64(id?.sk) || pubkeyOf(id.sk) !== id.pk) throw new Error(t('account.restoreDialog.noKey'));
  const events = Array.isArray(payload.events) ? payload.events : [];
  onProgress(t('session.restoring', { n: events.length }));
  for (const ev of events) await net.db.put(ev);
  adoptIdentity({ sk: id.sk, pk: id.pk, alias: id.alias || null, accountPk: id.accountPk || null, created: Date.now() });
  for (const ev of events) net.sync.publish(ev).catch(() => {});
  onProgress(t('session.syncing'));
  await new Promise((r) => setTimeout(r, 1500));
  location.reload();
}

function wipeDevice() {
  forgetIdentity();
  for (const key of Object.keys(localStorage)) if (/^(wjs\.(identity|carried|settings)|loadout\.)/.test(key)) localStorage.removeItem(key);
  net.db.clear().finally(() => location.replace('./'));
}

async function boot() {
  await bootShell({ current: 'settings' });
  const drawTop = () => {
    mountTopbar($('#top'), {
      base: './',
      current: 'settings',
      hidden: hiddenApps,
      brand: { href: './', html: DISTRIBUTION.brandHtml, label: DISTRIBUTION.name },
      right: `${statusPill({ href: '#relays' })}<a class="wjs-pill" href="./">${icon('chevron-left')}<span>${h(t('settings.back'))}</span></a>`,
    });
    mountStatus($('#sync'), net);
  };
  drawTop();
  const redrawAccount = mountAccount($('#accountBody'), { full: true });
  bindPeople();
  drawLanguage();
  drawApps();
  drawPow();
  drawHow();
  drawBackupNote();
  await drawRelays();
  net.pool.onStatus(() => drawRelays());
  net.sync.onChange(() => drawRelays());
  for (const url of savedRelays()) {
    net.pool.info(url).then((info) => {
      if (info) {
        infos.set(url, info);
        drawRelays();
      }
    });
  }
  onLanguage(() => {
    drawTop();
    drawBlocked();
    drawPeople();
    drawLanguage();
    drawApps();
    drawPow();
    drawHow();
    drawBackupNote();
    drawRelays();
    redrawAccount();
  });
  onSuite(() => {
    drawApps();
    drawLanguage();
  });
  onAccountChange(() => {
    drawApps();
    drawLanguage();
    startPeople('settings').then(bindPeople).catch(() => {});
  });
  $('#people').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-accept],[data-ignore],[data-cancel],[data-remove],[data-act=copy-npub]');
    if (!b) return;
    try {
      if (b.dataset.act === 'copy-npub') await copyText(npub(loadIdentity().pk), t('account.publicKey'));
      else if (b.dataset.accept) await people.accept(b.dataset.accept);
      else if (b.dataset.ignore) await people.ignore(b.dataset.ignore);
      else if (b.dataset.cancel) await people.cancel(b.dataset.cancel);
      else if (b.dataset.remove) await people.remove(b.dataset.remove);
    } catch (err) {
      toast(tErr(err), 'error');
    }
  });
  $('#friendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let pk;
    try {
      pk = decodeKey(e.target.who.value.trim());
    } catch {
      return toast(t('settings.blockInvalid'), 'error');
    }
    if (pk === loadIdentity().pk) return toast(t('settings.selfKey'), 'error');
    try {
      const result = await people.request(pk);
      e.target.reset();
      toast(t(result === 'friends' ? 'settings.nowFriends' : 'settings.requestSent'), 'success');
    } catch (err) {
      toast(tErr(err), 'error');
    }
  });
  $('#circleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    try {
      await people.circleCreate(name);
      e.target.reset();
    } catch (err) {
      toast(tErr(err), 'error');
    }
  });
  $('#circles').addEventListener('click', (e) => {
    const id = e.target.closest('[data-circle-delete]')?.dataset.circleDelete;
    if (id) people.circleRemove(id).catch((err) => toast(tErr(err), 'error'));
  });
  $('#circles').addEventListener('change', (e) => {
    const id = e.target.dataset.circleMember;
    if (!id) return;
    people.circleSet(id, $$(`[data-circle-member="${id}"]:checked`).map((i) => i.value)).catch((err) => toast(tErr(err), 'error'));
  });
  $('#blockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const who = e.target.who.value.trim();
    let pk;
    try {
      pk = decodeKey(who);
    } catch {
      return toast(t('settings.blockInvalid'), 'error');
    }
    if (pk === loadIdentity().pk) return toast(t('settings.blockInvalid'), 'error');
    try {
      await blocks.block(pk);
      e.target.reset();
    } catch (err) {
      toast(tErr(err), 'error');
    }
  });
  $('#blockedList').addEventListener('click', (e) => {
    const pk = e.target.closest('[data-unblock]')?.dataset.unblock;
    if (pk) blocks.unblock(pk).catch((err) => toast(tErr(err), 'error'));
  });

  $('#langSelect').addEventListener('change', (e) => chooseLanguage(e.target.value));
  $('#coresSelect').addEventListener('change', (e) => store.set(CORES_KEY, Number(e.target.value)));
  $('#themeSeg').addEventListener('change', (e) => {
    if (e.target.name === 'theme') chooseTheme(e.target.value);
  });
  $('#appToggles').addEventListener('change', (e) => {
    const app = e.target.dataset.app;
    if (app) setAppHidden(app, !e.target.checked).catch((err) => toast(tErr(err), 'error'));
  });
  $('#relayForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const list = e.target.relays.value.split('\n').filter((l) => l.trim());
    if (list.some((l) => !normalizeRelayUrl(l))) return toast(t('account.invalidRelay'), 'error');
    saveRelays(list);
    location.reload();
  });
  $('#backupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.pass.value.length < 10) return toast(t('account.export.min10'), 'error');
    if (f.pass.value !== f.pass2.value) return toast(t('account.backupDialog.mismatch'), 'error');
    const progress = $('#bkProgress');
    progress.textContent = t('account.backupDialog.encrypting');
    try {
      const n = await downloadBackup(f.pass.value);
      f.hidden = true;
      f.reset();
      toast(t('settings.backedUp', { n }), 'success');
    } catch (err) {
      toast(tErr(err), 'error');
    } finally {
      progress.textContent = '';
    }
  });
  let restoreFile = null;
  $('#restoreFile').addEventListener('change', (e) => {
    restoreFile = e.target.files[0] || null;
    $('#restoreForm').hidden = !restoreFile;
    $('#backupForm').hidden = true;
    $('#restoreForm [name=pass]')?.focus();
  });
  $('#restoreForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!restoreFile) return;
    const btn = e.target.querySelector('.btn-primary');
    const error = $('#rsError');
    error.hidden = true;
    btn.disabled = true;
    try {
      $('#rsProgress').textContent = t('account.restoreDialog.decrypting');
      await restoreBackup(restoreFile, e.target.pass.value, (msg) => ($('#rsProgress').textContent = msg));
    } catch (err) {
      error.textContent = err instanceof SyntaxError ? t('account.restoreDialog.notJson') : tErr(err);
      error.hidden = false;
      btn.disabled = false;
      $('#rsProgress').textContent = '';
    }
  });
  document.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'backup') {
      $('#backupForm').hidden = false;
      $('#restoreForm').hidden = true;
      $('#backupForm [name=pass]').focus();
    }
    if (act === 'cancel-backup') $('#backupForm').hidden = true;
    if (act === 'cancel-restore') {
      $('#restoreForm').hidden = true;
      $('#restoreFile').value = '';
    }
    if (act === 'relay-reset') {
      saveRelays(DEFAULT_RELAYS);
      location.reload();
    }
    if (act === 'sync-now') {
      const btn = e.target.closest('[data-act]');
      btn.disabled = true;
      try {
        await net.sync.healAll();
        toast(t('account.synced'), 'success');
      } catch (err) {
        toast(tErr(err), 'error');
      } finally {
        btn.disabled = false;
        drawRelays();
      }
    }
    if (act === 'diagnostics') {
      try {
        await navigator.clipboard.writeText(await diagnostics());
        toast(t('common.copied', { what: t('account.diagnostics') }), 'success');
      } catch {
        toast(t('common.copyFailed'), 'error');
      }
    }
    if (act === 'wipe' && confirm(t('settings.wipeConfirm'))) wipeDevice();
  });
}

boot().catch((err) => {
  console.error(err);
  document.documentElement.classList.add('i18n');
  toast(err.message, 'error');
});
