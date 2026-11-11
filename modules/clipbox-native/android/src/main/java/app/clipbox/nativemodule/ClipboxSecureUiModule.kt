package app.clipbox.nativemodule

import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Secure-window controls for protected screens (docs/SECURITY_DESIGN.md §6).
 * FLAG_SECURE blocks screenshots, screen recording and the Recents thumbnail.
 */
class ClipboxSecureUiModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClipboxSecureUi")

    AsyncFunction("setSecureWindow") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      if (enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        activity.setRecentsScreenshotEnabled(!enabled)
      }
      true
    }.runOnQueue(Queues.MAIN)
  }
}
