// The first visit: where the calendar is and the login for it. The hub's own
// forwarding to a Nextcloud (or the address its distribution names) is filled
// in; Nextcloud wants an app password, made in its security settings. The
// login is tried before it is kept, then kept in the account (sealed to the
// person's key), so every device they sign in on has the calendar.
import { type FormEvent, useState } from 'react';
import { CalDav } from '../../../shared/caldav.js';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { defaultServer } from '../App';
import { useCalendar } from '../state';

export function LoginForm({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const { prefs, retry } = useCalendar();
  const offered = defaultServer();
  const [server, setServer] = useState<string>(prefs.get('server') || offered);
  const [username, setUsername] = useState<string>(prefs.get('username') || '');
  const [password, setPassword] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pass = password || prefs.get('password') || '';
    setBusy(true);
    setError('');
    try {
      const calendars = await new CalDav({ server: server.trim(), username: username.trim(), password: pass }).connect();
      await prefs.set({ server: server.trim(), username: username.trim(), password: pass });
      retry();
      toast(t('cal.connected', { n: calendars.length }), 'success');
      setPassword('');
      onDone?.();
    } catch (err) {
      setError(tErr(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" id="loginForm" onSubmit={submit}>
      <label className="field">
        <span>{t('cal.server')}</span>
        <input
          name="server"
          value={server}
          required
          inputMode="url"
          autoComplete="url"
          placeholder="https://cloud.example.org"
          onChange={(e) => setServer(e.target.value)}
        />
      </label>
      {offered && server === offered ? (
        // a path is the hub's own forwarding to its Nextcloud; an address, a server the hub suggests
        <p className="hint">{t(offered.startsWith('/') ? 'cal.serverOffered' : 'cal.serverSuggested')}</p>
      ) : (
        <p className="hint">{t('cal.serverHint')}</p>
      )}
      <label className="field">
        <span>{t('cal.username')}</span>
        <input name="username" value={username} required autoComplete="username" autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('cal.password')}</span>
        <input
          name="password"
          type="password"
          value={password}
          required={!prefs.get('password')}
          autoComplete="current-password"
          placeholder={prefs.get('password') ? t('cal.passwordKept') : ''}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="hint" dangerouslySetInnerHTML={{ __html: t('cal.passwordHint') }} />
      {error ? (
        <p className="form-error" id="loginError" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button type="submit" className="btn btn-primary" id="connectBtn" disabled={busy}>
          <Icon name="link" />
          <span>{busy ? t('cal.connecting') : t('cal.connect')}</span>
        </button>
      </div>
    </form>
  );
}

export function Connect() {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  return (
    <section className="cal-connect">
      <div className="card">
        <h2>
          <Icon name="calendar-days" />
          {t('cal.connectTitle')}
        </h2>
        <p>{t('cal.connectText')}</p>
        <LoginForm />
      </div>
      <p className="muted small">
        {id.alias ? t('cal.keptInAccount') : t('cal.keptOnDevice')} <a href={`${kiwi.base}settings.html#account`}>{t('cal.accountLink')}</a>
      </p>
    </section>
  );
}
