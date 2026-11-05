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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Sushi floating over other apps. Tap to start or stop dictating; drag to move it.
 * The window can't take focus (FLAG_NOT_FOCUSABLE), so the text box you're typing in keeps it.
 */
class Bubble(private val context: Context, private val onTap: () -> Unit) {
  enum class Look(val ring: Int) {
    IDLE(Color.WHITE),
    LISTENING(CORAL),
    BUSY(Color.parseColor("#F5A623")),
  }

  private val windows = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val prefs = context.getSharedPreferences("bubble", Context.MODE_PRIVATE)
  private val density = context.resources.displayMetrics.density
  private fun dp(n: Int) = (n * density).toInt()

  private val ring = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val icon = ImageView(context).apply {
    setImageResource(R.drawable.sushi)
    background = ring
    setPadding(dp(9), dp(9), dp(9), dp(9))
    elevation = dp(6).toFloat()
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
    setPadding(dp(6), dp(6), dp(6), dp(6))
    addView(icon, LinearLayout.LayoutParams(dp(56), dp(56)))
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
    x = prefs.getInt("x", 0)
    y = prefs.getInt("y", context.resources.displayMetrics.heightPixels / 2)
  }
  private var shown = false
  private val hideLabel = Runnable { label.visibility = View.GONE }

  /** False if "draw over other apps" hasn't been allowed. */
  fun show(): Boolean {
    if (shown) return true
    if (!Settings.canDrawOverlays(context)) return false
    setLook(Look.IDLE)
    icon.setOnTouchListener(dragOrTap())
    windows.addView(root, params)
    shown = true
    return true
  }

  fun hide() {
    if (shown) windows.removeView(root)
    shown = false
  }

  fun setLook(look: Look) {
    ring.setColor(Color.WHITE)
    ring.setStroke(dp(3), look.ring)
    if (look != Look.LISTENING) setLevel(0f)
  }

  /** Sushi bounces with your voice, on the same curve as in the app. */
  fun setLevel(rms: Float) {
    val scale = 1f + min(1f, sqrt(rms) * 2.4f) * 0.18f
    icon.scaleX = scale
    icon.scaleY = scale
  }

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
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - touchX
          val dy = e.rawY - touchY
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
          if (dragging) {
            params.x = startX + dx.toInt()
            params.y = startY + dy.toInt()
            windows.updateViewLayout(root, params)
          }
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
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

  companion object {
    private val CORAL = Color.parseColor("#F0654A")
  }
}
