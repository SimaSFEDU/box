/**
 * Vault entry model (plaintext side). Serialized JSON is what gets encrypted natively; it is padded
 * to a multiple of 256 bytes so ciphertext length does not reveal password length (SECURITY §5).
 */
export type VaultEntryType = 'login' | 'note' | 'card' | 'wifi' | 'apikey' | 'document' | 'other';
export type FieldKind = 'text' | 'password' | 'url' | 'multiline' | 'number';

export interface VaultField {
  id: string;
  label: string;
  value: string;
  kind: FieldKind;
  secret: boolean;
}

export interface VaultEntry {
  id: string;
  type: VaultEntryType;
  title: string;
  fields: VaultField[];
  notes: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export const SCHEMA_VERSION = 1;
export const PAD_BLOCK = 256;

export const TYPE_META: Record<VaultEntryType, { label: string; icon: string }> = {
  login: { label: 'Логин', icon: 'key' },
  note: { label: 'Секретная заметка', icon: 'file-text' },
  card: { label: 'Карта', icon: 'credit-card' },
  wifi: { label: 'Wi‑Fi', icon: 'wifi' },
  apikey: { label: 'API-ключ / токен', icon: 'terminal' },
  document: { label: 'Документ', icon: 'book' },
  other: { label: 'Другое', icon: 'lock' },
};

type FieldTemplate = Omit<VaultField, 'value'>;
const f = (id: string, label: string, kind: FieldKind, secret = false): FieldTemplate => ({ id, label, kind, secret });

const TEMPLATES: Record<VaultEntryType, FieldTemplate[]> = {
  login: [f('username', 'Логин', 'text'), f('password', 'Пароль', 'password', true), f('url', 'Сайт', 'url')],
  note: [f('content', 'Содержимое', 'multiline', true)],
  card: [f('holder', 'Владелец', 'text'), f('number', 'Номер карты', 'number', true), f('expiry', 'Срок (ММ/ГГ)', 'text'), f('cvv', 'CVV', 'password', true), f('pin', 'PIN', 'password', true)],
  wifi: [f('ssid', 'Сеть (SSID)', 'text'), f('password', 'Пароль', 'password', true), f('security', 'Шифрование', 'text')],
  apikey: [f('service', 'Сервис', 'text'), f('key', 'Ключ / токен', 'password', true), f('url', 'Документация / консоль', 'url')],
  document: [f('docType', 'Тип документа', 'text'), f('number', 'Номер', 'text', true), f('issued', 'Выдан', 'text'), f('expires', 'Действует до', 'text')],
  other: [f('secret', 'Секрет', 'password', true)],
};

export function newEntry(type: VaultEntryType, id: string, now: number): VaultEntry {
  return { id, type, title: '', fields: TEMPLATES[type].map((t) => ({ ...t, value: '' })), notes: '', favorite: false, createdAt: now, updatedAt: now };
}

export function fieldValue(e: VaultEntry, id: string): string {
  return e.fields.find((x) => x.id === id)?.value ?? '';
}

export function serializeEntry(e: VaultEntry): string {
  const base = JSON.stringify({ ...e, v: SCHEMA_VERSION, _pad: '' });
  const len = new TextEncoder().encode(base).length;
  const pad = (PAD_BLOCK - (len % PAD_BLOCK)) % PAD_BLOCK;
  return JSON.stringify({ ...e, v: SCHEMA_VERSION, _pad: ' '.repeat(pad) });
}

export function parseEntry(json: string): VaultEntry {
  const o = JSON.parse(json) as Partial<VaultEntry> & { v?: number };
  if (!o || typeof o.id !== 'string' || typeof o.type !== 'string' || !Array.isArray(o.fields)) throw new Error('invalid entry');
  return {
    id: o.id,
    type: (o.type in TYPE_META ? o.type : 'other') as VaultEntryType,
    title: String(o.title ?? ''),
    fields: o.fields.map((x) => ({ id: String(x.id), label: String(x.label), value: String(x.value ?? ''), kind: x.kind ?? 'text', secret: !!x.secret })),
    notes: String(o.notes ?? ''),
    favorite: !!o.favorite,
    createdAt: Number(o.createdAt ?? 0),
    updatedAt: Number(o.updatedAt ?? 0),
  };
}

export const recordAd = (id: string, schemaVer = SCHEMA_VERSION) => `${id}:${schemaVer}`;

/** Non-secret summary line for lists (never shows secret fields). */
export function entrySubtitle(e: VaultEntry): string {
  const firstPublic = e.fields.find((x) => !x.secret && x.value.trim() && x.kind !== 'multiline');
  if (e.type === 'card') {
    const num = fieldValue(e, 'number').replace(/\D/g, '');
    return num.length >= 4 ? `•••• ${num.slice(-4)}` : TYPE_META.card.label;
  }
  return firstPublic?.value ?? TYPE_META[e.type].label;
}

/** In-memory search over non-secret fields only. */
export function matchesQuery(e: VaultEntry, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [e.title, TYPE_META[e.type].label, ...e.fields.filter((x) => !x.secret).map((x) => x.value)].join(' ').toLowerCase();
  return needle.split(/\s+/).every((t) => hay.includes(t));
}

export function sortEntries(list: VaultEntry[]): VaultEntry[] {
  return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }));
}
