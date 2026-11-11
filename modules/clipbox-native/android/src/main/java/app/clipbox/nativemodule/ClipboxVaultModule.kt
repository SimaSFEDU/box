package app.clipbox.nativemodule

import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.fragment.app.FragmentActivity
import app.clipbox.nativemodule.crypto.BiometricGate
import app.clipbox.nativemodule.crypto.KeystoreKeys
import app.clipbox.nativemodule.crypto.VaultCrypto
import app.clipbox.nativemodule.crypto.VaultSession
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

private val MODULES = setOf("vault", "media")

class VaultException(code: String, message: String, cause: Throwable? = null) : CodedException(code, message, cause)

class UnlockMeta : Record {
  @Field var kdfParams: String = ""
  @Field var wrappedPw: String = ""
  @Field var wrappedRecovery: String? = null
  @Field var wrappedBio: String? = null
  @Field var dekCheck: String = ""
}

class PasswordOptions : Record {
  @Field var length: Int = 20
  @Field var lower: Boolean = true
  @Field var upper: Boolean = true
  @Field var digits: Boolean = true
  @Field var symbols: Boolean = true
  @Field var avoidAmbiguous: Boolean = false
}

class PromptText : Record {
  @Field var title: String = "Clipbox"
  @Field var subtitle: String? = null
  @Field var negative: String = "Мастер-пароль"
}

/**
 * JS bridge for protected modules. DEKs live only in [session]; JS receives ciphertext,
 * wrapped keys, and decrypted record plaintext only when it asks to show it.
 */
class ClipboxVaultModule : Module() {
  private val session = VaultSession()
  private val clipboard by lazy { SecureClipboard(appContext.reactContext!!.applicationContext) }
  private val handler = Handler(Looper.getMainLooper())
  private val backgroundLockMs = HashMap<String, Long>()
  private var backgroundLock: Runnable? = null

  private fun checkModule(m: String) {
    if (m !in MODULES) throw VaultException("INVALID_MODULE", "unknown module")
  }

  private fun <T> withPassword(password: String, block: (CharArray) -> T): T {
    val chars = password.toCharArray()
    try {
      return block(chars)
    } finally {
      chars.fill('\u0000')
    }
  }

  private fun unlockWithDek(module: String, dek: ByteArray, check: String) {
    if (!VaultCrypto.verifyDek(dek, VaultCrypto.unb64(check), module)) {
      dek.fill(0)
      throw VaultException("CRYPTO_AUTH_FAILED", "verification failed")
    }
    session.unlock(module, dek)
  }

  private fun activity(): FragmentActivity =
    appContext.currentActivity as? FragmentActivity ?: throw VaultException("NO_ACTIVITY", "no foreground activity")

  override fun definition() = ModuleDefinition {
    Name("ClipboxVault")

    OnActivityEntersBackground {
      // Native-enforced lock on background (JS may be paused). 0 ms = immediately.
      backgroundLock?.let { handler.removeCallbacks(it) }
      val now = ArrayList<String>()
      session.unlockedModules().forEach { m -> if ((backgroundLockMs[m] ?: 0L) <= 0L) now.add(m) }
      now.forEach { session.lock(it) }
      val delayed = session.unlockedModules()
      if (delayed.isNotEmpty()) {
        backgroundLock = Runnable { delayed.forEach { session.lock(it) } }.also { r ->
          handler.postDelayed(r, delayed.maxOf { backgroundLockMs[it] ?: 0L })
        }
      }
    }

    OnActivityEntersForeground {
      backgroundLock?.let { handler.removeCallbacks(it) }
      backgroundLock = null
      runCatching { clipboard.clearIfOurs(force = false) }
    }

    OnDestroy { session.lockAll() }

    Function("isUnlocked") { module: String -> session.isUnlocked(module) }

    Function("setLockPolicy") { module: String, idleMs: Double, backgroundMs: Double ->
      checkModule(module)
      session.setIdleTimeout(module, idleMs.toLong())
      backgroundLockMs[module] = backgroundMs.toLong()
    }

    Function("touch") { module: String -> session.touch(module) }

    Function("lock") { module: String -> session.lock(module) }

    Function("lockAll") { ->
      session.lockAll()
      runCatching { clipboard.clearIfOurs(force = true) }
    }

    Function("biometricStatus") { ->
      when (BiometricGate.status(appContext.reactContext!!)) {
        BiometricGate.Status.AVAILABLE -> "available"
        BiometricGate.Status.NONE_ENROLLED -> "none_enrolled"
        BiometricGate.Status.UNAVAILABLE -> "unavailable"
      }
    }

    Function("hasBiometricKey") { module: String -> KeystoreKeys.exists(module) }

    /** Creates a new DEK, wraps it with the master password (and a recovery key if requested), unlocks. */
    AsyncFunction("setup") { module: String, password: String, withRecovery: Boolean ->
      checkModule(module)
      withPassword(password) { pw ->
        val params = VaultCrypto.calibrate()
        val kek = VaultCrypto.argon2id(pw, params)
        val dek = VaultCrypto.randomBytes(VaultCrypto.KEY_BYTES)
        try {
          val out = hashMapOf<String, Any?>(
            "kdfParams" to params.toJson(),
            "wrappedPw" to VaultCrypto.b64(VaultCrypto.wrap(kek, dek, VaultCrypto.wrapAd(module, "pw"))),
            "dekCheck" to VaultCrypto.b64(VaultCrypto.dekCheck(dek, module)),
          )
          if (withRecovery) {
            val rk = VaultCrypto.randomBytes(VaultCrypto.RECOVERY_BYTES)
            val rkek = VaultCrypto.recoveryKek(rk, module)
            out["wrappedRecovery"] = VaultCrypto.b64(VaultCrypto.wrap(rkek, dek, VaultCrypto.wrapAd(module, "recovery")))
            out["recoveryKey"] = VaultCrypto.encodeRecovery(rk)
            rk.fill(0); rkek.fill(0)
          }
          session.unlock(module, dek.copyOf())
          out
        } finally {
          kek.fill(0); dek.fill(0)
        }
      }
    }

    AsyncFunction("unlockWithPassword") { module: String, password: String, meta: UnlockMeta ->
      checkModule(module)
      withPassword(password) { pw ->
        val kek = VaultCrypto.argon2id(pw, VaultCrypto.KdfParams.fromJson(meta.kdfParams))
        try {
          val dek = VaultCrypto.unwrap(kek, VaultCrypto.unb64(meta.wrappedPw), VaultCrypto.wrapAd(module, "pw"))
          unlockWithDek(module, dek, meta.dekCheck)
        } catch (e: VaultCrypto.AuthFailedException) {
          throw VaultException("CRYPTO_AUTH_FAILED", "wrong password")
        } finally {
          kek.fill(0)
        }
      }
      true
    }

    AsyncFunction("unlockWithRecovery") { module: String, recoveryKey: String, meta: UnlockMeta ->
      checkModule(module)
      val rk = VaultCrypto.decodeRecovery(recoveryKey) ?: throw VaultException("INVALID_RECOVERY_KEY", "malformed recovery key")
      val wrapped = meta.wrappedRecovery ?: throw VaultException("INVALID_RECOVERY_KEY", "no recovery key configured")
      val rkek = VaultCrypto.recoveryKek(rk, module)
      try {
        unlockWithDek(module, VaultCrypto.unwrap(rkek, VaultCrypto.unb64(wrapped), VaultCrypto.wrapAd(module, "recovery")), meta.dekCheck)
      } catch (e: VaultCrypto.AuthFailedException) {
        throw VaultException("CRYPTO_AUTH_FAILED", "wrong recovery key")
      } finally {
        rk.fill(0); rkek.fill(0)
      }
      true
    }

    /** Re-wraps the current DEK with a new password (data is not re-encrypted). Requires unlocked. */
    AsyncFunction("changePassword") { module: String, newPassword: String ->
      checkModule(module)
      withPassword(newPassword) { pw ->
        val params = VaultCrypto.calibrate()
        val kek = VaultCrypto.argon2id(pw, params)
        try {
          session.withDek(module) { dek ->
            mapOf("kdfParams" to params.toJson(), "wrappedPw" to VaultCrypto.b64(VaultCrypto.wrap(kek, dek, VaultCrypto.wrapAd(module, "pw"))))
          }
        } catch (e: VaultSession.LockedException) {
          throw VaultException("AUTH_REQUIRED", "locked")
        } finally {
          kek.fill(0)
        }
      }
    }

    AsyncFunction("newRecoveryKey") { module: String ->
      checkModule(module)
      val rk = VaultCrypto.randomBytes(VaultCrypto.RECOVERY_BYTES)
      val rkek = VaultCrypto.recoveryKek(rk, module)
      try {
        session.withDek(module) { dek ->
          mapOf(
            "recoveryKey" to VaultCrypto.encodeRecovery(rk),
            "wrappedRecovery" to VaultCrypto.b64(VaultCrypto.wrap(rkek, dek, VaultCrypto.wrapAd(module, "recovery"))),
          )
        }
      } catch (e: VaultSession.LockedException) {
        throw VaultException("AUTH_REQUIRED", "locked")
      } finally {
        rk.fill(0); rkek.fill(0)
      }
    }

    /** Wraps the unlocked DEK with a new biometric-bound Keystore key (shows BiometricPrompt). */
    AsyncFunction("enableBiometric") { module: String, text: PromptText, promise: Promise ->
      checkModule(module)
      if (!session.isUnlocked(module)) return@AsyncFunction promise.reject("AUTH_REQUIRED", "locked", null)
      val cipher = try {
        KeystoreKeys.encryptCipher(module)
      } catch (e: Exception) {
        return@AsyncFunction promise.reject("BIO_UNAVAILABLE", "cannot create biometric key", e)
      }
      BiometricGate.authenticate(activity(), cipher, text.title, text.subtitle, text.negative) { r ->
        when (r) {
          is BiometricGate.Result.Success -> try {
            val wrapped = session.withDek(module) { dek -> KeystoreKeys.packWrapped(r.cipher, r.cipher.doFinal(dek)) }
            promise.resolve(VaultCrypto.b64(wrapped))
          } catch (e: Exception) {
            KeystoreKeys.delete(module)
            promise.reject("BIO_FAILED", "biometric wrap failed", e)
          }
          else -> {
            KeystoreKeys.delete(module)
            rejectBio(promise, r)
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unlockWithBiometric") { module: String, meta: UnlockMeta, text: PromptText, promise: Promise ->
      checkModule(module)
      val wrapped = meta.wrappedBio?.let { VaultCrypto.unb64(it) } ?: return@AsyncFunction promise.reject("BIO_NOT_ENROLLED", "biometric unlock not set up", null)
      val cipher = try {
        KeystoreKeys.decryptCipher(module, wrapped)
      } catch (e: KeyPermanentlyInvalidatedException) {
        KeystoreKeys.delete(module)
        return@AsyncFunction promise.reject("BIO_INVALIDATED", "biometrics changed", e)
      } catch (e: Exception) {
        return@AsyncFunction promise.reject("BIO_UNAVAILABLE", "biometric key unavailable", e)
      }
      BiometricGate.authenticate(activity(), cipher, text.title, text.subtitle, text.negative) { r ->
        when (r) {
          is BiometricGate.Result.Success -> try {
            val dek = r.cipher.doFinal(KeystoreKeys.ciphertextOf(wrapped))
            unlockWithDek(module, dek, meta.dekCheck)
            promise.resolve(true)
          } catch (e: Exception) {
            promise.reject("CRYPTO_AUTH_FAILED", "biometric unwrap failed", e)
          }
          else -> rejectBio(promise, r)
        }
      }
    }.runOnQueue(Queues.MAIN)

    Function("disableBiometric") { module: String -> KeystoreKeys.delete(module) }

    /** Destroys all key material for a module (used by "reset Vault"). Ciphertext becomes unreadable. */
    Function("destroyModuleKeys") { module: String ->
      checkModule(module)
      session.lock(module)
      KeystoreKeys.delete(module)
    }

    AsyncFunction("seal") { module: String, plaintext: String, ad: String ->
      requireUnlocked(module) { dek -> VaultCrypto.b64(VaultCrypto.seal(dek, plaintext.toByteArray(Charsets.UTF_8), ad)) }
    }

    AsyncFunction("open") { module: String, ciphertext: String, ad: String ->
      requireUnlocked(module) { dek ->
        try {
          String(VaultCrypto.open(dek, VaultCrypto.unb64(ciphertext), ad), Charsets.UTF_8)
        } catch (e: VaultCrypto.AuthFailedException) {
          throw VaultException("CRYPTO_CORRUPTED", "record failed authentication")
        }
      }
    }

    /** Batch open; corrupted records come back as null instead of failing the whole list. */
    AsyncFunction("openMany") { module: String, items: List<List<String>> ->
      requireUnlocked(module) { dek ->
        items.map { (ct, ad) -> runCatching { String(VaultCrypto.open(dek, VaultCrypto.unb64(ct), ad), Charsets.UTF_8) }.getOrNull() }
      }
    }

    Function("generatePassword") { o: PasswordOptions ->
      try {
        VaultCrypto.generatePassword(o.length, o.lower, o.upper, o.digits, o.symbols, o.avoidAmbiguous)
      } catch (e: IllegalArgumentException) {
        throw VaultException("VALIDATION", e.message ?: "invalid options")
      }
    }

    AsyncFunction("copySensitive") { text: String, clearAfterMs: Double ->
      clipboard.copy(text, clearAfterMs.toLong().coerceIn(5_000, 600_000))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearClipboardIfOurs") { -> clipboard.clearIfOurs(force = true) }.runOnQueue(Queues.MAIN)
  }

  private fun <T> requireUnlocked(module: String, block: (ByteArray) -> T): T {
    checkModule(module)
    return try {
      session.withDek(module, block)
    } catch (e: VaultSession.LockedException) {
      throw VaultException("AUTH_REQUIRED", "locked")
    }
  }

  private fun rejectBio(promise: Promise, r: BiometricGate.Result) {
    when (r) {
      BiometricGate.Result.Canceled -> promise.reject("BIO_CANCELED", "canceled", null)
      BiometricGate.Result.Lockout -> promise.reject("BIO_LOCKOUT", "too many attempts", null)
      is BiometricGate.Result.Error -> promise.reject("BIO_FAILED", r.message, null)
      else -> promise.reject("BIO_FAILED", "unexpected", null)
    }
  }
}
