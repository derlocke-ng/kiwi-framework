import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup } from '../../shared/backup.js';

test('round-trips a backup', async () => {
  const payload = { pair: { pub: 'p', priv: 's' }, boards: [{ pub: 'x', w: 'y' }], note: 'üñíçødé' };
  const file = await encryptBackup(payload, 'correct horse', { iterations: 100_000 });
  assert.equal(file.kind, 'wjs-backup');
  assert.ok(!JSON.stringify(file).includes('üñíçødé'));
  assert.deepEqual(await decryptBackup(JSON.parse(JSON.stringify(file)), 'correct horse'), payload);
});

test('rejects wrong passphrases and foreign files', async () => {
  const file = await encryptBackup({ a: 1 }, 'right', { iterations: 100_000 });
  await assert.rejects(decryptBackup(file, 'wrong'), /Wrong passphrase/);
  await assert.rejects(decryptBackup({ kind: 'other' }, 'x'), /not a backup file/);
  await assert.rejects(decryptBackup({ ...file, kdf: { ...file.kdf, iterations: 1 } }, 'right'), /Unsupported/);
});
