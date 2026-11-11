package app.clipbox.nativemodule.crypto

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android Keystore AES-256-GCM keys that can only be used after a successful Class 3 (strong)
 * biometric authentication for *each* operation, and are permanently invalidated when the set of
 * enrolled biometrics changes (SECURITY_DESIGN §4.1). Key material never leaves TEE/StrongBox.
 */
object KeystoreKeys {
  private const val PROVIDER = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  const val IV_BYTES = 12

  fun alias(module: String) = "clipbox.$module.bio.v1"

  private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  fun exists(module: String): Boolean = keyStore().containsAlias(alias(module))

  fun delete(module: String) {
    val ks = keyStore()
    if (ks.containsAlias(alias(module))) ks.deleteEntry(alias(module))
  }

  /** Always creates a fresh key (replacing any previous one for the module). */
  fun create(module: String): SecretKey {
    delete(module)
    fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(alias(module), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
          @Suppress("DEPRECATION")
          setUserAuthenticationValidityDurationSeconds(-1)
        }
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
      }
      .build()
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    return try {
      gen.init(spec(strongBox = true))
      gen.generateKey()
    } catch (e: StrongBoxUnavailableException) {
      gen.init(spec(strongBox = false))
      gen.generateKey()
    }
  }

  private fun key(module: String): SecretKey =
    (keyStore().getKey(alias(module), null) as? SecretKey) ?: throw IllegalStateException("biometric key missing")

  /** Cipher to be authorised by BiometricPrompt, then used once to wrap the DEK. */
  fun encryptCipher(module: String): Cipher = Cipher.getInstance(TRANSFORMATION).apply {
    init(Cipher.ENCRYPT_MODE, create(module))
    updateAAD(aad(module))
  }

  /**
   * Cipher to be authorised by BiometricPrompt, then used once to unwrap the DEK.
   * Throws KeyPermanentlyInvalidatedException if biometrics changed since enrolment.
   */
  fun decryptCipher(module: String, wrapped: ByteArray): Cipher = Cipher.getInstance(TRANSFORMATION).apply {
    init(Cipher.DECRYPT_MODE, key(module), GCMParameterSpec(128, wrapped, 0, IV_BYTES))
    updateAAD(aad(module))
  }

  fun packWrapped(cipher: Cipher, ciphertext: ByteArray): ByteArray = cipher.iv + ciphertext

  fun ciphertextOf(wrapped: ByteArray): ByteArray = wrapped.copyOfRange(IV_BYTES, wrapped.size)

  private fun aad(module: String) = "clipbox/dek/v1/$module/bio".toByteArray(Charsets.UTF_8)
}
