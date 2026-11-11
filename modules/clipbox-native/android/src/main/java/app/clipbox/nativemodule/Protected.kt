package app.clipbox.nativemodule

import app.clipbox.nativemodule.crypto.VaultCrypto
import app.clipbox.nativemodule.crypto.VaultSession

/**
 * Process-wide protected-module state shared by the JS module and the content provider.
 * `mediaToken` is embedded in in-app media URIs and rotated on every lock/unlock so stale
 * URIs (e.g. cached by an image view) stop resolving.
 */
object Protected {
  val session = VaultSession()

  @Volatile
  var mediaToken: String = newToken()
    private set

  fun rotateMediaToken() {
    mediaToken = newToken()
  }

  private fun newToken() = VaultCrypto.randomBytes(16).joinToString("") { "%02x".format(it) }
}
