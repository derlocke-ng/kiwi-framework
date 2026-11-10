// Writing an entry, or a new version of one: text (markdown, #hashtags),
// photos (encrypted before upload, their keys inside the sealed entry), and
// who it is for. The person's usual choice of audience is in the app's
// settings; each choice says in one line who can read it. An entry can go
// into one of the writer's diaries (0.32), at a step ("Week 3"): it is then
// for the diary's readers, whoever the composer had chosen.
import { type FormEvent, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useSpace, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { ImageUpload } from '../../../ui/widgets/ImageUpload';
import { MediaImage } from '../../../ui/widgets/MediaImage';
import { Modal } from '../../../ui/widgets/Modal';
import { LABELS, LIMITS } from '../data/feed.js';
import { useAudienceChoices, useAudienceLabel, useFeed, usePrefs } from '../state';
import { useDiaries } from './Diaries';

/** The audience a new entry starts with: the person's usual one when it still exists here, else the space's or friends. */
export function defaultAudience(prefs: any, choices: string[]): string {
  const saved = String(prefs?.get('audience') || '');
  return choices.includes(saved) ? saved : choices[0];
}

/**
 * `onPosted`: the entry went out, for this audience (the feed shows the writer where it went). `diary`: it goes into
 * that diary of mine (a diary's page asked).
 */
export function Compose({
  existing = null,
  diary: forDiary = null,
  onClose,
  onPosted,
}: {
  existing?: any;
  diary?: any;
  onClose: () => void;
  onPosted?: (audience: string) => void;
}) {
  const t = useT();
  const { data } = useFeed();
  const prefs = usePrefs();
  const space = useSpace();
  const choices = useAudienceChoices(Boolean(space));
  const label = useAudienceLabel();
  const { list: allDiaries, get: getDiary } = useDiaries();
  // my diaries that go on: the ones an entry can go into
  const myDiaries = allDiaries.filter((x: any) => x.pubkey === data.identity.pk && (!x.done || x.d === existing?.diary));
  const [diaryD, setDiaryD] = useState<string>(forDiary?.d || existing?.diary || '');
  const diary = diaryD ? (forDiary?.d === diaryD ? forDiary : getDiary(data.identity.pk, diaryD)) : null;
  const [step, setStep] = useState<string>(existing?.step || '');
  const [text, setText] = useState<string>(existing?.text || '');
  const [media, setMedia] = useState<any[]>(existing?.media || []);
  const [audience, setAudience] = useState<string>(existing && choices.includes(existing.audience) ? existing.audience : defaultAudience(prefs, choices));
  const [entryLabel, setEntryLabel] = useState<string>(existing?.label || '');
  const [busy, setBusy] = useState(false);
  const hint = audience === 'space' ? 'space' : audience.startsWith('c:') ? 'circle' : audience;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim() && !media.length) return toast(t('fd.error.empty'), 'error');
    setBusy(true);
    try {
      await data.post({
        text,
        media,
        audience,
        label: entryLabel,
        diary,
        step,
        pinned: Boolean(existing?.pinned),
        bump: !existing,
        ...(existing ? { d: existing.d, at: existing.at } : {}),
      });
      onPosted?.(diary ? diary.audience : audience);
      onClose();
      toast(t(existing ? 'fd.saved' : 'fd.posted'), 'success');
    } catch (err) {
      setBusy(false);
      toast(tErr(err), 'error', 6000);
    }
  };
  return (
    <Modal
      open
      wide
      id="compose"
      title={existing ? t('fd.editTitle') : diary ? t('fd.diary.composeTitle', { title: diary.title }) : t('fd.newTitle')}
      onClose={onClose}
    >
      <form className="form compose" id="composeForm" onSubmit={submit}>
        <label className="field">
          <span>{t('fd.text')}</span>
          <textarea
            name="text"
            rows={5}
            maxLength={LIMITS.text}
            value={text}
            placeholder={t('fd.textPlaceholder')}
            data-autofocus
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p className="hint">{t('fd.textHint')}</p>
        {media.length ? (
          <ul className="compose-photos" id="composePhotos">
            {media.map((m, i) => (
              <li key={m.sha256} data-photo={i}>
                <MediaImage media={m} small alt={t('fd.photo', { n: i + 1 })} />
                <button
                  type="button"
                  className="icon-btn"
                  data-act="photo-remove"
                  aria-label={t('fd.removePhoto')}
                  onClick={() => setMedia(media.filter((x) => x !== m))}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {media.length < LIMITS.media ? (
          <ImageUpload allowPlain={false} label={t('fd.addPhoto')} disabled={busy} onUpload={(m) => setMedia((cur) => [...cur, m].slice(0, LIMITS.media))} />
        ) : (
          <p className="muted small">{t('fd.photosFull', { n: LIMITS.media })}</p>
        )}
        {forDiary || !myDiaries.length ? null : (
          <label className="field">
            <span>{t('fd.diary.field')}</span>
            <select name="diary" value={diaryD} onChange={(e) => setDiaryD(e.target.value)}>
              <option value="">{t('fd.diary.none')}</option>
              {myDiaries.map((x: any) => (
                <option key={x.d} value={x.d}>
                  {x.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {diary ? (
          <>
            <label className="field">
              <span>{t('fd.diary.step')}</span>
              <input name="step" maxLength={LIMITS.step} value={step} placeholder={t('fd.diary.stepPlaceholder')} onChange={(e) => setStep(e.target.value)} />
            </label>
            <p className="hint" id="audienceHint">
              <Icon name="notebook" /> {t('fd.diary.composeHint', { audience: label(diary.audience, space?.name) })}
            </p>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t('fd.audience')}</span>
              <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
                {choices.map((c) => (
                  <option key={c} value={c}>
                    {label(c, space?.name)}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint" id="audienceHint">
              <Icon name={audience === 'space' ? 'users-round' : 'lock'} /> {t(`fd.aud.${hint}.hint`, { space: space?.name || '' })}
            </p>
          </>
        )}
        <label className="field">
          <span>{t('fd.label')}</span>
          <select name="label" value={entryLabel} onChange={(e) => setEntryLabel(e.target.value)}>
            <option value="">{t('fd.label.none')}</option>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {t(`fd.label.${l}`)}
              </option>
            ))}
          </select>
        </label>
        {entryLabel ? <p className="hint">{t('fd.labelHint')}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {existing ? t('fd.save') : t('fd.post')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
