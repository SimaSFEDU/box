package app.clipbox.nativemodule.crypto

import com.google.crypto.tink.subtle.AesGcmJce
import com.google.crypto.tink.subtle.Hkdf
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Pure-JVM cryptographic core for protected modules (docs/SECURITY_DESIGN.md §3–5).
 * No Android dependencies, so it is unit-tested on the JVM. Uses only vetted primitives:
 * AES-256-GCM (JCA / Tink AesGcmJce), Argon2id (Bouncy Castle), HKDF-SHA256 (Tink).
 */
object VaultCrypto {
  const val KEY_BYTES = 32
  const val SALT_BYTES = 16
  const val RECOVERY_BYTES = 16
  private const val WRAP_VERSION: Byte = 1
  private const val ALG_AES256_GCM: Byte = 1
  private const val NONCE_BYTES = 12
  private const val TAG_BITS = 128

  val random: SecureRandom = SecureRandom()

  class AuthFailedException(message: String) : GeneralSecurityException(message)

  data class KdfParams(val memoryKib: Int, val iterations: Int, val parallelism: Int, val salt: ByteArray) {
    fun toJson(): String =
      """{"alg":"argon2id","v":19,"m_kib":$memoryKib,"t":$iterations,"p":$parallelism,"salt":"${b64(salt)}"}"""

    companion object {
      /** Baseline from SECURITY_DESIGN §4.3; calibration may only raise `iterations`. */
      val BASELINE = Triple(64 * 1024, 3, 1)

      fun fromJson(json: String): KdfParams {
        fun int(k: String) = Regex("\"$k\"\\s*:\\s*(\\d+)").find(json)?.groupValues?.get(1)?.toInt()
          ?: throw IllegalArgumentException("kdf param $k missing")
        val salt = Regex("\"salt\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"").find(json)?.groupValues?.get(1)
          ?: throw IllegalArgumentException("salt missing")
        val p = KdfParams(int("m_kib"), int("t"), int("p"), unb64(salt))
        require(p.memoryKib in 8 * 1024..1024 * 1024 && p.iterations in 1..20 && p.parallelism in 1..8 && p.salt.size >= 16) { "kdf params out of range" }
        return p
      }
    }
  }

  fun randomBytes(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

  fun newSalt(): ByteArray = randomBytes(SALT_BYTES)

  /** Argon2id(password) → 32-byte key. The password buffer is not modified; callers wipe it. */
  fun argon2id(password: CharArray, p: KdfParams): ByteArray {
    val pwBytes = toUtf8(password)
    try {
      val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
        .withVersion(Argon2Parameters.ARGON2_VERSION_13)
        .withMemoryAsKB(p.memoryKib)
        .withIterations(p.iterations)
        .withParallelism(p.parallelism)
        .withSalt(p.salt)
        .build()
      val gen = Argon2BytesGenerator()
      gen.init(params)
      val out = ByteArray(KEY_BYTES)
      gen.generateBytes(pwBytes, out)
      return out
    } finally {
      pwBytes.fill(0)
    }
  }

  /**
   * Chooses Argon2 iterations so one derivation takes roughly [targetMs] on this device,
   * never below the baseline.
   */
  fun calibrate(targetMs: Long = 700, clock: () -> Long = System::nanoTime): KdfParams {
    val (m, t, p) = KdfParams.BASELINE
    val probe = KdfParams(m, t, p, newSalt())
    val start = clock()
    argon2id("calibration".toCharArray(), probe).fill(0)
    val perIter = ((clock() - start) / 1_000_000L / t).coerceAtLeast(1)
    val iterations = (targetMs / perIter).toInt().coerceIn(t, 10)
    return KdfParams(m, iterations, p, newSalt())
  }

  /** Wraps [key] with [kek]: version(1) | alg(1) | nonce(12) | ciphertext+tag. */
  fun wrap(kek: ByteArray, key: ByteArray, ad: String): ByteArray {
    val nonce = randomBytes(NONCE_BYTES)
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(kek, "AES"), GCMParameterSpec(TAG_BITS, nonce))
    c.updateAAD(header(ad))
    val ct = c.doFinal(key)
    return ByteBuffer.allocate(2 + NONCE_BYTES + ct.size).put(WRAP_VERSION).put(ALG_AES256_GCM).put(nonce).put(ct).array()
  }

  fun unwrap(kek: ByteArray, blob: ByteArray, ad: String): ByteArray {
    if (blob.size < 2 + NONCE_BYTES + 16 || blob[0] != WRAP_VERSION || blob[1] != ALG_AES256_GCM) {
      throw AuthFailedException("unsupported wrap format")
    }
    try {
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, SecretKeySpec(kek, "AES"), GCMParameterSpec(TAG_BITS, blob, 2, NONCE_BYTES))
      c.updateAAD(header(ad))
      return c.doFinal(blob, 2 + NONCE_BYTES, blob.size - 2 - NONCE_BYTES)
    } catch (e: GeneralSecurityException) {
      throw AuthFailedException("unwrap failed")
    }
  }

  private fun header(ad: String) = ("clipbox/dek/v1/$ad").toByteArray(StandardCharsets.UTF_8)

  fun wrapAd(module: String, kind: String) = "$module/$kind"

  // ---- DEK check value: proves a candidate DEK is correct without storing any password hash.
  private fun checkPlain(module: String) = "clipbox-check:$module".toByteArray(StandardCharsets.UTF_8)

  fun dekCheck(dek: ByteArray, module: String): ByteArray = AesGcmJce(dek).encrypt(checkPlain(module), checkPlain(module))

  fun verifyDek(dek: ByteArray, check: ByteArray, module: String): Boolean = try {
    MessageDigest.isEqual(AesGcmJce(dek).decrypt(check, checkPlain(module)), checkPlain(module))
  } catch (e: GeneralSecurityException) {
    false
  }

  // ---- Record encryption (AEAD with associated data binding ciphertext to its record id).
  fun seal(dek: ByteArray, plaintext: ByteArray, ad: String): ByteArray =
    AesGcmJce(dek).encrypt(plaintext, ad.toByteArray(StandardCharsets.UTF_8))

  fun open(dek: ByteArray, ciphertext: ByteArray, ad: String): ByteArray = try {
    AesGcmJce(dek).decrypt(ciphertext, ad.toByteArray(StandardCharsets.UTF_8))
  } catch (e: GeneralSecurityException) {
    throw AuthFailedException("record authentication failed")
  }

  // ---- Recovery key: 128 random bits + 8-bit checksum, Crockford Base32 in groups of 4.
  fun recoveryKek(recovery: ByteArray, module: String): ByteArray =
    Hkdf.computeHkdf("HMACSHA256", recovery, ByteArray(0), "clipbox/recovery/v1/$module".toByteArray(StandardCharsets.UTF_8), KEY_BYTES)

  private const val B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  fun encodeRecovery(key: ByteArray): String {
    require(key.size == RECOVERY_BYTES)
    val withSum = key + MessageDigest.getInstance("SHA-256").digest(key)[0]
    val sb = StringBuilder()
    var buffer = 0
    var bits = 0
    for (b in withSum) {
      buffer = (buffer shl 8) or (b.toInt() and 0xff)
      bits += 8
      while (bits >= 5) {
        sb.append(B32[(buffer shr (bits - 5)) and 31])
        bits -= 5
      }
    }
    if (bits > 0) sb.append(B32[(buffer shl (5 - bits)) and 31])
    return sb.chunked(4).joinToString("-")
  }

  /** Parses a recovery key typed by the user (case/spacing/ambiguous letters tolerated). Null if invalid. */
  fun decodeRecovery(input: String): ByteArray? {
    val clean = input.uppercase().filter { it.isLetterOrDigit() }.map { c ->
      when (c) { 'O' -> '0'; 'I', 'L' -> '1'; 'U' -> 'V'; else -> c }
    }
    val out = java.io.ByteArrayOutputStream()
    var buffer = 0
    var bits = 0
    for (c in clean) {
      val v = B32.indexOf(c)
      if (v < 0) return null
      buffer = (buffer shl 5) or v
      bits += 5
      if (bits >= 8) {
        out.write((buffer shr (bits - 8)) and 0xff)
        bits -= 8
      }
    }
    val bytes = out.toByteArray()
    if (bytes.size != RECOVERY_BYTES + 1) return null
    val key = bytes.copyOf(RECOVERY_BYTES)
    return if (MessageDigest.getInstance("SHA-256").digest(key)[0] == bytes[RECOVERY_BYTES]) key else null
  }

  // ---- Password generator (unbiased SecureRandom; guarantees each selected class).
  private const val LOWER = "abcdefghijklmnopqrstuvwxyz"
  private const val UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  private const val DIGITS = "0123456789"
  private const val SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/~"
  private const val AMBIGUOUS = "Il1O0o|`'\""

  fun generatePassword(length: Int, lower: Boolean, upper: Boolean, digits: Boolean, symbols: Boolean, avoidAmbiguous: Boolean): String {
    require(length in 8..128) { "length must be 8..128" }
    val classes = listOfNotNull(
      LOWER.takeIf { lower }, UPPER.takeIf { upper }, DIGITS.takeIf { digits }, SYMBOLS.takeIf { symbols },
    ).map { set -> if (avoidAmbiguous) set.filterNot { it in AMBIGUOUS } else set }
    require(classes.isNotEmpty()) { "select at least one character class" }
    val all = classes.joinToString("")
    val chars = CharArray(length)
    classes.forEachIndexed { i, set -> chars[i] = set[random.nextInt(set.length)] }
    for (i in classes.size until length) chars[i] = all[random.nextInt(all.length)]
    for (i in length - 1 downTo 1) { // Fisher–Yates so guaranteed chars are not positional
      val j = random.nextInt(i + 1)
      val t = chars[i]; chars[i] = chars[j]; chars[j] = t
    }
    return String(chars).also { chars.fill('\u0000') }
  }

  // ---- helpers
  fun toUtf8(chars: CharArray): ByteArray {
    val bb = StandardCharsets.UTF_8.encode(CharBuffer.wrap(chars))
    val out = ByteArray(bb.remaining())
    bb.get(out)
    if (bb.hasArray()) bb.array().fill(0)
    return out
  }

  fun b64(b: ByteArray): String = java.util.Base64.getEncoder().encodeToString(b)
  fun unb64(s: String): ByteArray = java.util.Base64.getDecoder().decode(s)
}
