package com.sush.yammer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.drawable.Icon
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * What the status-bar island shows while Yammer listens: Sushi on the left, hopping with your voice,
 * and a waveform on the right, like a music app's. A live update (Android 16) may only show its
 * small icon and a few characters of text, so Sushi is drawn as the icon and the waveform as text.
 *
 * The status bar draws icons in one colour from their alpha, so Sushi is a silhouette with the eyes
 * and the nori band cut out, which is what makes it read as Sushi at that size.
 */
class Island {
  /** The last few levels, oldest first: one bar each. */
  private val levels = FloatArray(BARS)
  private var latest = 0f
  private var frames = 0

  /** A level (RMS, 0..1) as the recorder reports it. The loudest since the last frame wins. */
  fun hear(rms: Float) {
    if (rms > latest) latest = rms
  }

  /** Move the waveform on by one bar; call once per frame. */
  fun step() {
    System.arraycopy(levels, 1, levels, 0, BARS - 1)
    levels[BARS - 1] = latest
    latest = 0f
    frames++
  }

  fun clear() {
    levels.fill(0f)
    latest = 0f
  }

  /** The waveform as block characters, which the island draws as text. */
  fun waveform(): String = buildString {
    for (l in levels) append(GLYPHS[(shape(l) * (GLYPHS.length - 1)).roundToInt()])
  }

  /** Sushi, hopping with the newest level, blinking now and then. */
  fun sushi(): Icon {
    val bmp = Bitmap.createBitmap(SIZE * SCALE, SIZE * SCALE, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val hop = (shape(levels[BARS - 1]) * 3f).roundToInt()
    // Centred, standing on the bottom edge, lifted by the hop.
    val x0 = (SIZE - SushiView.SPRITE_W) / 2
    val y0 = SIZE - SushiView.BODY.size - 1 - hop
    val solid = Paint().apply { color = Color.WHITE }
    val cut = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
    fun px(x: Int, y: Int, p: Paint) = c.drawRect(
      ((x0 + x) * SCALE).toFloat(), ((y0 + y) * SCALE).toFloat(), ((x0 + x + 1) * SCALE).toFloat(), ((y0 + y + 1) * SCALE).toFloat(), p,
    )
    for ((y, row) in SushiView.BODY.withIndex()) for ((x, ch) in row.withIndex()) if (ch != '.' && ch != 'N') px(x, y, solid)
    for ((x, ch) in SushiView.LEGS[0].withIndex()) if (ch == 'L') px(x, SushiView.BODY.size, solid)
    // Eyes, closed for one frame in sixteen.
    val blink = frames % 16 == 0
    for (ex in SushiView.EYES) {
      px(ex, if (blink) 6 else 5, cut)
      px(ex + 1, if (blink) 6 else 5, cut)
      if (!blink) {
        px(ex, 6, cut)
        px(ex + 1, 6, cut)
      }
    }
    return Icon.createWithBitmap(bmp)
  }

  private companion object {
    const val BARS = 5
    /** Sprite pixels across the icon, and bitmap pixels per sprite pixel. */
    const val SIZE = 18
    const val SCALE = 4
    const val GLYPHS = "▁▂▃▄▅▆▇█"

    /** The same curve as Sushi's bounce and the Meetings page's meter. */
    fun shape(rms: Float) = (sqrt(rms) * 2.4f).coerceIn(0f, 1f)
  }
}
