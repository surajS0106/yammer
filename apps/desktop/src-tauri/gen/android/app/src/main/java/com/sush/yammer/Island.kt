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
import kotlin.random.Random

/**
 * What the status-bar island shows while Yammer listens: Sushi on the left and an equaliser on the
 * right, like a music app's. A live update (Android 16) may only show its small icon and a few
 * characters of text, so Sushi is the icon and the equaliser is text.
 *
 * The island is redrawn only a few times a second, so nothing in it moves sideways: the bars rise
 * and fall in place, and Sushi stays put and blinks now and then. Scrolling bars and a hopping Sushi
 * looked jerky at that rate. The bars are Braille dots, two per character, because block characters
 * draw as chunky slabs; silence leaves a dotted line, as Sushi's pill shows.
 *
 * The status bar draws icons in one colour from their alpha, so Sushi is a silhouette with the eyes
 * and the nori band cut out, which is what makes it read as Sushi at that size.
 */
class Island {
  /** The loudest level (RMS, 0..1) heard since the last frame. */
  private var latest = 0f
  /** The level the bars show: quick to rise, slower to fall. */
  private var shown = 0f
  private val heights = IntArray(BARS) { 1 }
  private var frames = 0

  /** A level as the recorder reports it. */
  fun hear(rms: Float) {
    if (rms > latest) latest = rms
  }

  /** Move the bars on by one frame; call once per frame. */
  fun step() {
    val level = shape(latest)
    latest = 0f
    shown = if (level > shown) level else shown * 0.5f + level * 0.5f
    for (i in 0 until BARS) {
      // Each bar has its own reach and a little wobble, so a steady voice still looks alive.
      val h = shown * PROFILE[i] * (0.7f + 0.3f * Random.nextFloat())
      heights[i] = 1 + (h * (ROWS - 1)).roundToInt().coerceIn(0, ROWS - 1)
    }
    frames++
  }

  fun clear() {
    latest = 0f
    shown = 0f
    heights.fill(1)
    frames = 0
  }

  /** The bars as Braille characters, two bars each, standing on the bottom row. */
  fun waveform(): String = buildString {
    for (i in 0 until BARS step 2) append((BRAILLE + column(LEFT, heights[i]) + column(RIGHT, heights[i + 1])).toChar())
  }

  /** Sushi, blinking now and then. */
  fun sushi(): Icon = if (frames % BLINK_EVERY == BLINK_EVERY - 1) closed else open

  private val open = draw(blink = false)
  private val closed = draw(blink = true)

  private fun draw(blink: Boolean): Icon {
    val bmp = Bitmap.createBitmap(SIZE * SCALE, SIZE * SCALE, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    // Centred, standing on the bottom edge.
    val x0 = (SIZE - SushiView.SPRITE_W) / 2
    val y0 = SIZE - SushiView.BODY.size - 1
    val solid = Paint().apply { color = Color.WHITE }
    val cut = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
    fun px(x: Int, y: Int, p: Paint) = c.drawRect(
      ((x0 + x) * SCALE).toFloat(), ((y0 + y) * SCALE).toFloat(), ((x0 + x + 1) * SCALE).toFloat(), ((y0 + y + 1) * SCALE).toFloat(), p,
    )
    for ((y, row) in SushiView.BODY.withIndex()) for ((x, ch) in row.withIndex()) if (ch != '.' && ch != 'N') px(x, y, solid)
    for ((x, ch) in SushiView.LEGS[0].withIndex()) if (ch == 'L') px(x, SushiView.BODY.size, solid)
    for (ex in SushiView.EYES) {
      px(ex, 6, cut)
      px(ex + 1, 6, cut)
      if (!blink) {
        px(ex, 5, cut)
        px(ex + 1, 5, cut)
      }
    }
    return Icon.createWithBitmap(bmp)
  }

  private companion object {
    const val BARS = 10
    /** Dots in a Braille column, and so the tallest bar. */
    const val ROWS = 4
    /** Blink for one frame in this many: about every four seconds. */
    const val BLINK_EVERY = 13
    /** Sprite pixels across the icon, and bitmap pixels per sprite pixel. */
    const val SIZE = 18
    const val SCALE = 4

    /** The blank Braille cell; each raised dot adds a bit. */
    const val BRAILLE = 0x2800
    /** A column's dot bits, bottom row first. */
    val LEFT = intArrayOf(0x40, 0x04, 0x02, 0x01)
    val RIGHT = intArrayOf(0x80, 0x20, 0x10, 0x08)

    /** How far each bar reaches at full voice: taller in the middle, uneven like a real one. */
    val PROFILE = floatArrayOf(0.45f, 0.7f, 0.9f, 0.6f, 1f, 0.85f, 1f, 0.65f, 0.75f, 0.5f)

    fun column(bits: IntArray, height: Int): Int {
      var sum = 0
      for (r in 0 until height) sum += bits[r]
      return sum
    }

    /** The same curve as Sushi's bounce and the Meetings page's meter. */
    fun shape(rms: Float) = (sqrt(rms) * 2.4f).coerceIn(0f, 1f)
  }
}
