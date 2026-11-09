// The generator: a password of random characters or a passphrase of random
// words, its strength in bits, a new one on every change of the choices. On a
// page of its own (it needs no open vault), and beside the password in the
// editor, where "Use" puts it into the field.
import { useState } from 'react';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { options as clean, generate, savedOptions, saveOptions } from '../data/generate.js';
import { copySecret } from './common';

export function Generator({ onUse }: { onUse?: (value: string) => void }) {
  const t = useT();
  const [opts, setOpts] = useState(savedOptions);
  const [out, setOut] = useState(() => generate(opts));
  const change = (patch: Record<string, any>) => {
    const next = clean({ ...opts, ...patch });
    setOpts(next);
    saveOptions(next);
    setOut(generate(next));
  };
  const check = (key: string) => (
    <label className="check-row" key={key}>
      <input type="checkbox" data-opt={key} checked={Boolean((opts as any)[key])} onChange={(e) => change({ [key]: e.target.checked })} />
      <span>{t(`pw.gen.${key}`)}</span>
    </label>
  );
  return (
    <div className="pw-generator" id="generator">
      <div className="pw-gen-out">
        <code id="generated">{out.value}</code>
        <span className="muted small" id="bits">
          {t('pw.gen.bits', { n: out.bits })}
        </span>
      </div>
      <div className="vault-buttons">
        <button type="button" className="btn" id="regenerate" onClick={() => setOut(generate(opts))}>
          <Icon name="dices" />
          <span>{t('pw.gen.again')}</span>
        </button>
        <button type="button" className="btn" id="copyGenerated" onClick={() => void copySecret(out.value, t('pw.field.password'))}>
          <Icon name="copy" />
          <span>{t('pw.gen.copy')}</span>
        </button>
        {onUse ? (
          <button type="button" className="btn btn-primary" id="useGenerated" onClick={() => onUse(out.value)}>
            <Icon name="check" />
            <span>{t('pw.gen.use')}</span>
          </button>
        ) : null}
      </div>
      <div className="pw-segment" role="radiogroup">
        {['password', 'passphrase'].map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={opts.mode === m}
            className={`chip${opts.mode === m ? ' active' : ''}`}
            data-mode={m}
            onClick={() => change({ mode: m })}
          >
            {t(`pw.gen.${m}`)}
          </button>
        ))}
      </div>
      {opts.mode === 'password' ? (
        <>
          <label className="field">
            <span>{t('pw.gen.length', { n: opts.length })}</span>
            <input type="range" id="genLength" min={8} max={64} value={opts.length} onChange={(e) => change({ length: Number(e.target.value) })} />
          </label>
          {['upper', 'lower', 'digits', 'symbols', 'avoidAmbiguous'].map(check)}
        </>
      ) : (
        <>
          <label className="field">
            <span>{t('pw.gen.words', { n: opts.words })}</span>
            <input type="range" id="genWords" min={3} max={12} value={opts.words} onChange={(e) => change({ words: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>{t('pw.gen.separator')}</span>
            <input id="genSeparator" maxLength={3} value={opts.separator} onChange={(e) => change({ separator: e.target.value })} />
          </label>
          {['capitalize', 'number'].map(check)}
        </>
      )}
    </div>
  );
}

/** A page of the app's own: a title with the way back, and what it shows. */
export function PageHead({ title }: { title: string }) {
  const t = useT();
  return (
    <div className="page-head">
      <a className="icon-btn back" href="#/" aria-label={t('pw.back')}>
        <Icon name="chevron-left" />
      </a>
      <h1>{title}</h1>
    </div>
  );
}

export function GeneratorPage() {
  const t = useT();
  return (
    <section className="pw-subpage">
      <PageHead title={t('pw.generator')} />
      <div className="card">
        <Generator />
      </div>
      <p className="muted small">{t('pw.how.generator')}</p>
    </section>
  );
}
