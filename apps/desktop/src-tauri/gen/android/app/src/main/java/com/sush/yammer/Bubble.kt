package com.sush.yammer

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
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
 * Sushi floating over other apps. Tap to start or stop dictating; drag to move it, or onto the ✕
 * that appears at the bottom while dragging to turn Sushi off ([onDismiss]), as chat heads do.
 * People playing a game full screen found no other way to get rid of it.
 * The window can't take focus (FLAG_NOT_FOCUSABLE), so the text box you're typing in keeps it.
 */
class Bubble(
  private val context: Context,
  private val onTap: () -> Unit,
  /** Whether dropping Sushi on the ✕ may turn it off now: not mid-dictation. */
  private val canDismiss: () -> Boolean,
  private val onDismiss: () -> Unit,
) {
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
  private val target = DismissTarget(context, dp(64))
  private val targetParams = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
    y = dp(72)
    // Android 12+ lets touches through an untouchable overlay only at 0.8 opacity or less.
    alpha = 0.8f
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
    // The ✕ goes in first so that Sushi, dropped on it, is drawn on top.
    target.visibility = View.GONE
    windows.addView(target, targetParams)
    windows.addView(root, params)
    shown = true
    // Until it's been learnt: someone in a game had no idea how to make Sushi go away.
    val hints = prefs.getInt("dismissHints", 0)
    if (hints < 3) {
      prefs.edit().putInt("dismissHints", hints + 1).apply()
      say("Drag me to the bottom to hide me", 4000)
    }
    return true
  }

  fun hide() {
    if (shown) {
      windows.removeView(root)
      windows.removeView(target)
    }
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
    /** Where the window's (0, 0) is on screen, to put Sushi over the ✕. */
    private var originX = 0
    private var originY = 0
    private var dismissable = false
    /** Over the ✕: letting go turns Sushi off. */
    private var over = false
    private val loc = IntArray(2)

    override fun onTouch(v: View, e: MotionEvent): Boolean {
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x
          startY = params.y
          touchX = e.rawX
          touchY = e.rawY
          root.getLocationOnScreen(loc)
          originX = loc[0] - params.x
          originY = loc[1] - params.y
          dragging = false
          over = false
          icon.poke()
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - touchX
          val dy = e.rawY - touchY
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
            dragging = true
            icon.setHeld(true)
            dismissable = canDismiss()
            if (dismissable) {
              say(null)
              target.appear()
            }
          }
          if (dragging) {
            val near = dismissable && target.isNear(e.rawX, e.rawY, dp(88))
            if (near != over) {
              over = near
              target.setHot(near)
              v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
            }
            if (over) {
              // Sushi snaps onto the ✕. The root's padding is 4dp.
              target.getLocationOnScreen(loc)
              params.x = loc[0] + target.width / 2 - originX - icon.width / 2 - dp(4)
              params.y = loc[1] + target.height / 2 - originY - icon.height / 2 - dp(4)
            } else {
              val m = context.resources.displayMetrics
              params.x = (startX + dx.toInt()).coerceIn(0, max(0, m.widthPixels - dp(110)))
              params.y = (startY + dy.toInt()).coerceIn(0, max(0, m.heightPixels - dp(130)))
            }
            windows.updateViewLayout(root, params)
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          icon.setHeld(false)
          if (dragging && dismissable) target.vanish()
          if (over) {
            // It comes back where it was, not on the ✕, the next time it's on screen.
            params.x = startX
            params.y = startY
          }
          if (e.actionMasked == MotionEvent.ACTION_CANCEL) {
            // The system took the touch away: neither a tap nor the end of a drag.
            if (over) windows.updateViewLayout(root, params)
          } else if (over) {
            onDismiss()
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

/** The ✕ at the bottom of the screen that Sushi is dropped on to turn it off. It grows and turns red with Sushi over it. */
private class DismissTarget(context: Context, private val size: Int) : View(context) {
  private val density = context.resources.displayMetrics.density
  private var hot = false
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = 1.5f * density
    color = Color.parseColor("#66FFFFFF")
  }
  private val cross = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = 2.5f * density
    strokeCap = Paint.Cap.ROUND
    color = Color.WHITE
  }
  private val loc = IntArray(2)

  init {
    contentDescription = "Turn Sushi off"
  }

  // Room to grow while hot without the window resizing.
  override fun onMeasure(w: Int, h: Int) = setMeasuredDimension((size * 1.4f).toInt(), (size * 1.4f).toInt())

  override fun onDraw(canvas: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val r = size / 2f * (if (hot) 1.25f else 1f)
    fill.color = if (hot) Color.parseColor("#E5484D") else Color.parseColor("#D9222222")
    canvas.drawCircle(cx, cy, r, fill)
    if (!hot) canvas.drawCircle(cx, cy, r, ring)
    val arm = size * 0.16f
    canvas.drawLine(cx - arm, cy - arm, cx + arm, cy + arm, cross)
    canvas.drawLine(cx - arm, cy + arm, cx + arm, cy - arm, cross)
  }

  fun setHot(on: Boolean) {
    if (hot == on) return
    hot = on
    invalidate()
  }

  fun isNear(x: Float, y: Float, within: Int): Boolean {
    if (visibility != VISIBLE || width == 0) return false
    getLocationOnScreen(loc)
    val dx = x - (loc[0] + width / 2f)
    val dy = y - (loc[1] + height / 2f)
    return sqrt(dx * dx + dy * dy) < within
  }

  fun appear() {
    hot = false
    animate().cancel()
    visibility = VISIBLE
    alpha = 0f
    scaleX = 0.6f
    scaleY = 0.6f
    animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(160).start()
  }

  fun vanish() {
    animate().cancel()
    animate().alpha(0f).scaleX(0.6f).scaleY(0.6f).setDuration(140).withEndAction {
      visibility = GONE
      hot = false
    }.start()
  }
}
