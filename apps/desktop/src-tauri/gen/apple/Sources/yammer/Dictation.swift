import AVFoundation
import UIKit

/// Records and hands the audio to Rust, which transcribes it and puts the text on the clipboard.
/// iOS only lets a recording start from the foreground, and no app can float over or type into
/// another, so dictation starts in Yammer. `audio` in UIBackgroundModes keeps it going if you
/// switch apps part way through.
///
/// State lives on the main thread. One dictation at a time.
final class Dictation {
  static let shared = Dictation()

  private enum Phase { case idle, recording, busy }

  private static let maxSeconds = 600.0

  private var phase = Phase.idle
  private let engine = AVAudioEngine()
  private var rate = 0.0
  private var cap: DispatchWorkItem?
  private var backgroundTask = UIBackgroundTaskIdentifier.invalid
  /// Only touched on `queue`: the tap appends from the audio thread.
  private var samples: [Float] = []
  private let queue = DispatchQueue(label: "com.sush.yammer.samples")

  var isRecording: Bool { phase == .recording }

  private init() {
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
    // Headphones came or went, which stops the engine. Keep what was said so far.
    center.addObserver(self, selector: #selector(routeChanged), name: .AVAudioEngineConfigurationChange, object: engine)
  }

  func toggle() {
    switch phase {
    case .idle: start()
    case .recording: finish()
    case .busy: break
    }
  }

  private func start() {
    let session = AVAudioSession.sharedInstance()
    let input = engine.inputNode
    do {
      try session.setCategory(.record, mode: .default)
      try session.setActive(true)
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0 else { throw DictationError.noMicrophone }
      rate = format.sampleRate
      queue.sync { samples = [] }
      input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in self?.receive(buffer) }
      engine.prepare()
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      try? session.setActive(false)
      error.localizedDescription.withCString { yammer_ios_failed($0) }
      return
    }
    phase = .recording
    yammer_ios_recording(true)
    let cap = DispatchWorkItem { [weak self] in
      if self?.phase == .recording { self?.finish() }
    }
    self.cap = cap
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.maxSeconds, execute: cap)
  }

  /// The first channel is enough for speech.
  private func receive(_ buffer: AVAudioPCMBuffer) {
    guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
    let frames = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
    queue.async { self.samples.append(contentsOf: frames) }
    let sum = frames.reduce(Float(0)) { $0 + $1 * $1 }
    yammer_ios_level((sum / Float(frames.count)).squareRoot())
  }

  private func finish() {
    cap?.cancel()
    cap = nil
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    phase = .busy
    // Transcribing takes a network call, and you may have left the app by now.
    backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in self?.endBackgroundTask() }
    let rate = UInt32(self.rate)
    // After the tap's last append, since `queue` is serial.
    queue.async {
      let recorded = self.samples
      self.samples = []
      DispatchQueue.global(qos: .userInitiated).async {
        recorded.withUnsafeBufferPointer { yammer_ios_process($0.baseAddress, $0.count, rate) }
        DispatchQueue.main.async {
          self.phase = .idle
          self.endBackgroundTask()
        }
      }
    }
  }

  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  /// A phone call or Siri took the microphone.
  @objc private func interrupted(_ note: Notification) {
    guard
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      AVAudioSession.InterruptionType(rawValue: raw) == .began
    else { return }
    DispatchQueue.main.async {
      if self.phase == .recording { self.finish() }
    }
  }

  @objc private func routeChanged(_ note: Notification) {
    DispatchQueue.main.async {
      if self.phase == .recording { self.finish() }
    }
  }
}

private enum DictationError: LocalizedError {
  case noMicrophone
  var errorDescription: String? { "Couldn’t find a microphone." }
}

// MARK: - Called by src/ios/mod.rs, off the main thread

private func onMain<T>(_ work: () -> T) -> T {
  Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
}

private func windows() -> [UIWindow] {
  UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
}

/// Yammer's theme can differ from the phone's: match the status bar's icons to the page.
private func setStyle(_ style: UIUserInterfaceStyle) {
  windows().forEach { $0.overrideUserInterfaceStyle = style }
}

private func requestMic() {
  let session = AVAudioSession.sharedInstance()
  if session.recordPermission == .undetermined {
    session.requestRecordPermission { _ in }
  } else {
    openAppSettings()
  }
}

private func openAppSettings() {
  if let url = URL(string: UIApplication.openSettingsURLString) {
    UIApplication.shared.open(url)
  }
}

@_cdecl("yammer_swift_mic_allowed")
func yammerSwiftMicAllowed() -> Bool {
  AVAudioSession.sharedInstance().recordPermission == .granted
}

@_cdecl("yammer_swift_is_recording")
func yammerSwiftIsRecording() -> Bool {
  onMain { Dictation.shared.isRecording }
}

/// src/ios/mod.rs checks `action` against the same list.
@_cdecl("yammer_swift_action")
func yammerSwiftAction(_ action: UnsafePointer<CChar>) {
  let action = String(cString: action)
  DispatchQueue.main.async {
    switch action {
    case "requestMic": requestMic()
    case "openAppSettings": openAppSettings()
    case "toggle": Dictation.shared.toggle()
    case "barsLight": setStyle(.light)
    case "barsDark": setStyle(.dark)
    default: break
    }
  }
}

@_cdecl("yammer_swift_copy")
func yammerSwiftCopy(_ text: UnsafePointer<CChar>) {
  let text = String(cString: text)
  DispatchQueue.main.async { UIPasteboard.general.string = text }
}

/// Exports go through the share sheet. The file sits in the temporary folder until iOS clears it.
@_cdecl("yammer_swift_share")
func yammerSwiftShare(_ name: UnsafePointer<CChar>, _ contents: UnsafePointer<CChar>) {
  let name = (String(cString: name) as NSString).lastPathComponent
  let contents = String(cString: contents)
  DispatchQueue.main.async {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    do {
      try contents.write(to: file, atomically: true, encoding: .utf8)
    } catch {
      error.localizedDescription.withCString { yammer_ios_failed($0) }
      return
    }
    guard let window = windows().first(where: { $0.isKeyWindow }) ?? windows().first, var top = window.rootViewController else { return }
    while let shown = top.presentedViewController { top = shown }
    top.present(UIActivityViewController(activityItems: [file], applicationActivities: nil), animated: true)
  }
}
