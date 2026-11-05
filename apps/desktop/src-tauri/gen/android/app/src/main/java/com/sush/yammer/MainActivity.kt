package com.sush.yammer

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (loaded) restartWhenIdle()
    loaded = true
    // Keep the page clear of the status bar, the navigation bar and the keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  /**
   * The service keeps the process alive after the app is swiped from Recents, but Tauri can't
   * build a second webview in one process, so the page would stay blank. Restart the process,
   * after any dictation in progress. Home turns Sushi back on.
   */
  private fun restartWhenIdle() {
    if (YammerService.instance?.isIdle == false) {
      Handler(Looper.getMainLooper()).postDelayed(::restartWhenIdle, 500)
      return
    }
    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    Runtime.getRuntime().exit(0)
  }

  /** Back leaves Yammer running, like Home: there's nothing behind the page, and Sushi should stay. */
  @Deprecated("Tauri's back handling still calls this")
  override fun onBackPressed() {
    moveTaskToBack(true)
  }

  private companion object {
    /** This process has already built its webview. */
    var loaded = false
  }
}
