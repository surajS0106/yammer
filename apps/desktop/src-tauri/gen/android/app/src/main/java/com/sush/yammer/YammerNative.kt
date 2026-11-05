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
}
