package app.clipbox.nativemodule

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle

/**
 * Copies secrets marked as sensitive (hidden from clipboard previews on Android 13+) and clears
 * them after a timeout — only if the clipboard still holds *our* clip, so newer user content
 * is never wiped. A pending clear survives process death via SharedPreferences.
 */
class SecureClipboard(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val prefs = context.getSharedPreferences("clipbox.clipboard", Context.MODE_PRIVATE)
  private val cm get() = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
  private var pending: Runnable? = null

  fun copy(text: String, clearAfterMs: Long) {
    val token = "clipbox-secret-" + System.nanoTime()
    val clip = ClipData.newPlainText(token, text)
    clip.description.extras = PersistableBundle().apply {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
      else putBoolean("android.content.extra.IS_SENSITIVE", true)
    }
    cm.setPrimaryClip(clip)
    prefs.edit().putString("token", token).putLong("clearAt", System.currentTimeMillis() + clearAfterMs).apply()
    pending?.let { handler.removeCallbacks(it) }
    pending = Runnable { clearIfOurs(force = false) }.also { handler.postDelayed(it, clearAfterMs) }
  }

  /** Clears our secret if still present. `force` ignores the deadline (used on lock). */
  fun clearIfOurs(force: Boolean): Boolean {
    val token = prefs.getString("token", null) ?: return false
    if (!force && System.currentTimeMillis() < prefs.getLong("clearAt", 0)) return false
    val label = try {
      cm.primaryClipDescription?.label?.toString()
    } catch (e: SecurityException) {
      null // not readable in background; retried on next foreground
    }
    if (label == null) return false
    if (label == token) cm.clearPrimaryClip()
    prefs.edit().remove("token").remove("clearAt").apply()
    return label == token
  }
}
