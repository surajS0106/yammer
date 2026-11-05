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
  @SuppressLint("MissingPermission") // The service checks before starting.
  fun start() {
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
  }
}
