package com.sush.yammer

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import org.json.JSONObject

/**
 * Keeps dictation available from any app: holds the Sushi bubble, records, and puts the text
 * where it goes. A microphone foreground service started while the app is on screen keeps
 * microphone access afterwards; Android 14+ wouldn't let one start from the background.
 * It's why turning Sushi on happens in the app, and why it's off again after a reboot.
 *
 * It also records meetings ([startMeeting]), which Rust transcribes as they go. The app's Meetings
 * page starts one, starting the service without Sushi if it was off ([forMeeting]); the notification
 * or the page stops it. Dictation waits while a meeting is on, since both would want the microphone.
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
  private var meeting: LiveRecorder? = null
  private var meetingStartedAt = 0L

  /** Started for a meeting with Sushi off: it goes again once the meeting ends, and Sushi stays hidden. */
  var onlyForMeeting = false
    private set

  /** `startForeground` has been called, so the microphone keeps working with the app gone. */
  private var foreground = false

  /** Sushi and a waveform in the status-bar island while listening. Main thread only. */
  private val island = Island()

  /** Dictating or in a meeting: the microphone is on. */
  private val listening: Boolean get() = phase == Phase.RECORDING || meeting != null

  /** Redraws the island while listening, and stops itself after. */
  private val islandFrame = object : Runnable {
    override fun run() {
      if (!listening) return
      island.step()
      updateNotification()
      main.postDelayed(this, ISLAND_FRAME_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    Vault.unlock(this)
    instance = this
    bubble = Bubble(this) { toggle() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()
    when (intent?.action) {
      ACTION_TOGGLE -> toggle()
      ACTION_STOP -> {
        // Turning Sushi off mid-meeting only hides it: the meeting carries on.
        if (meeting != null) {
          bubble?.hide()
          onlyForMeeting = true
          return START_NOT_STICKY
        }
        shutDown()
        return START_NOT_STICKY
      }
      ACTION_MEETING -> {
        if (bubble?.isShown != true) onlyForMeeting = true
        return START_NOT_STICKY
      }
      ACTION_MEETING_STOP -> {
        YammerNative.meetingStop()
        return START_NOT_STICKY
      }
    }
    onlyForMeeting = false
    if (bubble?.show() == true && meeting != null) bubble?.setLook(Bubble.Look.LISTENING)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    recorder?.stop()
    recorder = null
    // Its thread tells Rust to stop the meeting, so what was heard is saved.
    meeting?.stop()
    meeting = null
    bubble?.hide()
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun shutDown() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  fun toggle() {
    if (meeting != null) {
      bubble?.say("Transcribing a meeting. Stop it in Yammer or from the notification.", 4000)
      return
    }
    when (phase) {
      Phase.IDLE -> startRecording()
      Phase.RECORDING -> finishRecording()
      Phase.BUSY -> {}
    }
  }

  /** When the current recording began, for the live-update timer. */
  private var startedAt = 0L

  val isRecording: Boolean get() = phase == Phase.RECORDING

  val isIdle: Boolean get() = phase == Phase.IDLE

  val inMeeting: Boolean get() = meeting != null

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
    startedAt = System.currentTimeMillis()
    phase = Phase.RECORDING
    bubble?.setLook(Bubble.Look.LISTENING)
    bubble?.say("Listening… tap to finish")
    YammerNative.recording(true)
    main.postDelayed(capRecording, MAX_MS)
    updateNotification()
    startIsland()
  }

  /** Live updates, and so the island, arrived in Android 16. */
  private fun startIsland() {
    if (Build.VERSION.SDK_INT < 36) return
    island.clear()
    main.removeCallbacks(islandFrame)
    main.postDelayed(islandFrame, ISLAND_FRAME_MS)
  }

  /** Start recording a meeting for Rust. Null once it's listening, or why it couldn't. */
  fun startMeeting(): String? {
    if (meeting != null) return null
    if (phase != Phase.IDLE) return "Finish the dictation first."
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return "Allow the microphone first."
    val rec = LiveRecorder(::onMeetingLevel) { main.post(::meetingEnded) }
    try {
      rec.start()
    } catch (e: Exception) {
      return e.message ?: "Couldn't start recording."
    }
    meeting = rec
    meetingStartedAt = System.currentTimeMillis()
    bubble?.setLook(Bubble.Look.LISTENING)
    bubble?.say("Transcribing the meeting", 3000)
    updateNotification()
    startIsland()
    return null
  }

  private fun onMeetingLevel(rms: Float) {
    main.post {
      bubble?.setLevel(rms)
      island.hear(rms)
    }
  }

  private fun meetingEnded() {
    meeting = null
    bubble?.setLook(Bubble.Look.IDLE)
    bubble?.say("Meeting saved", 2500)
    if (onlyForMeeting && phase == Phase.IDLE) shutDown() else updateNotification()
  }

  private val capRecording = Runnable { if (phase == Phase.RECORDING) finishRecording() }

  /** On the recorder's thread, about ten times a second. */
  private fun onLevel(rms: Float) {
    main.post {
      bubble?.setLevel(rms)
      island.hear(rms)
    }
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
      bubble?.oops()
      return
    }
    when (json.getString("kind")) {
      "text" -> deliver(json.getString("text"), json.optString("warning").takeIf { !json.isNull("warning") })
      "failed" -> { bubble?.say(json.getString("error"), 6000); bubble?.oops() }
      else -> { bubble?.say("Didn't catch that", 2000); bubble?.oops() }
    }
  }

  /** Paste into the focused box, or leave it on the clipboard. It's in History either way. */
  private fun deliver(text: String, warning: String?) {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText("Yammer", text)
    // Kept out of the clipboard preview and keyboards' clipboard history.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
    }
    clipboard.setPrimaryClip(clip)
    // The clipboard has to reach the target app before it's asked to paste.
    // A cleanup that failed still pasted the raw text, but it fails every time until it's fixed, so it mustn't look like a success.
    if (warning != null) bubble?.oops() else bubble?.cheer()
    main.postDelayed({
      val pasted = runCatching { YammerAccessibility.paste() }.getOrDefault(false)
      when {
        warning != null -> bubble?.say(warning, 6000)
        pasted -> {
          bubble?.say(null)
          // Pasted, so it needn't stay on the clipboard; it's in History. Android won't let a background
          // app read the clipboard, so what was there before can't be put back as desktop does.
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) main.postDelayed({ runCatching { clipboard.clearPrimaryClip() } }, CLEAR_CLIPBOARD_MS)
        }
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
    foreground = true
  }

  private fun updateNotification() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
  }

  private fun notification(): Notification {
    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val self = { action: String, code: Int -> PendingIntent.getService(this, code, Intent(this, YammerService::class.java).setAction(action), flags) }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
    if (meeting != null) {
      val builder = Notification.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("Transcribing a meeting")
        .setContentText("Stop to save the transcript and write the notes.")
        .setContentIntent(open)
        .setOngoing(true)
        .setWhen(meetingStartedAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .addAction(Notification.Action.Builder(null, "Stop meeting", self(ACTION_MEETING_STOP, 3)).build())
      liveUpdate(builder, null)
      return builder.build()
    }
    val (title, verb) = when (phase) {
      Phase.IDLE -> "Sushi is ready" to "Dictate"
      Phase.RECORDING -> "Listening…" to "Finish"
      Phase.BUSY -> "Transcribing…" to "Dictate"
    }
    val builder = Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(if (phase == Phase.IDLE) "The microphone is only on while Sushi is listening." else "Tap Sushi again to finish.")
      .setContentIntent(open)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, verb, self(ACTION_TOGGLE, 1)).build())
      .addAction(Notification.Action.Builder(null, "Turn off", self(ACTION_STOP, 2)).build())
    if (phase == Phase.RECORDING) builder.setWhen(startedAt).setShowWhen(true).setUsesChronometer(true)
    if (phase != Phase.IDLE) liveUpdate(builder, if (phase == Phase.BUSY) "Typing" else null)
    return builder.build()
  }

  /**
   * Ask Android 16 to show this as a live update: the status-bar chip (OnePlus's island, Pixel's
   * "Now bar"). While listening, it's Sushi hopping with your voice beside a waveform, as a music
   * app shows what's playing; otherwise [text]. The notification is updated a few times a second
   * then ([islandFrame]), so it only alerts once.
   */
  private fun liveUpdate(builder: Notification.Builder, text: String?) {
    if (Build.VERSION.SDK_INT < 36) return
    // These are Notification.Builder.setRequestPromotedOngoing and setShortCriticalText, which
    // the SDK we compile against (36.0) doesn't have yet; the extras are what they set.
    val extras = Bundle().apply { putBoolean("android.requestPromotedOngoing", true) }
    if (listening) {
      builder.setSmallIcon(island.sushi()).setOnlyAlertOnce(true)
      extras.putString("android.shortCriticalText", island.waveform())
    } else if (text != null) {
      extras.putString("android.shortCriticalText", text)
    }
    builder.addExtras(extras)
  }

  companion object {
    private const val CHANNEL = "sushi"
    private const val NOTIFICATION = 1
    private const val ACTION_TOGGLE = "com.sush.yammer.TOGGLE"
    private const val ACTION_STOP = "com.sush.yammer.STOP"
    private const val ACTION_MEETING = "com.sush.yammer.MEETING"
    private const val ACTION_MEETING_STOP = "com.sush.yammer.MEETING_STOP"
    private const val MAX_MS = 600_000L
    private const val PASTE_DELAY_MS = 120L
    /** Long enough for the app pasted into to have read it. */
    private const val CLEAR_CLIPBOARD_MS = 1000L
    /** Under Android's limit of five notification updates a second, with room for the others. */
    private const val ISLAND_FRAME_MS = 300L

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

    /**
     * The service, once it's in the foreground, on the main thread: started without Sushi if it was off.
     * Null if it didn't come up. Must be called while the app is on screen, like [start].
     */
    fun forMeeting(context: Context, then: (YammerService?) -> Unit) {
      val main = Handler(Looper.getMainLooper())
      if (instance == null) context.startForegroundService(Intent(context, YammerService::class.java).setAction(ACTION_MEETING))
      val deadline = SystemClock.uptimeMillis() + 5000
      main.post(object : Runnable {
        override fun run() {
          val service = instance
          when {
            service != null && service.foreground -> then(service)
            SystemClock.uptimeMillis() > deadline -> then(null)
            else -> main.postDelayed(this, 50)
          }
        }
      })
    }

    fun stop(context: Context) {
      context.startService(Intent(context, YammerService::class.java).setAction(ACTION_STOP))
    }
  }
}
