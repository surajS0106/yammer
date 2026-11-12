package com.sush.yammer

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class CopyArgs {
  lateinit var text: String
}

@InvokeArg
class ShareArgs {
  lateinit var name: String
  lateinit var contents: String
}

/** What the settings UI asks of Android. Rust's `android_status` and `android_action` call these. */
@TauriPlugin
class YammerPlugin(private val activity: Activity) : Plugin(activity) {
  private fun granted(permission: String) = activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  private fun accessibilityOn(): Boolean {
    val me = ComponentName(activity, YammerAccessibility::class.java).flattenToString()
    val on = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    return on.split(':').any { it.equals(me, ignoreCase = true) }
  }

  @Command
  fun status(invoke: Invoke) {
    val service = YammerService.instance
    invoke.resolve(
      JSObject().apply {
        put("mic", granted(Manifest.permission.RECORD_AUDIO))
        put("overlay", Settings.canDrawOverlays(activity))
        put("accessibility", accessibilityOn())
        put("notifications", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(Manifest.permission.POST_NOTIFICATIONS))
        // Running only to record a meeting isn't Sushi being on.
        put("running", service != null && !service.onlyForMeeting)
        put("recording", service?.isRecording == true)
      },
    )
  }

  @Command
  fun requestMic(invoke: Invoke) {
    activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    invoke.resolve()
  }

  @Command
  fun requestNotifications(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
    invoke.resolve()
  }

  @Command
  fun openOverlaySettings(invoke: Invoke) {
    activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}")))
    invoke.resolve()
  }

  @Command
  fun openAccessibilitySettings(invoke: Invoke) {
    activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    invoke.resolve()
  }

  /** Where a sideloaded app's "Allow restricted settings" is. */
  @Command
  fun openAppSettings(invoke: Invoke) {
    activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
    invoke.resolve()
  }

  @Command
  fun startBubble(invoke: Invoke) {
    if (!granted(Manifest.permission.RECORD_AUDIO)) {
      invoke.reject("Allow the microphone first.")
      return
    }
    YammerService.start(activity)
    invoke.resolve()
  }

  @Command
  fun stopBubble(invoke: Invoke) {
    if (YammerService.instance != null) YammerService.stop(activity)
    invoke.resolve()
  }

  /** The in-app Dictate button. It starts the service first if it's off. */
  @Command
  fun toggle(invoke: Invoke) {
    if (!granted(Manifest.permission.RECORD_AUDIO)) {
      invoke.reject("Allow the microphone first.")
      return
    }
    val service = YammerService.instance
    // Sushi, which would say so, may be hidden.
    if (service?.inMeeting == true) {
      invoke.reject("A meeting is being transcribed. Stop it before dictating.")
      return
    }
    if (service != null) {
      activity.runOnUiThread { service.toggle() }
    } else {
      YammerService.startThenToggle(activity)
    }
    invoke.resolve()
  }

  /** Record a meeting for Rust (`android::meeting_audio`). Resolves once the microphone is open. */
  @Command
  fun startMeeting(invoke: Invoke) {
    if (!granted(Manifest.permission.RECORD_AUDIO)) {
      invoke.reject("Allow the microphone first.")
      return
    }
    YammerService.forMeeting(activity) { service ->
      val error = if (service == null) "Yammer's recording service didn't start." else service.startMeeting()
      if (error == null) invoke.resolve() else invoke.reject(error)
    }
  }

  /** Yammer's theme can differ from the phone's: match the area behind the system bars, and their icons, to the page. */
  private fun bars(invoke: Invoke, dark: Boolean) {
    activity.runOnUiThread {
      val window = activity.window
      window.setBackgroundDrawable(ColorDrawable(if (dark) 0xFF050708.toInt() else 0xFFFCFEFE.toInt()))
      WindowCompat.getInsetsController(window, window.decorView).run {
        isAppearanceLightStatusBars = !dark
        isAppearanceLightNavigationBars = !dark
      }
    }
    invoke.resolve()
  }

  @Command
  fun barsLight(invoke: Invoke) = bars(invoke, false)

  @Command
  fun barsDark(invoke: Invoke) = bars(invoke, true)

  /** Exports go through the share sheet. The file sits in the cache, which file_paths.xml lets FileProvider hand out, until Android clears it. */
  @Command
  fun shareFile(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    val dir = File(activity.cacheDir, "exports").apply { mkdirs() }
    val file = File(dir, File(args.name).name)
    file.writeText(args.contents)
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND)
      .setType(if (file.extension == "csv") "text/csv" else "text/plain")
      .putExtra(Intent.EXTRA_STREAM, uri)
      .putExtra(Intent.EXTRA_SUBJECT, file.name)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    send.clipData = ClipData.newRawUri(file.name, uri)
    activity.startActivity(Intent.createChooser(send, file.name))
    invoke.resolve()
  }

  @Command
  fun copyText(invoke: Invoke) {
    val args = invoke.parseArgs(CopyArgs::class.java)
    val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Yammer", args.text))
    invoke.resolve()
  }
}
