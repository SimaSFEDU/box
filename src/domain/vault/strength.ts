/**
 * Conservative password strength estimate (no dictionary bundled): character-pool entropy with
 * penalties for repeats, sequences and very common passwords. Used for the master password policy
 * and generator feedback. Deliberately underestimates rather than overestimates.
 */
const COMMON = new Set([
  'password', 'passw0rd', '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwertyuiop', 'йцукен', 'йцукенгшщз', '111111', '000000',
  'iloveyou', 'admin', 'welcome', 'letmein', 'monkey', 'dragon', 'football', 'baseball', 'master', 'superman', 'пароль', 'qwerty123', 'abc123',
]);

export interface Strength {
  bits: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function estimateStrength(pw: string): Strength {
  if (!pw) return { bits: 0, score: 0, label: 'Пусто' };
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.replace(/\d+$/, ''))) return { bits: 5, score: 0, label: 'Очень слабый' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^\w\sа-яё]/i.test(pw)) pool += 32;
  if (/[а-яё]/i.test(pw)) pool += 33;
  if (/\s/.test(pw)) pool += 1;
  const chars = [...pw];
  // Effective length: collapse runs of the same char and simple +/-1 sequences.
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!.codePointAt(0)!;
    const p = i > 0 ? chars[i - 1]!.codePointAt(0)! : -10;
    effective += c === p ? 0.25 : Math.abs(c - p) === 1 ? 0.5 : 1;
  }
  const unique = new Set(chars).size;
  const bits = Math.round(effective * Math.log2(Math.max(pool, 2)) * Math.min(1, 0.5 + unique / (2 * chars.length)));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, score: score as Strength['score'], label: ['Очень слабый', 'Слабый', 'Средний', 'Надёжный', 'Очень надёжный'][score]! };
}

/** Master password policy (SECURITY_DESIGN §4.3): ≥ 10 characters and ≥ 60 estimated bits. */
export function masterPasswordProblem(pw: string): string | null {
  if ([...pw].length < 10) return 'Минимум 10 символов';
  if (estimateStrength(pw).bits < 60) return 'Слишком предсказуемый пароль — добавьте слова, цифры или символы';
  return null;
}
