package com.sush.yammer

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlin.math.sqrt

/** One recording: mono 16-bit PCM at 16 kHz, read on its own thread until [stop]. */
class Recorder(private val onLevel: (Float) -> Unit) {
  private var record: AudioRecord? = null
  private var thread: Thread? = null
  private var samples = ShortArray(RATE * 30)
  private var size = 0

  @Volatile
  private var active = false

  /** Throws if the microphone can't be opened (no permission, or in use by a call). */
  fun start() {
    val rec = openMic()
    record = rec
    active = true
    thread = Thread({ read(rec) }, "yammer-recorder").also { it.start() }
  }

  private fun read(rec: AudioRecord) {
    val chunk = ShortArray(RATE / 10)
    while (active) {
      val n = rec.read(chunk, 0, chunk.size)
      if (n <= 0) continue
      if (size + n > MAX_SAMPLES) {
        onLevel(0f)
        continue
      }
      if (size + n > samples.size) samples = samples.copyOf(minOf(samples.size * 2, MAX_SAMPLES))
      System.arraycopy(chunk, 0, samples, size, n)
      size += n
      var sum = 0.0
      for (i in 0 until n) {
        val v = chunk[i] / 32768.0
        sum += v * v
      }
      onLevel(sqrt(sum / n).toFloat())
    }
  }

  /** Stops and returns everything recorded. */
  fun stop(): ShortArray {
    active = false
    thread?.join(1000)
    record?.let {
      runCatching { it.stop() }
      it.release()
    }
    record = null
    return samples.copyOf(size)
  }

  companion object {
    const val RATE = 16_000
    /** Ten minutes, as on desktop. */
    const val MAX_SAMPLES = RATE * 600

    /** Opens and starts the microphone at [RATE], or throws saying why it couldn't. */
    @SuppressLint("MissingPermission") // The service checks before starting.
    fun openMic(): AudioRecord {
      val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val rec = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(min, RATE / 2),
      )
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        rec.release()
        throw IllegalStateException("Couldn't open the microphone.")
      }
      rec.startRecording()
      if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
        rec.release()
        throw IllegalStateException("The microphone is in use by another app.")
      }
      return rec
    }
  }
}

/**
 * A meeting's microphone: hands each tenth of a second to Rust as it's heard, rather than keeping it,
 * so it can run for hours. Rust answers false once the meeting has stopped, and then this stops too,
 * calling [onEnd] on its own thread.
 */
class LiveRecorder(private val onLevel: (Float) -> Unit, private val onEnd: () -> Unit) {
  private var thread: Thread? = null

  @Volatile
  private var active = false

  /** Throws if the microphone can't be opened. */
  fun start() {
    val rec = Recorder.openMic()
    active = true
    thread = Thread({ read(rec) }, "yammer-meeting").also { it.start() }
  }

  private fun read(rec: AudioRecord) {
    val chunk = ShortArray(Recorder.RATE / 10)
    // Rust said the meeting is over, rather than the microphone or the service going away.
    var over = false
    try {
      while (active) {
        val n = rec.read(chunk, 0, chunk.size)
        if (n < 0) break
        if (n == 0) continue
        if (!YammerNative.meetingAudio(if (n == chunk.size) chunk else chunk.copyOf(n), Recorder.RATE)) {
          over = true
          break
        }
        var sum = 0.0
        for (i in 0 until n) {
          val v = chunk[i] / 32768.0
          sum += v * v
        }
        onLevel(sqrt(sum / n).toFloat())
      }
    } finally {
      runCatching { rec.stop() }
      rec.release()
      onLevel(0f)
      // Lost the microphone, or the service is going, with the meeting still on: stop it, so what was heard is saved.
      if (!over) runCatching { YammerNative.meetingStop() }
      active = false
      onEnd()
    }
  }

  /** Stops without waiting for Rust: the service turning off. */
  fun stop() {
    active = false
    thread?.join(1000)
  }
}
