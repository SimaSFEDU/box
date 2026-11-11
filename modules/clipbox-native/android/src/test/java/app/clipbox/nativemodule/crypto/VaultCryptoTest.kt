package app.clipbox.nativemodule.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultCryptoTest {
  // Small Argon2 params keep tests fast; production uses KdfParams.BASELINE or higher.
  private fun fastParams() = VaultCrypto.KdfParams(8 * 1024, 1, 1, VaultCrypto.newSalt())

  @Test fun argon2idIsDeterministicPerSaltAndSensitiveToInputs() {
    val p = fastParams()
    val a = VaultCrypto.argon2id("correct horse".toCharArray(), p)
    assertArrayEquals(a, VaultCrypto.argon2id("correct horse".toCharArray(), p))
    assertFalse(a.contentEquals(VaultCrypto.argon2id("correct horsf".toCharArray(), p)))
    assertFalse(a.contentEquals(VaultCrypto.argon2id("correct horse".toCharArray(), p.copy(salt = VaultCrypto.newSalt()))))
    assertEquals(32, a.size)
  }

  @Test fun argon2idMatchesRfc9106StyleKnownAnswer() {
    // Known-answer from Bouncy Castle / reference implementation for Argon2id v1.3:
    // password "password", salt "somesalt", t=2, m=65536 KiB, p=1, 32-byte output.
    val p = VaultCrypto.KdfParams(65536, 2, 1, "somesalt".toByteArray())
    val out = VaultCrypto.argon2id("password".toCharArray(), p)
    assertEquals("09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7", out.joinToString("") { "%02x".format(it) })
  }

  @Test fun kdfParamsRoundTripAndRejectWeakValues() {
    val p = fastParams()
    val back = VaultCrypto.KdfParams.fromJson(p.toJson())
    assertEquals(p.memoryKib, back.memoryKib)
    assertArrayEquals(p.salt, back.salt)
    assertThrows(IllegalArgumentException::class.java) { VaultCrypto.KdfParams.fromJson("""{"m_kib":1,"t":1,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA=="}""") }
  }

  @Test fun wrapUnwrapWithAssociatedData() {
    val kek = VaultCrypto.randomBytes(32)
    val dek = VaultCrypto.randomBytes(32)
    val blob = VaultCrypto.wrap(kek, dek, "vault/pw")
    assertArrayEquals(dek, VaultCrypto.unwrap(kek, blob, "vault/pw"))
    // Wrong KEK, wrong AD (e.g. swapping vault and media wraps), tampering → auth failure.
    assertThrows(VaultCrypto.AuthFailedException::class.java) { VaultCrypto.unwrap(VaultCrypto.randomBytes(32), blob, "vault/pw") }
    assertThrows(VaultCrypto.AuthFailedException::class.java) { VaultCrypto.unwrap(kek, blob, "media/pw") }
    val tampered = blob.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
    assertThrows(VaultCrypto.AuthFailedException::class.java) { VaultCrypto.unwrap(kek, tampered, "vault/pw") }
    val badVersion = blob.copyOf().also { it[0] = 9 }
    assertThrows(VaultCrypto.AuthFailedException::class.java) { VaultCrypto.unwrap(kek, badVersion, "vault/pw") }
    // Fresh nonce each time.
    assertFalse(blob.contentEquals(VaultCrypto.wrap(kek, dek, "vault/pw")))
  }

  @Test fun dekCheckDetectsWrongKeyAndModule() {
    val dek = VaultCrypto.randomBytes(32)
    val check = VaultCrypto.dekCheck(dek, "vault")
    assertTrue(VaultCrypto.verifyDek(dek, check, "vault"))
    assertFalse(VaultCrypto.verifyDek(VaultCrypto.randomBytes(32), check, "vault"))
    assertFalse(VaultCrypto.verifyDek(dek, check, "media"))
  }

  @Test fun recordsAreBoundToTheirId() {
    val dek = VaultCrypto.randomBytes(32)
    val ct = VaultCrypto.seal(dek, "secret".toByteArray(), "entry-1:1")
    assertEquals("secret", String(VaultCrypto.open(dek, ct, "entry-1:1")))
    assertThrows(VaultCrypto.AuthFailedException::class.java) { VaultCrypto.open(dek, ct, "entry-2:1") }
    assertFalse(String(ct, Charsets.ISO_8859_1).contains("secret"))
  }

  @Test fun recoveryKeyEncodingIsTolerantAndChecksummed() {
    // Fixed key keeps the typo check deterministic (a random key could pass the 8-bit checksum 1/256 of the time).
    val key = ByteArray(16) { (it * 37 + 11).toByte() }
    val text = VaultCrypto.encodeRecovery(key)
    assertTrue(text.matches(Regex("([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{3,4}")))
    assertArrayEquals(key, VaultCrypto.decodeRecovery(text))
    assertArrayEquals(key, VaultCrypto.decodeRecovery(" " + text.lowercase().replace("-", " ") + " "))
    // Single typo → checksum mismatch (or invalid length) → null.
    val typo = (if (text[0] == 'A') "B" else "A") + text.substring(1)
    assertNull(VaultCrypto.decodeRecovery(typo))
    repeat(50) { val k = VaultCrypto.randomBytes(16); assertArrayEquals(k, VaultCrypto.decodeRecovery(VaultCrypto.encodeRecovery(k))) }
    assertNull(VaultCrypto.decodeRecovery("too-short"))
  }

  @Test fun recoveryKekIsPerModule() {
    val r = VaultCrypto.randomBytes(16)
    assertFalse(VaultCrypto.recoveryKek(r, "vault").contentEquals(VaultCrypto.recoveryKek(r, "media")))
    assertArrayEquals(VaultCrypto.recoveryKek(r, "vault"), VaultCrypto.recoveryKek(r, "vault"))
  }

  @Test fun fullFlowPasswordRecoveryAndPasswordChangeKeepTheDek() {
    val dek = VaultCrypto.randomBytes(32)
    val p1 = fastParams()
    val wrappedPw = VaultCrypto.wrap(VaultCrypto.argon2id("first password".toCharArray(), p1), dek, "vault/pw")
    val recovery = VaultCrypto.randomBytes(16)
    val wrappedRec = VaultCrypto.wrap(VaultCrypto.recoveryKek(recovery, "vault"), dek, "vault/recovery")
    // Forgot password → recovery key opens the same DEK.
    val viaRecovery = VaultCrypto.unwrap(VaultCrypto.recoveryKek(VaultCrypto.decodeRecovery(VaultCrypto.encodeRecovery(recovery))!!, "vault"), wrappedRec, "vault/recovery")
    assertArrayEquals(dek, viaRecovery)
    // New password re-wraps the same DEK; old wrap is useless with the new password.
    val p2 = fastParams()
    val newWrapped = VaultCrypto.wrap(VaultCrypto.argon2id("second password".toCharArray(), p2), dek, "vault/pw")
    assertArrayEquals(dek, VaultCrypto.unwrap(VaultCrypto.argon2id("second password".toCharArray(), p2), newWrapped, "vault/pw"))
    assertThrows(VaultCrypto.AuthFailedException::class.java) {
      VaultCrypto.unwrap(VaultCrypto.argon2id("second password".toCharArray(), p2), wrappedPw, "vault/pw")
    }
  }

  @Test fun passwordGeneratorHonoursOptions() {
    repeat(200) {
      val pw = VaultCrypto.generatePassword(12, lower = true, upper = true, digits = true, symbols = true, avoidAmbiguous = true)
      assertEquals(12, pw.length)
      assertTrue(pw.any { it.isLowerCase() } && pw.any { it.isUpperCase() } && pw.any { it.isDigit() } && pw.any { !it.isLetterOrDigit() })
      assertFalse(pw.any { it in "Il1O0o|`'\"" })
    }
    assertTrue(VaultCrypto.generatePassword(64, true, false, false, false, false).all { it in 'a'..'z' })
    assertNotEquals(VaultCrypto.generatePassword(20, true, true, true, true, false), VaultCrypto.generatePassword(20, true, true, true, true, false))
    assertThrows(IllegalArgumentException::class.java) { VaultCrypto.generatePassword(4, true, true, true, true, false) }
    assertThrows(IllegalArgumentException::class.java) { VaultCrypto.generatePassword(16, false, false, false, false, false) }
  }

  @Test fun generatorIsRoughlyUniform() {
    val counts = IntArray(10)
    repeat(20_000) { VaultCrypto.generatePassword(8, false, false, true, false, false).forEach { c -> counts[c - '0']++ } }
    val expected = 20_000 * 8 / 10.0
    counts.forEach { assertTrue("digit frequency skewed: ${counts.toList()}", kotlin.math.abs(it - expected) < expected * 0.05) }
  }
}
