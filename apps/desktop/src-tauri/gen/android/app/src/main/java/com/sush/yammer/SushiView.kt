package com.sush.yammer

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.view.View
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * Sushi, the pixel-art nigiri from the desktop app, drawn natively for the floating bubble. This is
 * a port of components/sushi.tsx: the same sprite, the same acts for each mood, the same keyframes,
 * timings and easing, idle tricks, dozing off, glasses, laptop and effects. Keep the two in step.
 *
 * Distances below are the web component's numbers, in CSS px at 2 px per sprite pixel; [k] converts.
 */
class SushiView(context: Context) : View(context) {
  enum class Mood { IDLE, LISTENING, TRANSCRIBING, POLISHING, DONE, ERROR }

  private enum class Act { IDLE, LISTENING, TRANSCRIBING, POLISHING, DONE, ERROR, HELD }
  private enum class P { X, Y, R, SX, SY, O }
  private enum class Ease(val a: Float, val b: Float, val c: Float, val d: Float) {
    OUT(0f, 0f, 0.58f, 1f),
    IN(0.42f, 0f, 1f, 1f),
    IN_OUT(0.42f, 0f, 0.58f, 1f),
    FLIP(0.3f, 0f, 0.3f, 1f),
  }

  /** One `controls.start`: keyframes per property, spread over [dur] ms (or at [times]). */
  private class Seg(
    val dur: Long,
    val keys: Map<P, FloatArray>,
    val ease: Ease = Ease.IN_OUT,
    val times: FloatArray? = null,
    val repeat: Boolean = false,
    val mirror: Boolean = false,
    val onStart: (() -> Unit)? = null,
    val onEnd: (() -> Unit)? = null,
  )

  private class Fx(val id: Int, val kind: Int, val born: Long, val dx: Float, val variant: Int)

  private val density = context.resources.displayMetrics.density

  /** Device px per sprite pixel, and the web's CSS-px-at-2 conversion. */
  private val px = 2.8f * density
  private val k = px / 2f
  private val paint = Paint().apply { isAntiAlias = false }

  // The rest pose and the live values of the animated properties.
  private val cur = floatArrayOf(0f, 0f, 0f, 1f, 1f, 1f)
  private var run: Seg? = null
  private var runStart = 0L
  private var runFrom = FloatArray(6)
  private val queue = ArrayDeque<Seg>()
  private var runToken = 0

  private var mood = Mood.IDLE
  private var held = false
  private var prevAct: Act? = null
  private var act = Act.IDLE

  private var level = 0f
  private var shownLevel = 0f
  private var lastNote = 0L
  private var sleeping = false
  private var lastActive = SystemClock.uptimeMillis()
  private var blink = false
  private var blinkAt = SystemClock.uptimeMillis() + 2500
  private var trickLook: IntArray? = null
  private var dancing = false
  private var ponder = false
  private var ponderAt = 0L
  private var glance = false
  private var glanceAt = 0L
  private var nextTrickAt = 0L
  private var lastTrick = -1
  private var frame = 0
  private var frameAt = 0L
  private var burstAt = 0L
  private var moodSince = 0L
  private var glassesAmt = 0f
  private var laptopAmt = 0f
  private var lastDraw = 0L
  private var nextId = 1
  private val fx = ArrayList<Fx>()

  init {
    actChanged()
  }

  // ---- Public ----

  fun setMood(m: Mood) {
    if (m == mood) return
    mood = m
    actChanged()
  }

  /** Being carried around: it kicks its feet and swings, eyes wide, and lands with a squash. */
  fun setHeld(h: Boolean) {
    if (h == held) return
    held = h
    if (h) spawn(KIND_BANG, 0f)
    actChanged()
  }

  /** Any touch or activity wakes it. */
  fun poke() = wake()

  /** The voice level, rising fast and settling slowly, so it bounces rather than jitters. */
  fun setLevel(rms: Float) {
    if (mood != Mood.LISTENING) return
    val v = min(1f, sqrt(rms) * 2.4f)
    level = if (v > level) v else level * 0.6f + v * 0.4f
    val now = SystemClock.uptimeMillis()
    if (v > 0.4f && now - lastNote > 450) {
      lastNote = now
      spawn(KIND_NOTE, Math.round((Random.nextFloat() - 0.5f) * 16f).toFloat())
    }
  }

  // ---- Acts ----

  private fun spawn(kind: Int, dx: Float) {
    val id = nextId++
    fx.add(Fx(id, kind, SystemClock.uptimeMillis(), dx, id % 2))
  }

  private fun wake() {
    lastActive = SystemClock.uptimeMillis()
    if (!sleeping) return
    sleeping = false
    spawn(KIND_BANG, 0f)
    play(seg(350, Ease.OUT, P.Y to f(0f, -12f, 0f), P.SY to f(1f, 1.15f, 1f)))
  }

  private fun seg(
    dur: Long,
    ease: Ease = Ease.IN_OUT,
    vararg keys: Pair<P, FloatArray>,
    times: FloatArray? = null,
    repeat: Boolean = false,
    mirror: Boolean = false,
    onStart: (() -> Unit)? = null,
    onEnd: (() -> Unit)? = null,
  ) = Seg(dur, keys.toMap(), ease, times, repeat, mirror, onStart, onEnd)

  private fun f(vararg v: Float) = v

  /** Stop what's playing and play these in order. */
  private fun play(vararg segs: Seg) {
    runToken++
    queue.clear()
    run = null
    queue.addAll(segs)
  }

  private fun settle() {
    cur[P.X.ordinal] = 0f
    cur[P.Y.ordinal] = 0f
    cur[P.R.ordinal] = 0f
    cur[P.SX.ordinal] = 1f
    cur[P.SY.ordinal] = 1f
  }

  private fun actChanged() {
    val from = prevAct
    val now = SystemClock.uptimeMillis()
    act = if (held) Act.HELD else Act.valueOf(mood.name)
    prevAct = act
    moodSince = now
    if (mood != Mood.LISTENING) level = 0f
    trickLook = null
    dancing = false
    if (act != Act.IDLE) wake()
    lastActive = now
    settle()
    val resumed = from == act
    val segs = ArrayList<Seg>()
    if (from == Act.HELD) {
      segs += seg(350, Ease.OUT, P.Y to f(-3f, 0f, 0f), P.SY to f(1.1f, 0.8f, 1f), P.SX to f(0.92f, 1.18f, 1f))
    } else if (from == null) {
      cur[P.O.ordinal] = 0f
      segs += seg(550, Ease.OUT, P.Y to f(-18f, 0f, -4f, 0f), P.SX to f(0.6f, 1.2f, 0.95f, 1f), P.SY to f(1.3f, 0.8f, 1.05f, 1f), P.R to f(0f, -8f, 4f, 0f), P.O to f(0f, 1f, 1f, 1f), times = f(0f, 0.45f, 0.75f, 1f))
    }
    when (act) {
      Act.HELD -> {
        segs += seg(900, Ease.IN_OUT, P.Y to f(-2f), P.R to f(0f, -10f, 10f, -10f), repeat = true, mirror = true, onStart = { dancing = true })
      }
      Act.IDLE -> {
        if (from != null && from != Act.IDLE) segs += seg(500, Ease.IN_OUT, P.Y to f(0f, -6f, 0f, -2f, 0f), times = f(0f, 0.3f, 0.6f, 0.8f, 1f))
        nextTrickAt = now + 3500 + Random.nextLong(5000)
      }
      Act.LISTENING -> segs += seg(350, Ease.OUT, P.Y to f(0f, -10f, 0f), P.SX to f(1f, 0.88f, 1f), P.SY to f(1f, 1.16f, 1f))
      Act.TRANSCRIBING -> {
        if (!resumed) segs += seg(300, Ease.OUT, P.Y to f(0f, -5f, 0f))
        segs += seg(400, Ease.IN_OUT, P.Y to f(0f, 0.6f, 0f), P.SY to f(1f, 0.97f, 1f), P.SX to f(1f, 1.015f, 1f), repeat = true)
      }
      Act.POLISHING -> segs += seg(2000, Ease.IN_OUT, P.R to f(0f, -6f, 0f, 6f, 0f), repeat = true)
      Act.DONE -> {
        burstAt = now
        spawn(KIND_HEART, 0f)
        segs += seg(650, Ease.FLIP, P.Y to f(0f, -16f, 0f), P.R to f(0f, -360f), onEnd = { cur[P.R.ordinal] = 0f })
        segs += seg(350, Ease.IN_OUT, P.SY to f(1f, 0.82f, 1.06f, 1f), P.SX to f(1f, 1.15f, 0.96f, 1f))
      }
      Act.ERROR -> {
        segs += seg(500, Ease.IN_OUT, P.X to f(0f, -4f, 4f, -3f, 3f, -0.5f, 0f))
        segs += seg(300, Ease.IN_OUT, P.SY to f(0.94f), P.SX to f(1.04f))
      }
    }
    play(*segs.toTypedArray())
  }

  /** One idle trick, never the same twice running. */
  private fun startTrick() {
    var t: Int
    do t = Random.nextInt(7) while (t == lastTrick)
    lastTrick = t
    val s: List<Seg> = when (t) {
      0 -> listOf(seg(700, Ease.OUT, P.Y to f(0f, 0.5f, -12f, 0f, -4f, 0f), P.SY to f(1f, 0.82f, 1.12f, 0.9f, 1.04f, 1f), P.SX to f(1f, 1.14f, 0.92f, 1.08f, 0.98f, 1f)))
      1 -> listOf(seg(600, Ease.FLIP, P.Y to f(0f, -16f, 0f), P.R to f(0f, -360f), onEnd = { cur[P.R.ordinal] = 0f }))
      2 -> listOf(seg(800, Ease.IN_OUT, P.R to f(0f, -12f, 12f, -9f, 9f, -4f, 0f)))
      3 -> listOf(
        seg(1600, Ease.IN_OUT, P.R to f(0f, -8f, 8f, -8f, 8f, -8f, 8f, 0f), P.Y to f(0f, -3f, 0f, -3f, 0f, -3f, 0f, 0f), onStart = { dancing = true }, onEnd = { dancing = false }),
      )
      4 -> listOf(seg(1200, Ease.IN_OUT, P.SX to f(1f, -1f, -1f, 1f), times = f(0f, 0.2f, 0.75f, 1f)))
      5 -> listOf(seg(1300, Ease.IN_OUT, P.SY to f(1f, 1.22f, 1.22f, 1f), P.SX to f(1f, 0.88f, 0.88f, 1f), times = f(0f, 0.35f, 0.7f, 1f), onStart = { trickLook = intArrayOf(0, 1) }, onEnd = { trickLook = null }))
      else -> listOf(
        seg(550, Ease.IN_OUT, onStart = { trickLook = intArrayOf(-1, 0) }),
        seg(550, Ease.IN_OUT, onStart = { trickLook = intArrayOf(1, 0) }),
        seg(550, Ease.IN_OUT, onStart = { trickLook = intArrayOf(0, -1) }, onEnd = { trickLook = null }),
      )
    }
    play(*s.toTypedArray())
  }

  // ---- Sampling ----

  private fun bezier(e: Ease, x: Float): Float {
    if (x <= 0f) return 0f
    if (x >= 1f) return 1f
    var lo = 0f
    var hi = 1f
    var t = x
    repeat(18) {
      t = (lo + hi) / 2f
      val mt = 1f - t
      val bx = 3f * mt * mt * t * e.a + 3f * mt * t * t * e.c + t * t * t
      if (bx < x) lo = t else hi = t
    }
    val mt = 1f - t
    return 3f * mt * mt * t * e.b + 3f * mt * t * t * e.d + t * t * t
  }

  private fun sample(v: FloatArray, times: FloatArray?, p: Float, ease: Ease): Float {
    if (v.size == 1) return v[0]
    val n = v.size
    val tm = times ?: FloatArray(n) { it / (n - 1f) }
    var i = 0
    while (i < n - 2 && p > tm[i + 1]) i++
    val span = tm[i + 1] - tm[i]
    val local = if (span <= 0f) 1f else ((p - tm[i]) / span).coerceIn(0f, 1f)
    return v[i] + (v[i + 1] - v[i]) * bezier(ease, local)
  }

  private fun advance(now: Long) {
    var guard = 0
    while (guard++ < 6) {
      val r = run
      if (r == null) {
        val next = queue.removeFirstOrNull() ?: return
        run = next
        runStart = now
        System.arraycopy(cur, 0, runFrom, 0, 6)
        next.onStart?.invoke()
        continue
      }
      val elapsed = now - runStart
      var p: Float
      if (r.repeat) {
        val cycles = elapsed / r.dur
        val ph = (elapsed % r.dur) / r.dur.toFloat()
        p = if (r.mirror && cycles % 2L == 1L) 1f - ph else ph
      } else {
        p = min(1f, elapsed / r.dur.toFloat())
      }
      for ((prop, vals) in r.keys) {
        val arr = if (vals.size == 1) floatArrayOf(runFrom[prop.ordinal], vals[0]) else vals
        cur[prop.ordinal] = sample(arr, r.times, p, r.ease)
      }
      if (!r.repeat && elapsed >= r.dur) {
        r.onEnd?.invoke()
        run = null
        continue
      }
      return
    }
  }

  // ---- Drawing ----

  override fun onMeasure(w: Int, h: Int) {
    // Sprite is 16 × 11 pixels; room around it for the hops, flips and floating effects.
    setMeasuredDimension((SPRITE_W + 8) * px.toInt(), (SPRITE_H + 17) * px.toInt())
  }

  private var alphaMul = 1f

  private fun rect(c: Canvas, x: Float, y: Float, w: Float, h: Float, color: Int, alpha: Float = 1f) {
    paint.color = color
    paint.alpha = (alpha * alphaMul).coerceIn(0f, 1f).times(255f).toInt()
    c.drawRect(x * px, y * px, (x + w) * px, (y + h) * px, paint)
  }

  private fun pixels(c: Canvas, rows: List<String>, y0: Int = 0, alpha: Float = 1f) {
    for ((y, row) in rows.withIndex()) {
      var x = 0
      while (x < row.length) {
        val ch = row[x]
        var w = 1
        while (x + w < row.length && row[x + w] == ch) w++
        if (ch != '.') rect(c, x.toFloat(), (y + y0).toFloat(), w.toFloat(), 1f, COLORS[ch] ?: Color.MAGENTA, alpha)
        x += w
      }
    }
  }

  private fun tick(now: Long) {
    // Blink every few seconds, sometimes twice.
    if (!sleeping && now >= blinkAt) {
      if (blink) {
        blink = false
        blinkAt = now + if (Random.nextFloat() < 0.25f) 120 else 2200 + Random.nextLong(3000)
      } else {
        blink = true
        blinkAt = now + 140
      }
    }
    // Doze off when idle and left alone.
    if (mood == Mood.IDLE && !sleeping && !held && now - lastActive > SLEEP_AFTER) {
      sleeping = true
      play(seg(500, Ease.IN_OUT, P.X to f(0f), P.Y to f(0f), P.R to f(0f), P.SX to f(1f), P.SY to f(1f)))
    }
    // Idle tricks.
    if (mood == Mood.IDLE && !sleeping && !held && run == null && queue.isEmpty() && now >= nextTrickAt) {
      startTrick()
      nextTrickAt = Long.MAX_VALUE
    }
    if (mood == Mood.IDLE && !sleeping && !held && run == null && queue.isEmpty() && nextTrickAt == Long.MAX_VALUE) {
      nextTrickAt = now + 3500 + Random.nextLong(5000)
    }
    if (mood == Mood.POLISHING && now >= ponderAt) {
      ponder = !ponder
      ponderAt = now + 1100
    }
    if (mood == Mood.TRANSCRIBING) {
      if (now >= glanceAt) {
        glance = !glance
        glanceAt = now + if (glance) 600 else 1800 + Random.nextLong(2000)
      }
    } else glance = false
    val moving = dancing || mood == Mood.TRANSCRIBING
    if (moving) {
      val step = if (held) 120 else if (dancing) 200 else 110
      if (now - frameAt >= step) {
        frame++
        frameAt = now
      }
    } else frame = 0
    // Glasses and laptop slide in and out.
    val dt = if (lastDraw == 0L) 16f else (now - lastDraw).toFloat()
    val glassesWant = mood == Mood.TRANSCRIBING || mood == Mood.POLISHING
    glassesAmt = (glassesAmt + (if (glassesWant) dt / 250f else -dt / 350f)).coerceIn(0f, 1f)
    val laptopWant = mood == Mood.TRANSCRIBING && now - moodSince > 120
    laptopAmt = (laptopAmt + (if (laptopWant) dt / 250f else -dt / 250f)).coerceIn(0f, 1f)
    // The voice-driven bounce eases in over about 80 ms.
    shownLevel += (level - shownLevel) * min(1f, dt / 80f)
    lastDraw = now
    fx.removeAll { now - it.born > 2600 && it.kind != KIND_Z }
  }

  override fun onDraw(c: Canvas) {
    val now = SystemClock.uptimeMillis()
    tick(now)
    advance(now)

    val look = when {
      held -> intArrayOf(0, -1)
      sleeping -> intArrayOf(0, 1)
      mood == Mood.LISTENING -> intArrayOf(0, if (level > 0.55f) -1 else 0)
      mood == Mood.TRANSCRIBING -> if (glance) intArrayOf(1, -1) else intArrayOf(0, 0)
      mood == Mood.POLISHING -> intArrayOf(if (ponder) 1 else -1, -1)
      mood == Mood.ERROR -> intArrayOf(0, 1)
      else -> trickLook ?: intArrayOf(0, 0)
    }
    val closed = !held && (sleeping || blink || mood == Mood.DONE)
    val moving = dancing || mood == Mood.TRANSCRIBING
    val breath = when {
      moving || mood == Mood.LISTENING -> 1f
      sleeping -> 1f + 0.06f * sin2(now / 3600f)
      else -> 1f + 0.03f * sin2(now / 2600f)
    }

    val boxW = width.toFloat()
    val baseY = height - 1.5f * px
    val cx = boxW / 2f

    c.save()
    c.translate(cx, baseY)
    // Effects are positioned from the sprite's top-centre.
    val top = -SPRITE_H * px
    drawEffects(c, now, top)

    c.translate(cur[P.X.ordinal] * k, cur[P.Y.ordinal] * k)
    c.rotate(cur[P.R.ordinal])
    c.scale(cur[P.SX.ordinal], cur[P.SY.ordinal])
    alphaMul = cur[P.O.ordinal]
    c.translate(0f, -shownLevel * 3f * k)
    c.scale(1f - shownLevel * 0.08f, 1f + shownLevel * 0.16f)
    c.scale(1f, breath)
    c.translate(-SPRITE_W / 2f * px, top)

    pixels(c, BODY)
    for (ex in EYES) {
      val x = (ex + look[0]).toFloat()
      val y = (5 + look[1] + if (closed) 1 else 0).toFloat()
      rect(c, x, y, 2f, if (closed) 1f else 2f, COLORS['E']!!)
    }

    if (glassesAmt > 0f) {
      val gy = -(1f - glassesAmt) * (if (glassesWant()) 4f else 5f)
      c.save()
      c.translate(0f, gy * px)
      val a = glassesAmt
      for (l in LENSES) {
        rect(c, (l[0] + 1).toFloat(), (l[1] + 1).toFloat(), (l[2] - 2).toFloat(), (l[3] - 2).toFloat(), Color.parseColor("#9fdcff"), 0.28f * a)
        if (mood == Mood.POLISHING) {
          val ph = ((now % 1500) / 500f)
          if (ph < 1f) {
            val e = bezier(Ease.IN_OUT, ph)
            rect(c, l[0] + 1 + (l[2] - 3) * e, (l[1] + 1).toFloat(), 1f, (l[3] - 2).toFloat(), Color.WHITE, sin2(ph / 2f) * 0.9f * a)
          }
        } else rect(c, (l[0] + 1).toFloat(), (l[1] + 1).toFloat(), 1f, 1f, Color.WHITE, 0.7f * a)
      }
      for (r in FRAME) rect(c, r[0].toFloat(), r[1].toFloat(), r[2].toFloat(), 1f, COLORS['G']!!, a)
      c.restore()
    }

    val legs = LEGS[if (dancing) frame % 2 else 0]
    for ((x, ch) in legs.withIndex()) if (ch == 'L') rect(c, x.toFloat(), BODY.size.toFloat(), 1f, 1f, COLORS['L']!!)

    if (mood == Mood.ERROR) {
      val ph = ((now - moodSince - 300) % 1400 + 1400) % 1400 / 1400f
      if (now - moodSince >= 300) {
        val a = sample(f(0f, 1f, 1f, 0f), null, ph, Ease.IN_OUT)
        val dy = sample(f(0f, 1f, 3f, 4f), null, ph, Ease.IN_OUT)
        rect(c, 14f, 1f + dy, 1f, 1f, COLORS['D']!!, a)
        rect(c, 13f, 2f + dy, 3f, 2f, COLORS['D']!!, a)
      }
    }

    if (laptopAmt > 0f) {
      val a = laptopAmt
      // The screen's light flickering on the face.
      val lightPh = (now % 2000) / 2000f
      val light = sample(f(0.1f, 0.24f, 0.14f, 0.28f, 0.12f), null, lightPh, Ease.IN_OUT)
      rect(c, 1f, 3f, 14f, 4f, Color.parseColor("#9fdcff"), light * a)
      c.save()
      val sy = 0.3f + 0.7f * a
      val ty = (1f - a) * 4f
      c.translate(0f, (LAPTOP_Y + 4 + ty) * px)
      c.scale(1f, sy)
      c.translate(0f, -(LAPTOP_Y + 4) * px)
      pixels(c, LAPTOP, LAPTOP_Y, a)
      val hands = HAND_FRAMES[frame % 2]
      for ((i, hx) in HAND_X.withIndex()) rect(c, hx.toFloat(), (LAPTOP_Y + hands[i]).toFloat(), 1f, 1f, COLORS['R']!!, a)
      c.restore()
    }
    alphaMul = 1f
    c.restore()

    postInvalidateDelayed(16)
  }

  private fun glassesWant() = mood == Mood.TRANSCRIBING || mood == Mood.POLISHING

  private fun sin2(x: Float) = sin(x * 2f * PI.toFloat()) * 0.5f + 0.5f

  /** A small sprite, centred on [cx] with its top at [y], scaled and turned about its centre. */
  private fun glyph(c: Canvas, rows: List<String>, cx: Float, y: Float, size: Float, alpha: Float, scale: Float = 1f, rot: Float = 0f) {
    val w = rows[0].length * size
    val h = rows.size * size
    c.save()
    c.translate(cx, y + h / 2f)
    c.rotate(rot)
    c.scale(scale, scale)
    c.translate(-w / 2f, -h / 2f)
    for ((j, row) in rows.withIndex()) for ((i, ch) in row.withIndex()) {
      val col = COLORS[ch] ?: continue
      paint.color = if (ch == 'Z') Color.parseColor("#d8d8d8") else col
      paint.alpha = (alpha.coerceIn(0f, 1f) * 255f).toInt()
      c.drawRect(i * size, j * size, (i + 1) * size, (j + 1) * size, paint)
    }
    c.restore()
  }

  private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

  private fun drawEffects(c: Canvas, now: Long, top: Float) {
    val g = px * 0.8f
    for (e in fx) {
      val t = (now - e.born) / (if (e.kind == KIND_BANG) 800f else 1000f)
      if (t < 0f || t > 1f) continue
      val o = bezier(Ease.OUT, t)
      when (e.kind) {
        KIND_NOTE -> {
          val x = e.dx * k + (if (e.variant == 1) 8f else -8f) * k * o
          val a = if (t < 0.5f) 1f else 1f - (t - 0.5f) * 2f
          glyph(c, NOTES[e.variant], x, top - 22f * k * o, g, a, lerp(0.6f, 1f, o), (if (e.variant == 1) 15f else -15f) * o)
        }
        KIND_BANG -> {
          val y = sample(f(-2f, -8f, -8f), null, t, Ease.OUT) * k
          val a = sample(f(0f, 1f, 0f), null, t, Ease.OUT)
          glyph(c, BANG, 0f, top + y, g, a, sample(f(0.6f, 1.2f, 1f), null, t, Ease.OUT))
        }
        else -> {
          val x = e.dx * k + ((e.id % 3) - 1) * 4f * k * o
          glyph(c, HEART, x, top - 22f * k * o, g, 1f - o, lerp(0.6f, 1f, o))
        }
      }
    }
    // The done burst: sparkles flying out from the middle.
    if (burstAt != 0L && mood == Mood.DONE) {
      for ((i, s) in SPARKS.withIndex()) {
        val t = (now - burstAt - 100 - i * 30) / 750f
        if (t < 0f || t > 1f) continue
        val o = bezier(Ease.OUT, t)
        glyph(c, STAR, s[0] * px * o, top + SPRITE_H / 2f * px + s[1] * px * o, g, sample(f(0f, 1f, 0f), null, t, Ease.OUT), sample(f(0.4f, 1.3f, 0.6f), null, t, Ease.OUT), 90f * o)
      }
    }
    // Twinkles while polishing.
    if (mood == Mood.POLISHING) {
      for ((i, s) in TWINKLES.withIndex()) {
        val cyc = (now - moodSince - i * 400L)
        if (cyc < 0) continue
        val t = (cyc % 1500) / 1200f
        if (t > 1f) continue
        glyph(c, STAR, s[0] * px, top + SPRITE_H / 3f * px + s[1] * px, px * 0.7f, sample(f(0f, 1f, 0f), null, t, Ease.IN_OUT), sample(f(0f, 1.2f, 0f), null, t, Ease.IN_OUT), 90f * t)
      }
    }
    // Sleeping z's.
    if (sleeping) {
      for (i in 0..2) {
        val cyc = now - lastActive - i * 800L
        if (cyc < 0) continue
        val t = (cyc % 2400) / 2400f
        val ez = bezier(Ease.OUT, t)
        glyph(c, ZED, SPRITE_W / 2f * px - 3f * px + 10f * k * ez, top - 4f * k - 20f * k * ez, px * 0.75f, sample(f(0f, 1f, 0f), null, t, Ease.OUT), sample(f(0.6f, 1f, 1.2f), null, t, Ease.OUT))
      }
    }
  }

  private companion object {
    const val SPRITE_W = 16
    const val SPRITE_H = 11
    const val SLEEP_AFTER = 45_000L
    const val KIND_NOTE = 0
    const val KIND_BANG = 1
    const val KIND_HEART = 2
    const val KIND_Z = 3
    const val LAPTOP_Y = 7

    val BODY = listOf(
      "...SSSSSSSSSS...",
      "..SsSSSNNSSSsS..",
      ".SSSsSSNNSSsSSS.",
      ".RRRRRRNNRRRRRR.",
      "rRRRRRRNNRRRRRRr",
      "rRRRRRRNNRRRRRRr",
      "rRRRRRRNNRRRRRRr",
      "rRPRRRRNNRRRRPRr",
      ".rRRRRRNNRRRRRr.",
      "..rrrrrrrrrrrr..",
    )
    val LEGS = listOf("....LL......LL..", "...L..L....L..L.")
    val EYES = listOf(3, 11)
    val LAPTOP = listOf("...KKKKKKKKKK...", "...KkkkOOkkkK...", "...KkkkkkkkkK...", "..BBBBBBBBBBBB..")
    val HAND_X = listOf(1, 14)
    val HAND_FRAMES = listOf(listOf(2, 1), listOf(1, 2))
    val HEART = listOf("HH.HH", "HHHHH", ".HHH.", "..H..")
    val STAR = listOf(".Y.", "YYY", ".Y.")
    val ZED = listOf("ZZZ", ".Z.", "ZZZ")
    val BANG = listOf("X", "X", "X", ".", "X")
    val NOTES = listOf(listOf("..MM", "..M.", "..M.", "MMM.", "MMM."), listOf("mmmmm", "m...m", "m...m", "mm.mm", "mm.mm"))
    val SPARKS = listOf(intArrayOf(-11, -8), intArrayOf(11, -9), intArrayOf(-13, 1), intArrayOf(13, 0), intArrayOf(0, -14), intArrayOf(-6, -13), intArrayOf(6, -13))
    val TWINKLES = listOf(intArrayOf(-9, -2), intArrayOf(10, -6), intArrayOf(2, -11))

    /** x, y, w, h of a 6×6 lens around each eye. */
    val LENSES = EYES.map { intArrayOf(it - 2, 3, 6, 6) }

    /** Glasses frame as x, y, width runs: the lens outlines, the bridge and a stub of each arm. */
    val FRAME: List<IntArray> = buildList {
      for (l in LENSES) {
        add(intArrayOf(l[0], l[1], l[2]))
        add(intArrayOf(l[0], l[1] + l[3] - 1, l[2]))
        for (y in l[1] + 1 until l[1] + l[3] - 1) {
          add(intArrayOf(l[0], y, 1))
          add(intArrayOf(l[0] + l[2] - 1, y, 1))
        }
      }
      val a = LENSES[0]
      val b = LENSES[1]
      add(intArrayOf(a[0] + a[2], a[1] + 1, b[0] - a[0] - a[2]))
      add(intArrayOf(a[0] - 1, a[1] + 1, 1))
      add(intArrayOf(b[0] + b[2], b[1] + 1, 1))
    }

    val COLORS: Map<Char, Int> = mapOf(
      'S' to "#f0533f", 's' to "#ff8f73", 'N' to "#0f5e5c", 'R' to "#fff8ee", 'r' to "#e3d1b8",
      'E' to "#2b2b2b", 'P' to "#f7a39b", 'L' to "#3d3d3d", 'K' to "#c9ced6", 'k' to "#aeb5bf",
      'O' to "#f0533f", 'B' to "#7d8590", 'H' to "#f0533f", 'Y' to "#f6c945", 'G' to "#2b2b2b",
      'X' to "#f6c945", 'M' to "#ff8f73", 'm' to "#5fd3b3", 'D' to "#7cc7ff", 'Z' to "#ffffff",
    ).mapValues { Color.parseColor(it.value) }
  }
}
