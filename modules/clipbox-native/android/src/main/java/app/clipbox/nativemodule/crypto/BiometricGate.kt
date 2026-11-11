package app.clipbox.nativemodule.crypto

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import javax.crypto.Cipher

/** System BiometricPrompt bound to a Keystore cipher (CryptoObject). No custom biometrics. */
object BiometricGate {
  enum class Status { AVAILABLE, NONE_ENROLLED, UNAVAILABLE }

  fun status(context: Context): Status = when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
    BiometricManager.BIOMETRIC_SUCCESS -> Status.AVAILABLE
    BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> Status.NONE_ENROLLED
    else -> Status.UNAVAILABLE
  }

  sealed class Result {
    data class Success(val cipher: Cipher) : Result()
    data object Canceled : Result()
    data object Lockout : Result()
    data class Error(val message: String) : Result()
  }

  /** Must be called on the main thread. */
  fun authenticate(activity: FragmentActivity, cipher: Cipher, title: String, subtitle: String?, negative: String, onResult: (Result) -> Unit) {
    var delivered = false
    fun deliver(r: Result) {
      if (!delivered) {
        delivered = true
        onResult(r)
      }
    }
    val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        val c = result.cryptoObject?.cipher
        deliver(if (c != null) Result.Success(c) else Result.Error("no crypto object"))
      }

      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        deliver(
          when (errorCode) {
            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> Result.Lockout
            BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> Result.Canceled
            else -> Result.Error(errString.toString())
          },
        )
      }
      // onAuthenticationFailed (non-matching finger) is non-terminal: the system prompt lets the user retry.
    })
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(title)
      .apply { if (subtitle != null) setSubtitle(subtitle) }
      .setNegativeButtonText(negative)
      .setAllowedAuthenticators(BIOMETRIC_STRONG)
      .setConfirmationRequired(false)
      .build()
    prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
  }
}
