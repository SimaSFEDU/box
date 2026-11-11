import { base64ToBytes, bytesToBase64 } from '../src/core/base64';
import { entrySubtitle, matchesQuery, newEntry, PAD_BLOCK, parseEntry, serializeEntry, sortEntries, type VaultEntry } from '../src/domain/vault/entries';
import { estimateStrength, masterPasswordProblem } from '../src/domain/vault/strength';

describe('base64', () => {
  it('round-trips all lengths and matches Node', () => {
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 73 + n) & 0xff);
      const s = bytesToBase64(b);
      expect(s).toBe(Buffer.from(b).toString('base64'));
      expect(base64ToBytes(s)).toEqual(b);
    }
    expect(() => base64ToBytes('@@@')).toThrow();
  });
});

describe('vault entries', () => {
  const login = (): VaultEntry => {
    const e = newEntry('login', 'id1', 1);
    e.title = 'GitHub';
    e.fields.find((f) => f.id === 'username')!.value = 'octo';
    e.fields.find((f) => f.id === 'password')!.value = 'hunter2';
    return e;
  };

  it('pads serialized form to hide secret length', () => {
    const a = login();
    const b = login();
    b.fields.find((f) => f.id === 'password')!.value = 'a-much-longer-password-than-before';
    const sa = serializeEntry(a);
    const sb = serializeEntry(b);
    expect(new TextEncoder().encode(sa).length % PAD_BLOCK).toBe(0);
    expect(new TextEncoder().encode(sa).length).toBe(new TextEncoder().encode(sb).length);
    expect(parseEntry(sa)).toEqual(a);
  });

  it('subtitles and search never use secret fields', () => {
    const e = login();
    expect(entrySubtitle(e)).toBe('octo');
    expect(matchesQuery(e, 'git octo')).toBe(true);
    expect(matchesQuery(e, 'hunter2')).toBe(false);
    const card = newEntry('card', 'c', 1);
    card.fields.find((f) => f.id === 'number')!.value = '4111 1111 1111 1234';
    expect(entrySubtitle(card)).toBe('•••• 1234');
  });

  it('parse rejects garbage and tolerates unknown types', () => {
    expect(() => parseEntry('{}')).toThrow();
    expect(parseEntry(JSON.stringify({ id: 'x', type: 'alien', fields: [] })).type).toBe('other');
  });

  it('sorts favorites first then by title', () => {
    const a = { ...login(), id: 'a', title: 'b' };
    const b = { ...login(), id: 'b', title: 'a' };
    const c = { ...login(), id: 'c', title: 'z', favorite: true };
    expect(sortEntries([a, b, c]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('password strength', () => {
  it('ranks passwords sensibly', () => {
    expect(estimateStrength('password').score).toBe(0);
    expect(estimateStrength('Password1').score).toBe(0);
    expect(estimateStrength('aaaaaaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
    expect(estimateStrength('abcdefghijklmnop').score).toBeLessThanOrEqual(2);
    expect(estimateStrength('correct horse battery staple').score).toBeGreaterThanOrEqual(3);
    expect(estimateStrength('q8#Lm2!vRt9@xZ4p').score).toBe(4);
  });
  it('enforces master password policy', () => {
    expect(masterPasswordProblem('short1!')).toMatch('10');
    expect(masterPasswordProblem('1234567890')).not.toBeNull();
    expect(masterPasswordProblem('aaaaaaaaaaaaaaaaaaa')).not.toBeNull();
    expect(masterPasswordProblem('лиса прыгает через забор 7')).toBeNull();
    expect(masterPasswordProblem('Tr0ub4dor&3-horse')).toBeNull();
  });
});

import { randomBytes } from 'crypto';
import { migrate } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import { createVaultRepo } from '../src/data/repositories/vaultRepo';
import { openNodeDb } from './helpers/nodeDb';

describe('vaultRepo', () => {
  it('stores wrapped keys and ciphertext as BLOBs, never in the standard tier or FTS', async () => {
    const db = openNodeDb();
    await migrate(db, migrations);
    const repo = createVaultRepo(db);
    const b = (n: number) => Buffer.from(randomBytes(n)).toString('base64');
    const meta = { kdfParams: '{"m_kib":65536}', wrappedPw: b(62), wrappedRecovery: b(62), dekCheck: b(41) };
    await repo.createMeta('vault', meta);
    expect(await repo.getMeta('vault')).toMatchObject({ ...meta, wrappedBio: null, autoLockSec: 60 });
    await repo.setWrappedBio('vault', b(60));
    expect((await repo.getMeta('vault'))!.wrappedBio).toHaveLength(80);
    const typ = await db.first<{ t: string }>("SELECT typeof(wrapped_dek_pw) AS t FROM encryption_metadata");
    expect(typ!.t).toBe('blob');

    const ct = b(300);
    await repo.putEntry('e1', ct, 1, 5);
    expect(await repo.listEntries()).toEqual([expect.objectContaining({ id: 'e1', payload: ct, createdAt: 5 })]);
    expect(await db.first('SELECT * FROM search_items')).toBeNull();
    expect(await db.first('SELECT * FROM library_items')).toBeNull();

    await repo.wipe('vault');
    expect(await repo.getMeta('vault')).toBeNull();
    expect(await repo.listEntries()).toEqual([]);
  });
});
