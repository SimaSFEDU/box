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
  private val session get() = Protected.session
  private val media by lazy { MediaStorage(appContext.reactContext!!.applicationContext) }
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
    if (module == "media") Protected.rotateMediaToken()
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
      if ("media" in now) Protected.rotateMediaToken()
      val delayed = session.unlockedModules()
      if (delayed.isNotEmpty()) {
        backgroundLock = Runnable {
          delayed.forEach { session.lock(it) }
          Protected.rotateMediaToken()
        }.also { r ->
          handler.postDelayed(r, delayed.maxOf { backgroundLockMs[it] ?: 0L })
        }
      }
    }

    OnActivityEntersForeground {
      backgroundLock?.let { handler.removeCallbacks(it) }
      backgroundLock = null
      runCatching { clipboard.clearIfOurs(force = false) }
      runCatching { media.cleanupShares() }
    }

    OnDestroy { session.lockAll() }

    Function("isUnlocked") { module: String -> session.isUnlocked(module) }

    Function("setLockPolicy") { module: String, idleMs: Double, backgroundMs: Double ->
      checkModule(module)
      session.setIdleTimeout(module, idleMs.toLong())
      backgroundLockMs[module] = backgroundMs.toLong()
    }

    Function("touch") { module: String -> session.touch(module) }

    Function("lock") { module: String ->
      session.lock(module)
      if (module == "media") Protected.rotateMediaToken()
    }

    Function("lockAll") { ->
      session.lockAll()
      Protected.rotateMediaToken()
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
          if (module == "media") Protected.rotateMediaToken()
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
      // Snapshot the DEK before showing the prompt: the system dialog may pause the activity, which
      // triggers background auto-lock. The copy is wiped as soon as the prompt completes.
      val dek = try {
        session.withDek(module) { it.copyOf() }
      } catch (e: VaultSession.LockedException) {
        return@AsyncFunction promise.reject("AUTH_REQUIRED", "locked", null)
      }
      val cipher = try {
        KeystoreKeys.encryptCipher(module)
      } catch (e: Exception) {
        dek.fill(0)
        return@AsyncFunction promise.reject("BIO_UNAVAILABLE", "cannot create biometric key", e)
      }
      BiometricGate.authenticate(activity(), cipher, text.title, text.subtitle, text.negative) { r ->
        try {
          when (r) {
            is BiometricGate.Result.Success -> try {
              promise.resolve(VaultCrypto.b64(KeystoreKeys.packWrapped(r.cipher, r.cipher.doFinal(dek))))
            } catch (e: Exception) {
              KeystoreKeys.delete(module)
              promise.reject("BIO_FAILED", "biometric wrap failed", e)
            }
            else -> {
              KeystoreKeys.delete(module)
              rejectBio(promise, r)
            }
          }
        } finally {
          dek.fill(0)
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

    // ------------------------------------------------------------------ Private Media

    Function("mediaToken") { -> Protected.mediaToken }

    Function("mediaAuthority") { -> SecureMediaProvider.authority(appContext.reactContext!!) }

    /** Encrypts a picked/shared file (content:// or file://) straight from its stream. */
    AsyncFunction("mediaImport") { id: String, sourceUri: String, mimeHint: String? ->
      val ctx = appContext.reactContext!!
      val uri = android.net.Uri.parse(sourceUri)
      if (uri.scheme != "content" && uri.scheme != "file") throw VaultException("VALIDATION", "unsupported source")
      val r = try {
        requireUnlocked("media") { dek ->
          media.import(dek, id, mimeHint) { ctx.contentResolver.openInputStream(uri) ?: throw java.io.FileNotFoundException() }
        }
      } catch (e: VaultException) {
        throw e
      } catch (e: IllegalArgumentException) {
        throw VaultException("VALIDATION", "file too large")
      } catch (e: java.io.FileNotFoundException) {
        throw VaultException("SOURCE_UNAVAILABLE", "source not readable")
      }
      mapOf(
        "blobName" to r.blobName, "thumbName" to r.thumbName, "size" to r.size.toDouble(), "mime" to r.mime,
        "sha256" to r.sha256, "width" to r.width, "height" to r.height, "durationMs" to r.durationMs?.toDouble(),
      )
    }

    Function("mediaDelete") { blob: String?, thumb: String? -> media.delete(blob, thumb) }

    /** Decrypts to short-lived share copies and opens the system share sheet with read-only grants. */
    AsyncFunction("mediaShare") { items: List<Map<String, String>>, title: String, promise: Promise ->
      try {
        val ctx = appContext.reactContext!!
        val files = requireUnlocked("media") { dek ->
          items.map { media.prepareShare(dek, it["id"]!!, it["blob"]!!, it["name"] ?: "file") to (it["mime"] ?: "application/octet-stream") }
        }
        val uris = ArrayList(files.map { media.uriForShare(it.first) })
        val mimes = files.map { it.second }.distinct()
        val mime = if (mimes.size == 1) mimes[0] else mimes.map { it.substringBefore('/') }.distinct().singleOrNull()?.let { "$it/*" } ?: "*/*"
        val send = android.content.Intent(if (uris.size == 1) android.content.Intent.ACTION_SEND else android.content.Intent.ACTION_SEND_MULTIPLE).apply {
          type = mime
          if (uris.size == 1) putExtra(android.content.Intent.EXTRA_STREAM, uris[0]) else putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, uris)
          clipData = android.content.ClipData.newUri(ctx.contentResolver, "Clipbox", uris[0]).apply { uris.drop(1).forEach { addItem(android.content.ClipData.Item(it)) } }
          addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = android.content.Intent.createChooser(send, title).apply { addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        val activity = appContext.currentActivity ?: throw VaultException("NO_ACTIVITY", "no activity")
        activity.runOnUiThread {
          activity.startActivity(chooser)
          promise.resolve(uris.size)
        }
      } catch (e: VaultException) {
        promise.reject(e.code, e.message, e)
      } catch (e: Exception) {
        promise.reject("SHARE_FAILED", "share failed", e)
      }
    }

    Function("mediaCleanupShares") { -> media.cleanupShares() }

    // ------------------------------------------------------------------ Encrypted backup (.cbvault)

    /**
     * Writes an encrypted backup to cache/backup-out and returns its file:// URI.
     * Rows: vault = [id, payloadB64, ad]; collections = [id, payloadB64, ad]; media = [id, blob, metaB64, metaAd].
     */
    AsyncFunction("backupExport") { password: String, vault: List<List<String>>, collections: List<List<String>>, mediaRows: List<List<String>> ->
      if (vault.isNotEmpty() && !session.isUnlocked("vault")) throw VaultException("AUTH_REQUIRED", "vault locked")
      if ((mediaRows.isNotEmpty() || collections.isNotEmpty()) && !session.isUnlocked("media")) throw VaultException("AUTH_REQUIRED", "media locked")
      media.cleanupShares()
      val stamp = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
      val out = java.io.File(media.backupDir, "clipbox-private-$stamp.cbvault")
      val tmp = java.io.File(media.backupDir, out.name + ".tmp")
      withPassword(password) { pw ->
        try {
          tmp.outputStream().buffered(1 shl 16).use { os ->
            app.clipbox.nativemodule.crypto.BackupFormat.Writer(os, pw, System.currentTimeMillis(), mapOf("vault" to vault.size, "media" to mediaRows.size, "collections" to collections.size)).use { w ->
              vault.forEach { (id, ct, ad) ->
                val plain = session.withDek("vault") { dek -> VaultCrypto.open(dek, VaultCrypto.unb64(ct), ad) }
                w.record(app.clipbox.nativemodule.crypto.BackupFormat.TYPE_VAULT_ENTRY, id, plain); plain.fill(0)
              }
              collections.forEach { (id, ct, ad) ->
                val plain = session.withDek("media") { dek -> VaultCrypto.open(dek, VaultCrypto.unb64(ct), ad) }
                w.record(app.clipbox.nativemodule.crypto.BackupFormat.TYPE_MEDIA_COLLECTION, id, plain)
              }
              mediaRows.forEach { (id, blob, metaCt, metaAd) ->
                val meta = session.withDek("media") { dek -> VaultCrypto.open(dek, VaultCrypto.unb64(metaCt), metaAd) }
                w.record(app.clipbox.nativemodule.crypto.BackupFormat.TYPE_MEDIA_META, id, meta)
                session.withDek("media") { dek ->
                  media.plaintextChannel(dek, id, blob).use { ch ->
                    w.record(app.clipbox.nativemodule.crypto.BackupFormat.TYPE_MEDIA_BLOB, id, ch.size(), java.nio.channels.Channels.newInputStream(ch))
                  }
                }
              }
            }
          }
          if (!tmp.renameTo(out)) throw IllegalStateException("rename failed")
        } catch (e: VaultCrypto.AuthFailedException) {
          tmp.delete(); throw VaultException("CRYPTO_CORRUPTED", "a record failed authentication")
        } catch (e: Exception) {
          tmp.delete(); throw if (e is VaultException) e else VaultException("BACKUP_FAILED", "backup failed", e)
        }
      }
      android.net.Uri.fromFile(out).toString()
    }

    /**
     * Verifies the whole backup first (wrong password / tampering / truncation → nothing written), then
     * restores: vault entries and collections are returned as plaintext JSON for JS to re-seal; media blobs
     * are re-encrypted with this device's media key. Existing ids are skipped.
     */
    AsyncFunction("backupRestore") { sourceUri: String, password: String, skipIds: List<String> ->
      val ctx = appContext.reactContext!!
      val uri = android.net.Uri.parse(sourceUri)
      val skip = skipIds.toHashSet()
      val fmt = app.clipbox.nativemodule.crypto.BackupFormat
      withPassword(password) { pw ->
        var needsVault = false
        var needsMedia = false
        try {
          ctx.contentResolver.openInputStream(uri)!!.buffered(1 shl 16).use { input ->
            fmt.read(input, pw) { type, _, _, _ ->
              if (type == fmt.TYPE_VAULT_ENTRY) needsVault = true
              if (type == fmt.TYPE_MEDIA_BLOB || type == fmt.TYPE_MEDIA_META || type == fmt.TYPE_MEDIA_COLLECTION) needsMedia = true
            }
          }
        } catch (e: VaultCrypto.AuthFailedException) {
          throw VaultException("CRYPTO_AUTH_FAILED", "wrong password or damaged backup")
        } catch (e: app.clipbox.nativemodule.crypto.BackupFormat.FormatException) {
          throw VaultException("VALIDATION", "not a Clipbox backup")
        }
        if (needsVault && !session.isUnlocked("vault")) throw VaultException("VAULT_REQUIRED", "unlock vault first")
        if (needsMedia && !session.isUnlocked("media")) throw VaultException("MEDIA_REQUIRED", "unlock media first")

        val vaultOut = ArrayList<Map<String, String>>()
        val collOut = ArrayList<Map<String, String>>()
        val metaById = HashMap<String, String>()
        val mediaOut = ArrayList<Map<String, Any?>>()
        val written = ArrayList<Pair<String, String?>>()
        try {
          ctx.contentResolver.openInputStream(uri)!!.buffered(1 shl 16).use { input ->
            fmt.read(input, pw) { type, name, _, content ->
              if (name in skip) return@read
              when (type) {
                fmt.TYPE_VAULT_ENTRY -> vaultOut += mapOf("id" to name, "json" to String(content.readBytes(), Charsets.UTF_8))
                fmt.TYPE_MEDIA_COLLECTION -> collOut += mapOf("id" to name, "json" to String(content.readBytes(), Charsets.UTF_8))
                fmt.TYPE_MEDIA_META -> metaById[name] = String(content.readBytes(), Charsets.UTF_8)
                fmt.TYPE_MEDIA_BLOB -> {
                  val r = session.withDek("media") { dek -> media.import(dek, name, null) { content } }
                  written += r.blobName to r.thumbName
                  mediaOut += mapOf("id" to name, "blobName" to r.blobName, "thumbName" to r.thumbName, "meta" to metaById[name],
                    "size" to r.size.toDouble(), "mime" to r.mime, "width" to r.width, "height" to r.height, "durationMs" to r.durationMs?.toDouble())
                }
              }
            }
          }
        } catch (e: Exception) {
          written.forEach { (b, t) -> media.delete(b, t) }
          throw VaultException("RESTORE_FAILED", "restore failed", e)
        }
        mapOf("vault" to vaultOut, "collections" to collOut, "media" to mediaOut)
      }
    }

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
