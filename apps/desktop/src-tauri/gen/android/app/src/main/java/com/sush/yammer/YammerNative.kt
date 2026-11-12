package com.sush.yammer

/** Calls into Rust (`src/android/mod.rs`). Works from the service with the activity gone. */
object YammerNative {
  init {
    System.loadLibrary("yammer_lib")
  }

  /** Runs the recording through the pipeline. Blocks until done; returns JSON with a `kind`. */
  external fun process(pcm: ShortArray, rate: Int): String

  external fun recording(on: Boolean)

  external fun level(rms: Float)

  /** Hands a meeting's audio over as it's heard. False once the meeting has stopped. */
  external fun meetingAudio(pcm: ShortArray, rate: Int): Boolean

  /** Stops the meeting in progress, if there is one. Returns at once; the transcript finishes in the background. */
  external fun meetingStop()

  /** The key for the API keys file ([Vault]). */
  external fun unlock(key: ByteArray)
}
