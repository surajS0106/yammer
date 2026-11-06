package com.sush.yammer

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
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

  /**
   * Back steps through the page's own history first (lib/back.ts keeps one entry per level), and
   * with none left leaves Yammer running, like Home: Sushi should stay. This runs for the key and
   * the edge swipe alike (the manifest turns predictive back off), and it never reaches Tauri's own
   * handler, so it has to do the webview's goBack itself.
   */
  @Deprecated("Tauri's back handling still calls this")
  override fun onBackPressed() {
    val web = findWebView(window.decorView)
    if (web != null && web.canGoBack()) web.goBack() else moveTaskToBack(true)
  }

  private fun findWebView(v: View): WebView? {
    if (v is WebView) return v
    if (v is ViewGroup) for (i in 0 until v.childCount) findWebView(v.getChildAt(i))?.let { return it }
    return null
  }

  private companion object {
    /** This process has already built its webview. */
    var loaded = false
  }
}
