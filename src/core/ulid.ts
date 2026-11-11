/**
 * ULID generator (Crockford base32, 48-bit time + 80-bit randomness).
 * Randomness source is injected so tests run in Node and the app uses expo-crypto.
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type RandomBytes = (n: number) => Uint8Array;

let randomSource: RandomBytes | null = null;

export function setRandomSource(fn: RandomBytes) {
  randomSource = fn;
}

function encodeTime(time: number): string {
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = ENCODING[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  // 10 bytes = 80 bits = 16 base32 chars
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ENCODING[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  if (!randomSource) throw new Error('ULID random source is not configured');
  return encodeTime(now) + encodeRandom(randomSource(10));
}
