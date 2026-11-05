package com.sush.yammer

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONObject

/**
 * Keeps dictation available from any app: holds the Sushi bubble, records, and puts the text
 * where it goes. A microphone foreground service started while the app is on screen keeps
 * microphone access afterwards; Android 14+ wouldn't let one start from the background.
 * It's why turning Sushi on happens in the app, and why it's off again after a reboot.
 *
 * State lives on the main thread. One dictation at a time.
 */
class YammerService : Service() {
  private enum class Phase { IDLE, RECORDING, BUSY }

  private val main = Handler(Looper.getMainLooper())
  private var phase = Phase.IDLE
  private var recorder: Recorder? = null
  private var bubble: Bubble? = null
  private var lastLevel = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    bubble = Bubble(this) { toggle() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()
    when (intent?.action) {
      ACTION_TOGGLE -> toggle()
      ACTION_STOP -> {
        shutDown()
        return START_NOT_STICKY
      }
    }
    bubble?.show()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    recorder?.stop()
    recorder = null
    bubble?.hide()
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun shutDown() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  fun toggle() {
    when (phase) {
      Phase.IDLE -> startRecording()
      Phase.RECORDING -> finishRecording()
      Phase.BUSY -> {}
    }
  }

  val isRecording: Boolean get() = phase == Phase.RECORDING

  val isIdle: Boolean get() = phase == Phase.IDLE

  private fun startRecording() {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      bubble?.say("Open Yammer and allow the microphone.", 4000)
      return
    }
    val rec = Recorder(::onLevel)
    try {
      rec.start()
    } catch (e: Exception) {
      bubble?.say(e.message ?: "Couldn't start recording.", 4000)
      return
    }
    recorder = rec
    phase = Phase.RECORDING
    bubble?.setLook(Bubble.Look.LISTENING)
    bubble?.say("Listening… tap to finish")
    YammerNative.recording(true)
    main.postDelayed(capRecording, MAX_MS)
    updateNotification()
  }

  private val capRecording = Runnable { if (phase == Phase.RECORDING) finishRecording() }

  /** On the recorder's thread, about ten times a second. */
  private fun onLevel(rms: Float) {
    main.post { bubble?.setLevel(rms) }
    YammerNative.level(rms)
  }

  private fun finishRecording() {
    main.removeCallbacks(capRecording)
    val rec = recorder ?: return
    recorder = null
    phase = Phase.BUSY
    bubble?.setLook(Bubble.Look.BUSY)
    bubble?.say("Transcribing…")
    updateNotification()
    Thread({
      val result = runCatching { YammerNative.process(rec.stop(), Recorder.RATE) }
      main.post { finished(result) }
    }, "yammer-process").start()
  }

  private fun finished(result: Result<String>) {
    phase = Phase.IDLE
    bubble?.setLook(Bubble.Look.IDLE)
    updateNotification()
    val json = result.map { JSONObject(it) }.getOrElse {
      bubble?.say(it.message ?: "Something went wrong.", 5000)
      return
    }
    when (json.getString("kind")) {
      "text" -> deliver(json.getString("text"), json.optString("warning").takeIf { !json.isNull("warning") })
      "failed" -> bubble?.say(json.getString("error"), 6000)
      else -> bubble?.say("Didn't catch that", 2000)
    }
  }

  /** Paste into the focused box, or leave it on the clipboard. It's in History either way. */
  private fun deliver(text: String, warning: String?) {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Yammer", text))
    // The clipboard has to reach the target app before it's asked to paste.
    main.postDelayed({
      val pasted = runCatching { YammerAccessibility.paste() }.getOrDefault(false)
      when {
        warning != null -> bubble?.say(warning, 5000)
        pasted -> bubble?.say(null)
        else -> bubble?.say("Copied. Long-press a text box to paste.", 3500)
      }
    }, PASTE_DELAY_MS)
  }

  private fun goForeground() {
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Sushi", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while Sushi is ready to take dictation"
      },
    )
    val notification = notification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION, notification)
    }
  }

  private fun updateNotification() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
  }

  private fun notification(): Notification {
    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val self = { action: String, code: Int -> PendingIntent.getService(this, code, Intent(this, YammerService::class.java).setAction(action), flags) }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
    val (title, verb) = when (phase) {
      Phase.IDLE -> "Sushi is ready" to "Dictate"
      Phase.RECORDING -> "Listening…" to "Finish"
      Phase.BUSY -> "Transcribing…" to "Dictate"
    }
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText("The microphone is only on while Sushi is listening.")
      .setContentIntent(open)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, verb, self(ACTION_TOGGLE, 1)).build())
      .addAction(Notification.Action.Builder(null, "Turn off", self(ACTION_STOP, 2)).build())
      .build()
  }

  companion object {
    private const val CHANNEL = "sushi"
    private const val NOTIFICATION = 1
    private const val ACTION_TOGGLE = "com.sush.yammer.TOGGLE"
    private const val ACTION_STOP = "com.sush.yammer.STOP"
    private const val MAX_MS = 600_000L
    private const val PASTE_DELAY_MS = 120L

    @Volatile
    var instance: YammerService? = null
      private set

    /** Must be called while the app is on screen, or Android refuses it the microphone. */
    fun start(context: Context) {
      context.startForegroundService(Intent(context, YammerService::class.java))
    }

    /** Start the service with a recording going: the in-app Dictate button with Sushi off. */
    fun startThenToggle(context: Context) {
      context.startForegroundService(Intent(context, YammerService::class.java).setAction(ACTION_TOGGLE))
    }

    fun stop(context: Context) {
      context.startService(Intent(context, YammerService::class.java).setAction(ACTION_STOP))
    }
  }
}
