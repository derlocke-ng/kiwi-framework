// Sending something into the chat from any app: a board's link, a file
// drop's link, a room's link. The person picks friends; each gets the text
// as a private message.
import { t } from '../shared/i18n.js';
import { pickPeople } from './dialogs';
import type { Kiwi } from './kiwi';
import { chatMount } from './notify';
import { toast } from './toast';

/** Pick friends and send them `text` as a message; resolves with how many. Nothing when the distribution has no chat. */
export async function sendAsMessage(kiwi: Kiwi, people: any, text: string): Promise<number> {
  const chat = chatMount();
  if (!chat || !kiwi.messages) return 0;
  const pks: string[] = await pickPeople(people, { base: kiwi.base });
  let n = 0;
  for (const pk of pks) {
    await kiwi.messages.send(pk, text);
    n++;
  }
  if (n) toast(t('share.sentInChat', { n, app: chat.name }), 'success');
  return n;
}
