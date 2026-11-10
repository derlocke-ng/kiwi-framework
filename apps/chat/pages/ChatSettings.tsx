// The chat's own settings: the nickname suggested for rooms (this device's).
import { AppSettings, useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { NICK } from '../data/rooms.js';
import { savedNick, saveNick } from '../state';

/** "How it works": rooms are the chat's own; the rest are the framework's topics (shared/how.js). */
export const HOW_CHAT = ['privateMessages', 'chat.how.2', 'chat.how.1', 'friends', 'blocks', 'offline'];

export function ChatSettings() {
  const t = useT();
  const mount = useMount();
  return (
    <AppSettings title={t('app.settings.title', { app: mount.name })} backLabel={t('chat.back')} how={HOW_CHAT}>
      <div className="card">
        <h2>
          <Icon name="radio" />
          {t('chat.settings.rooms')}
        </h2>
        <label className="field">
          {t('chat.settings.nick')}
          <input id="nickDefault" maxLength={NICK} defaultValue={savedNick()} autoComplete="nickname" onChange={(e) => saveNick(e.target.value)} />
        </label>
        <p className="muted small">{t('chat.settings.nickHint')}</p>
      </div>
    </AppSettings>
  );
}
