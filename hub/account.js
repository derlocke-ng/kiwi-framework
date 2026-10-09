// The account card: who you are on this device, and the sign-in / create /
// key form. Used by the landing page and the settings page.

import { t, tErr, has } from './shared/i18n.js';
import { loadIdentity, adoptIdentity, forgetIdentity, createAccount, login, importKey, pubkeyOf, checkPassword, npub, nsec, exportEncrypted } from './shared/account.js';
import { MOUNTS } from './shared/apps.js';
import { DISTRIBUTION } from './shared/distribution.js';

const featured = () => MOUNTS.find((m) => m.featured) || MOUNTS[0] || null;
import { fingerprint } from './shared/events.js';
import { $, h, icon, net, toast, startSuite } from './shell.js';

const changeListeners = new Set();
/** fn(identity) after a sign-in, account creation, key import or sign-out. */
export const onAccountChange = (fn) => {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
};

/** Render the card into `el` and keep it current. Returns a redraw function. */
export function mountAccount(el, { full = false } = {}) {
  const draw = () => {
    const id = loadIdentity();
    el.innerHTML = id.alias ? signedIn(id, full) : form(full);
  };
  el.addEventListener('change', onChange);
  el.addEventListener('submit', (e) => onSubmit(e, draw));
  el.addEventListener('click', (e) => onClick(e, draw));
  draw();
  return draw;
}

function signedIn(id, full) {
  return `
    <p>${t('account.signedIn', { alias: h(id.alias) })}</p>
    <p class="muted small">${h(t('hub.accountSigned'))} · ${h(t('account.publicKey'))} <code>${h(fingerprint(id.pk))}</code></p>
    <div class="form-actions">
      ${full || !featured() ? '' : `<a class="btn btn-primary" href="${featured().id}/">${icon(featured().icon)}<span>${h(t('hub.openApp', { name: featured().name }))}</span></a>`}
      ${full ? `<button type="button" class="btn" data-act="copy-pub">${icon('copy')}<span>${h(t('account.copyNpub'))}</span></button><button type="button" class="btn" data-act="export-key">${icon('key-round')}<span>${h(t('account.exportKey'))}</span></button>` : ''}
      <button type="button" class="btn btn-ghost" data-act="signout">${icon('log-out')}<span>${h(t('account.signOut'))}</span></button>
    </div>
    <div id="exportBox" hidden></div>`;
}

function form(full) {
  const id = loadIdentity();
  return `
    <p>${h(t('hub.accountText'))}</p>
    <div class="seg" role="tablist">
      <label><input type="radio" name="authTab" value="signin" checked><span>${h(t('account.tab.signIn'))}</span></label>
      <label><input type="radio" name="authTab" value="create"><span>${h(t('account.tab.create'))}</span></label>
      <label><input type="radio" name="authTab" value="import"><span>${h(t('account.tab.import'))}</span></label>
    </div>
    <form class="form" id="authForm" autocomplete="on">
      <label class="field" id="aliasField">${h(t('account.username'))}<input name="alias" autocomplete="username" required minlength="3" maxlength="40" spellcheck="false" autocapitalize="off"></label>
      <label class="field" id="keyField" hidden>${h(t('account.secretKey'))} <small>${h(t('account.secretKeyHint'))}</small><textarea name="key" rows="2" spellcheck="false" autocapitalize="off" placeholder="nsec1…"></textarea></label>
      <label class="field" id="passField"><span id="passLabel">${h(t('account.password'))}</span><input name="pass" type="password" autocomplete="current-password" required></label>
      <label class="field" id="confirmField" hidden>${h(t('account.repeatPassword'))}<input name="pass2" type="password" autocomplete="new-password"></label>
      <p class="hint" id="authHint">${h(t('account.hint.signIn'))}</p>
      <div class="form-actions"><button class="btn btn-primary" id="authBtn">${h(t('account.tab.signIn'))}</button><span class="progress-text" id="authProgress"></span></div>
      <p class="form-error" id="authError" role="alert" hidden></p>
    </form>
    <p class="muted small">${t('account.deviceKey')} ${full ? `${h(t('account.publicKey'))} <code>${h(fingerprint(id.pk))}</code> <button type="button" class="link-btn" data-act="export-key">${h(t('account.exportKey'))}</button>` : ''}</p>
    <div id="exportBox" hidden></div>`;
}

function onChange(e) {
  if (e.target.name !== 'authTab') return;
  const mode = e.target.value;
  const form = $('#authForm');
  $('#aliasField').hidden = mode === 'import';
  form.alias.required = mode !== 'import';
  $('#keyField').hidden = mode !== 'import';
  form.key.required = mode === 'import';
  form.pass.required = mode !== 'import';
  $('#confirmField').hidden = mode !== 'create';
  form.pass2.required = mode === 'create';
  form.pass.autocomplete = mode === 'create' ? 'new-password' : 'current-password';
  $('#passLabel').textContent = mode === 'import' ? t('account.passwordForKey') : t('account.password');
  $('#authBtn').textContent = { signin: t('account.tab.signIn'), create: t('account.tab.create'), import: t('account.button.import') }[mode];
  $('#authHint').textContent = { signin: t('account.hint.signIn'), create: t('account.hint.create'), import: t('account.hint.import') }[mode];
}

async function onSubmit(e, draw) {
  if (e.target.id !== 'authForm') return;
  e.preventDefault();
  const form = e.target;
  const mode = $('[name=authTab]:checked')?.value || 'signin';
  const btn = $('#authBtn');
  const progress = $('#authProgress');
  const error = $('#authError');
  const onProgress = (msg, params) => (progress.textContent = has(msg) ? t(msg, params) : msg);
  error.hidden = true;
  btn.disabled = true;
  try {
    const pass = form.pass.value;
    const current = loadIdentity();
    let next;
    if (mode === 'create') {
      checkPassword(pass);
      if (pass !== form.pass2.value) throw new Error(t('account.passwordsMismatch'));
      progress.textContent = t('account.progress.create');
      const { event, alias } = await createAccount(net, form.alias.value, pass, current.sk, onProgress);
      next = { ...current, alias, accountPk: event.pubkey };
    } else if (mode === 'signin') {
      progress.textContent = t('account.progress.signIn');
      const { sk, pk, alias, event } = await login(net.pool, form.alias.value, pass, onProgress);
      await net.db.put(event);
      next = { sk, pk, alias, accountPk: event.pubkey, created: Date.now() };
    } else {
      const sk = importKey(form.key.value, pass);
      next = { sk, pk: pubkeyOf(sk), alias: null, accountPk: null, created: Date.now() };
    }
    adoptIdentity(next);
    await startSuite();
    draw();
    for (const fn of changeListeners) fn(next);
    if (next.alias) toast(t('hub.welcome', { alias: next.alias }), 'success');
  } catch (err) {
    error.textContent = tErr(err);
    error.hidden = false;
    btn.disabled = false;
    progress.textContent = '';
  }
}

async function onClick(e, draw) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const id = loadIdentity();
  if (act === 'signout') {
    if (!confirm(t('account.signOutDialog.text'))) return;
    forgetIdentity();
    await startSuite();
    draw();
    for (const fn of changeListeners) fn(loadIdentity());
    toast(t('hub.signedOut'));
  }
  if (act === 'copy-pub') {
    try {
      await navigator.clipboard.writeText(npub(id.pk));
      toast(t('common.copied', { what: t('account.publicKey') }), 'success');
    } catch {
      toast(t('common.copyFailed'), 'error');
    }
  }
  if (act === 'export-key') {
    const box = $('#exportBox');
    box.hidden = !box.hidden;
    if (!box.hidden) {
      box.innerHTML = `
        <div class="export">
          <p class="small">${t('account.export.text')}</p>
          <div class="copy-field"><input id="nsecOut" readonly type="password" value="${h(nsec(id.sk))}" aria-label="${h(t('account.export.secretKey'))}"><button type="button" class="btn btn-sm" data-act="reveal">${h(t('common.show'))}</button><button type="button" class="btn btn-sm btn-primary" data-act="copy-nsec">${h(t('common.copy'))}</button></div>
          <form class="form" id="ncryptForm">
            <label class="field">${h(t('account.export.downloadLabel'))}<input name="pass" type="password" autocomplete="new-password" minlength="10" placeholder="${h(t('account.export.placeholder'))}"></label>
            <div class="form-actions"><button class="btn btn-sm">${h(t('account.export.download'))}</button></div>
          </form>
        </div>`;
      $('#ncryptForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const pass = ev.target.pass.value;
        if (pass.length < 10) return toast(t('account.export.min10'), 'error');
        const url = URL.createObjectURL(new Blob([`${exportEncrypted(id.sk, pass)}\n`], { type: 'text/plain' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `${DISTRIBUTION.id}-key-${id.alias || 'device'}.txt` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      });
    }
  }
  if (act === 'reveal') {
    const out = $('#nsecOut');
    out.type = out.type === 'password' ? 'text' : 'password';
    e.target.textContent = out.type === 'password' ? t('common.show') : t('common.hide');
  }
  if (act === 'copy-nsec') {
    try {
      await navigator.clipboard.writeText($('#nsecOut').value);
      toast(t('common.copied', { what: t('account.export.secretKey') }), 'success');
    } catch {
      toast(t('common.copyFailed'), 'error');
    }
  }
}
