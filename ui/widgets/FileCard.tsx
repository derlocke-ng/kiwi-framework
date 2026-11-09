// A file a message carried (shared/files.js): its name, size and kind; a
// photo shows itself in the message, any file is saved with a tap. The bytes
// come from the sender's media server, are checked against both hashes and
// decrypted here; the server only ever held ciphertext.
//
//   {m.file ? <FileCard file={m.file} /> : <Text text={m.text} />}
import { useEffect, useState } from 'react';
import { fileSize, openFile } from '../../shared/files.js';
import { currentLanguage, tErr } from '../../shared/i18n.js';
import { Icon } from '../components';
import { useKiwi, useT } from '../hooks';
import { toast } from '../toast';
import '../../shared/widgets.css';

/** Photos up to this size load by themselves; bigger ones, and every other file, when asked for. */
const AUTO = 10 * 1024 * 1024;
const SHOWN = /^image\/(jpeg|png|webp|gif|avif)$/;

export function FileCard({ file }: { file: { url: string; x: string; key: string; nonce: string; type: string; name: string; size?: number } }) {
  const t = useT();
  const kiwi = useKiwi();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const image = SHOWN.test(file.type);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one file per card; its hash names it
  useEffect(() => {
    if (!image || (file.size ?? Number.POSITIVE_INFINITY) > AUTO) return;
    let url: string | null = null;
    let live = true;
    openFile(file, { servers: kiwi.mediaServers() })
      .then((bytes) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
        setPreview(url);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.x]);
  const save = async () => {
    setBusy(true);
    try {
      const bytes = await openFile(file, { servers: kiwi.mediaServers() });
      const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast(tErr(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="file-card" data-file={file.x}>
      {preview ? <img className="file-preview" src={preview} alt={file.name} /> : null}
      <div className="file-row">
        <Icon name={image ? 'image' : 'file'} />
        <span className="file-name" title={file.name}>
          {file.name}
        </span>
        {file.size != null ? <span className="file-size">{fileSize(file.size, currentLanguage())}</span> : null}
        <button type="button" className="icon-btn" data-act="save-file" aria-label={t('files.save', { name: file.name })} disabled={busy} onClick={save}>
          <Icon name="download" />
        </button>
      </div>
    </div>
  );
}
