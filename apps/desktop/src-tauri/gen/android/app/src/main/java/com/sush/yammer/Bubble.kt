package com.sush.yammer

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Sushi floating over other apps. Tap to start or stop dictating; drag to move it.
 * The window can't take focus (FLAG_NOT_FOCUSABLE), so the text box you're typing in keeps it.
 */
class Bubble(private val context: Context, private val onTap: () -> Unit) {
  enum class Look {
    IDLE,
    LISTENING,
    BUSY,
  }

  private val windows = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val prefs = context.getSharedPreferences("bubble", Context.MODE_PRIVATE)
  private val density = context.resources.displayMetrics.density
  private fun dp(n: Int) = (n * density).toInt()

  private val icon = SushiView(context).apply {
    contentDescription = "Dictate with Yammer"
  }
  private val label = TextView(context).apply {
    setTextColor(Color.WHITE)
    textSize = 13f
    maxWidth = dp(220)
    maxLines = 3
    setPadding(dp(10), dp(6), dp(10), dp(6))
    background = GradientDrawable().apply {
      setColor(Color.parseColor("#E6222222"))
      cornerRadius = dp(12).toFloat()
    }
    visibility = View.GONE
  }
  private val root = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    setPadding(dp(4), dp(4), dp(4), dp(4))
    addView(icon, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(6) })
  }
  private val params = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.START
    x = prefs.getInt("x", 0).coerceIn(0, max(0, context.resources.displayMetrics.widthPixels - dp(110)))
    y = prefs.getInt("y", context.resources.displayMetrics.heightPixels / 2).coerceIn(0, max(0, context.resources.displayMetrics.heightPixels - dp(130)))
  }
  private var shown = false

  /** On screen over other apps. */
  val isShown: Boolean get() = shown
  private val hideLabel = Runnable { label.visibility = View.GONE }

  /** False if "draw over other apps" hasn't been allowed. */
  fun show(): Boolean {
    if (shown) return true
    if (!Settings.canDrawOverlays(context)) return false
    setLook(Look.IDLE)
    root.setOnTouchListener(dragOrTap())
    windows.addView(root, params)
    shown = true
    return true
  }

  fun hide() {
    if (shown) windows.removeView(root)
    shown = false
  }

  fun setLook(look: Look) {
    icon.removeCallbacks(settle)
    icon.setMood(when (look) {
      Look.IDLE -> SushiView.Mood.IDLE
      Look.LISTENING -> SushiView.Mood.LISTENING
      Look.BUSY -> SushiView.Mood.TRANSCRIBING
    })
  }

  /** Sushi bounces with your voice, on the same curve as in the app. */
  fun setLevel(rms: Float) = icon.setLevel(rms)

  /** A happy hop and a heart, then back to idle. */
  fun cheer() = react(SushiView.Mood.DONE)

  /** A shake and a sweat bead, then back to idle. */
  fun oops() = react(SushiView.Mood.ERROR)

  private fun react(m: SushiView.Mood) {
    icon.setMood(m)
    icon.removeCallbacks(settle)
    icon.postDelayed(settle, 1800)
  }
  private val settle = Runnable { icon.setMood(SushiView.Mood.IDLE) }

  /** A note beside Sushi; it goes away after [ms], or stays if 0. */
  fun say(text: String?, ms: Long = 0) {
    label.removeCallbacks(hideLabel)
    label.text = text
    label.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
    if (ms > 0) label.postDelayed(hideLabel, ms)
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun dragOrTap() = object : View.OnTouchListener {
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var startX = 0
    private var startY = 0
    private var touchX = 0f
    private var touchY = 0f
    private var dragging = false

    override fun onTouch(v: View, e: MotionEvent): Boolean {
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x
          startY = params.y
          touchX = e.rawX
          touchY = e.rawY
          dragging = false
          icon.poke()
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - touchX
          val dy = e.rawY - touchY
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
            dragging = true
            icon.setHeld(true)
          }
          if (dragging) {
            val m = context.resources.displayMetrics
            params.x = (startX + dx.toInt()).coerceIn(0, max(0, m.widthPixels - dp(110)))
            params.y = (startY + dy.toInt()).coerceIn(0, max(0, m.heightPixels - dp(130)))
            windows.updateViewLayout(root, params)
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          icon.setHeld(false)
          if (e.actionMasked == MotionEvent.ACTION_CANCEL) {
            // The system took the touch away: neither a tap nor the end of a drag.
          } else if (dragging) {
            prefs.edit().putInt("x", params.x).putInt("y", params.y).apply()
          } else {
            v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
            onTap()
          }
        }
      }
      return true
    }
  }
}
