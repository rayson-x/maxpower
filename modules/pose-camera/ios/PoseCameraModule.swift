import AVFoundation
import ExpoModulesCore
import UIKit

/**
 * iOS Adapter for the same frozen YOLOX + RTMPose Halpe-26 observation stack
 * used by Web and Android. It passes every person candidate to Rust; Swift
 * never chooses a subject, repairs points, or derives phase/rep truth.
 */
public final class PoseCameraView: ExpoView,
  AVCaptureFileOutputRecordingDelegate,
  AVCaptureVideoDataOutputSampleBufferDelegate {
  public let onPose = EventDispatcher()
  public let onVideo = EventDispatcher()

  private let modelName = "yolox-nano-humanart+rtmpose-m-halpe26"
  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "com.maxpower.pose-camera.session")
  private let inferenceQueue = DispatchQueue(label: "com.maxpower.pose-camera.inference")
  private let replayQueue = DispatchQueue(label: "com.maxpower.pose-camera.replay")
  private let movieOutput = AVCaptureMovieFileOutput()
  private let frameOutput = AVCaptureVideoDataOutput()
  private let motionBridge = MPMotionBridge()
  private var posePipeline: MPRtmposePipeline?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var playerLayer: AVPlayerLayer?
  private var player: AVPlayer?
  private var replayVideoOutput: AVPlayerItemVideoOutput?
  private var replayTimer: DispatchSourceTimer?
  private var playbackEndObserver: NSObjectProtocol?
  private var replayGeneration: UInt64 = 0
  private var replayPaused = false
  private var configured = false
  private var recordingRequested = false
  private var lensFacing: AVCaptureDevice.Position = .front
  private var outputURL: URL?
  private var recognitionProfileJSON: String?
  private var recognitionActive = false
  private var nativeRecognitionActive = false
  private var rustConfigured = false
  private var configuredWidth = 0
  private var configuredHeight = 0
  private var processedFrames: Int64 = 0
  private var validFrames: Int64 = 0
  private var metricsStartedAtMs: Double = 0
  private var processedFps: Double = 0
  private var averageInferenceMs: Double = 0
  private var averageEquipmentMs: Double = 0
  private var averageRustMs: Double = 0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    layer.addSublayer(preview)
    previewLayer = preview
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return }
    sessionQueue.async { [weak self] in self?.configureAndStartIfAllowed() }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
    playerLayer?.frame = bounds
  }

  deinit {
    stopReplay()
    sessionQueue.sync {
      if movieOutput.isRecording {
        movieOutput.stopRecording()
      }
      session.stopRunning()
    }
    inferenceQueue.sync {
      posePipeline?.resetTracking()
      motionBridge.close()
    }
  }

  func setLensFacing(_ value: String) {
    let next: AVCaptureDevice.Position = value == "back" ? .back : .front
    guard next != lensFacing else { return }
    lensFacing = next
    let shouldReconfigure = configured || recordingRequested
    sessionQueue.async { [weak self] in
      guard let self else { return }
      guard shouldReconfigure else { return }
      if self.movieOutput.isRecording {
        self.movieOutput.stopRecording()
      }
      self.session.inputs.forEach { self.session.removeInput($0) }
      self.configured = false
      self.inferenceQueue.async {
        self.posePipeline?.resetTracking()
      }
      self.configureAndStartIfAllowed()
    }
  }

  func setRecognitionActive(_ active: Bool) {
    guard active != recognitionActive else { return }
    recognitionActive = active
    inferenceQueue.async { [weak self] in
      guard let self else { return }
      if self.rustConfigured, self.nativeRecognitionActive != active {
        let status = self.motionBridge.setActive(active)
        guard status == 0 else {
          self.emitPoseError("rust-set", status: status)
          return
        }
        self.nativeRecognitionActive = active
      }
      if active {
        self.processedFrames = 0
        self.validFrames = 0
        self.metricsStartedAtMs = 0
        self.processedFps = 0
        self.averageInferenceMs = 0
        self.averageEquipmentMs = 0
        self.averageRustMs = 0
      }
    }
  }

  func setModel(_ value: String) {}

  func setRecognitionProfile(_ value: String?) {
    guard value != recognitionProfileJSON else { return }
    recognitionProfileJSON = value
    inferenceQueue.async { [weak self] in
      guard let self, self.rustConfigured else { return }
      let wasActive = self.nativeRecognitionActive
      if wasActive, self.motionBridge.setActive(false) != 0 {
        self.emitPoseError("rust-profile-pause", status: -1)
        return
      }
      self.nativeRecognitionActive = false
      let status = self.motionBridge.setProfileJSON(value)
      guard status == 0 else {
        self.emitPoseError("rust-profile", status: status)
        return
      }
      if wasActive {
        let resumeStatus = self.motionBridge.setActive(true)
        guard resumeStatus == 0 else {
          self.emitPoseError("rust-profile-resume", status: resumeStatus)
          return
        }
        self.nativeRecognitionActive = true
      }
    }
  }

  func setVideoRecording(_ active: Bool) {
    guard active != recordingRequested else { return }
    recordingRequested = active
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if active {
        self.configureAndStartIfAllowed()
      } else if self.movieOutput.isRecording {
        self.movieOutput.stopRecording()
      }
    }
  }

  func setReplayPath(_ value: String?) {
    guard let value, !value.isEmpty else {
      stopReplay()
      return
    }
    startReplay(value)
  }

  func setReplayPaused(_ value: Bool) {
    replayPaused = value
    if value {
      player?.pause()
    } else {
      player?.play()
    }
  }

  private func configureAndStartIfAllowed() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      configureIfNeeded()
      if !session.isRunning { session.startRunning() }
      if recordingRequested { beginRecordingIfPossible() }
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        guard let self else { return }
        self.sessionQueue.async {
          if granted {
            self.configureAndStartIfAllowed()
          } else {
            self.emitVideoError("camera_permission_denied")
          }
        }
      }
    default:
      emitVideoError("camera_permission_denied")
    }
  }

  private func configureIfNeeded() {
    guard !configured else { return }
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .hd1280x720
    session.inputs.forEach { session.removeInput($0) }
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: lensFacing) else {
      emitVideoError("camera_unavailable")
      return
    }
    do {
      let input = try AVCaptureDeviceInput(device: device)
      guard session.canAddInput(input) else {
        emitVideoError("camera_input_unavailable")
        return
      }
      session.addInput(input)
      if !session.outputs.contains(where: { $0 === movieOutput }) {
        guard session.canAddOutput(movieOutput) else {
          emitVideoError("video_output_unavailable")
          return
        }
        session.addOutput(movieOutput)
      }
      if !session.outputs.contains(where: { $0 === frameOutput }) {
        guard session.canAddOutput(frameOutput) else {
          emitVideoError("analysis_output_unavailable")
          return
        }
        frameOutput.videoSettings = [
          kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        frameOutput.alwaysDiscardsLateVideoFrames = true
        frameOutput.setSampleBufferDelegate(self, queue: inferenceQueue)
        session.addOutput(frameOutput)
      }
      if let connection = frameOutput.connection(with: .video) {
        if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
        if connection.isVideoMirroringSupported { connection.isVideoMirrored = false }
      }
      if let previewConnection = previewLayer?.connection,
         previewConnection.isVideoMirroringSupported {
        previewConnection.automaticallyAdjustsVideoMirroring = false
        previewConnection.isVideoMirrored = lensFacing == .front
      }
      configured = true
    } catch {
      emitVideoError("camera_configuration_failed")
    }
  }

  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard player == nil, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let sourceTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let timestampMs = max(0, Int64((CMTimeGetSeconds(sourceTime) * 1_000).rounded()))
    processPixelBuffer(pixelBuffer, timestampMs: timestampMs, replayDurationMs: nil)
  }

  /**
   * Camera and replay share this exact observation path. The Adapter emits raw
   * Halpe-26 candidates; only Rust owns subject selection, continuity and reps.
   * Must run on inferenceQueue because both native components are stateful.
   */
  private func processPixelBuffer(
    _ pixelBuffer: CVPixelBuffer,
    timestampMs: Int64,
    replayDurationMs: Double?
  ) {
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    do {
      let startedAt = CACurrentMediaTime() * 1_000
      let pipeline = try ensurePosePipeline()
      let candidates = try pipeline.estimatePixelBuffer(pixelBuffer, timestampMs: timestampMs)
      let inferenceMs = CACurrentMediaTime() * 1_000 - startedAt
      let equipmentStartedAt = CACurrentMediaTime() * 1_000
      let visualFrame = barbellAxisVisionEnabled
        ? visualEquipmentLumaFrame(pixelBuffer)
        : nil
      let equipmentMs = CACurrentMediaTime() * 1_000 - equipmentStartedAt
      if !rustConfigured || configuredWidth != width || configuredHeight != height {
        let status = motionBridge.configureWidth(
          UInt32(width),
          height: UInt32(height),
          profileJSON: recognitionProfileJSON,
          active: recognitionActive,
          canonicalFeedMirroring: replayDurationMs == nil ? 0 : 2
        )
        guard status == 0 else {
          emitPoseError("rust-configure", status: status)
          return
        }
        rustConfigured = true
        configuredWidth = width
        configuredHeight = height
        nativeRecognitionActive = recognitionActive
      }
      let rustStartedAt = CACurrentMediaTime() * 1_000
      guard let packet = motionBridge.processObservations(
        candidates,
        equipmentObservations: [],
        visualLuma: visualFrame?.luma,
        visualWidth: UInt32(visualFrame?.width ?? 0),
        visualHeight: UInt32(visualFrame?.height ?? 0),
        timestampMs: timestampMs
      ) else {
        emitPoseError("rust-process", status: -1)
        return
      }
      let rustMs = CACurrentMediaTime() * 1_000 - rustStartedAt
      processedFrames += 1
      if motionBridge.isCurrentFrameValid() { validFrames += 1 }
      let now = CACurrentMediaTime() * 1_000
      let metricsClock = replayDurationMs == nil ? now : Double(timestampMs)
      if processedFrames == 1 { metricsStartedAtMs = metricsClock }
      let elapsed = max(1, metricsClock - metricsStartedAtMs)
      processedFps = Double(processedFrames) * 1_000 / elapsed
      averageInferenceMs = rollingAverage(averageInferenceMs, inferenceMs, processedFrames)
      averageEquipmentMs = rollingAverage(averageEquipmentMs, equipmentMs, processedFrames)
      averageRustMs = rollingAverage(averageRustMs, rustMs, processedFrames)
      let payload: [String: Any] = [
        "width": width,
        "height": height,
        "timestampMs": Double(timestampMs),
        "model": modelName,
        "poseSchema": "halpe26",
        "previewMirrored": replayDurationMs == nil && lensFacing == .front,
        "packetBase64": packet.base64EncodedString(),
        "processedFrames": Double(processedFrames),
        "validFrames": Double(validFrames),
        "processedFps": processedFps,
        "delegate": "CPU",
        "preprocessMs": 0,
        "previewMs": 0,
        "inferenceMs": averageInferenceMs,
        "equipmentInferenceMs": averageEquipmentMs,
        "rustMs": averageRustMs,
        "droppedFrames": NSNull(),
        "maxBacklogFrames": 1
      ]
      var event = payload
      if let replayDurationMs {
        event["replayPositionMs"] = Double(timestampMs)
        event["replayDurationMs"] = replayDurationMs
      }
      DispatchQueue.main.async { [weak self] in self?.onPose(event) }
    } catch {
      emitPoseError("rtmpose-inference", message: error.localizedDescription)
    }
  }

  private var barbellAxisVisionEnabled: Bool {
    guard let recognitionProfileJSON,
          let data = recognitionProfileJSON.data(using: .utf8),
          let profile = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return false
    }
    return profile["equipmentVision"] as? String == "barbell_axis"
  }

  /** Platform-only BGRA → downscaled luma transport for the shared Rust detector. */
  private func visualEquipmentLumaFrame(
    _ pixelBuffer: CVPixelBuffer,
    maximumDimension: Int = 480
  ) -> VisualEquipmentLumaFrame? {
    guard maximumDimension >= 8,
          CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA else {
      return nil
    }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let longest = max(width, height)
    let scale = longest > maximumDimension ? Double(maximumDimension) / Double(longest) : 1
    let outputWidth = max(8, Int((Double(width) * scale).rounded()))
    let outputHeight = max(8, Int((Double(height) * scale).rounded()))
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
    let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    var luma = [UInt8](repeating: 0, count: outputWidth * outputHeight)
    for outputY in 0..<outputHeight {
      let sourceY = min(height - 1, outputY * height / outputHeight)
      for outputX in 0..<outputWidth {
        let sourceX = min(width - 1, outputX * width / outputWidth)
        let offset = sourceY * bytesPerRow + sourceX * 4
        let blue = Int(bytes[offset])
        let green = Int(bytes[offset + 1])
        let red = Int(bytes[offset + 2])
        luma[outputY * outputWidth + outputX] = UInt8(
          (77 * red + 150 * green + 29 * blue + 128) >> 8
        )
      }
    }
    return VisualEquipmentLumaFrame(
      width: outputWidth,
      height: outputHeight,
      luma: Data(luma)
    )
  }

  private func ensurePosePipeline() throws -> MPRtmposePipeline {
    if let posePipeline { return posePipeline }
    guard let detector = bundledModelPath("yolox-nano-humanart-416x416"),
          let pose = bundledModelPath("rtmpose-m-halpe26-256x192") else {
      throw PosePipelineException("bundled_pose_model_missing")
    }
    let pipeline = try MPRtmposePipeline(
      detectorModelPath: detector,
      poseModelPath: pose
    )
    posePipeline = pipeline
    return pipeline
  }

  private func bundledModelPath(_ name: String) -> String? {
    let bundles = [Bundle(for: PoseCameraView.self), Bundle.main]
    for bundle in bundles {
      if let path = bundle.path(forResource: name, ofType: "onnx") { return path }
    }
    return nil
  }

  private func beginRecordingIfPossible() {
    guard recordingRequested, !movieOutput.isRecording else { return }
    guard let directory = localMoviesDirectory() else {
      emitVideoError("video_directory_unavailable")
      return
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd_HHmmss"
    let filename = "maxpower_\(formatter.string(from: Date()))_\(UUID().uuidString.prefix(8)).mp4"
    let url = directory.appendingPathComponent(filename)
    try? FileManager.default.removeItem(at: url)
    outputURL = url
    movieOutput.startRecording(to: url, recordingDelegate: self)
  }

  public func fileOutput(
    _ output: AVCaptureFileOutput,
    didFinishRecordingTo outputFileURL: URL,
    from connections: [AVCaptureConnection],
    error: Error?
  ) {
    let completedURL = outputURL ?? outputFileURL
    outputURL = nil
    guard error == nil else {
      try? FileManager.default.removeItem(at: completedURL)
      emitVideoError("video_recording_failed")
      return
    }
    let values = try? completedURL.resourceValues(forKeys: [.fileSizeKey])
    let asset = AVURLAsset(url: completedURL)
    let durationMs = CMTimeGetSeconds(asset.duration) * 1_000
    DispatchQueue.main.async { [weak self] in
      self?.onVideo([
        "status": "saved",
        "path": completedURL.path,
        "uri": completedURL.absoluteString,
        "fileName": completedURL.lastPathComponent,
        "durationMs": durationMs.isFinite ? durationMs : 0,
        "bytes": values?.fileSize ?? 0
      ])
    }
    sessionQueue.async { [weak self] in
      guard let self, self.recordingRequested else { return }
      self.beginRecordingIfPossible()
    }
  }

  private func localMoviesDirectory() -> URL? {
    maxPowerMoviesDirectory(create: true)
  }

  private func startReplay(_ path: String) {
    stopReplay()
    recordingRequested = false
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if self.movieOutput.isRecording { self.movieOutput.stopRecording() }
      if self.session.isRunning { self.session.stopRunning() }
    }
    let url = URL(fileURLWithPath: path)
    guard FileManager.default.fileExists(atPath: url.path) else {
      onPose(["error": "replay_video_missing", "model": modelName, "poseSchema": "halpe26"])
      return
    }
    let asset = AVURLAsset(url: url)
    let durationMs = CMTimeGetSeconds(asset.duration) * 1_000
    guard durationMs.isFinite, durationMs > 0,
          let track = asset.tracks(withMediaType: .video).first else {
      onPose(["error": "replay_video_unreadable", "model": modelName, "poseSchema": "halpe26"])
      return
    }
    let item = AVPlayerItem(asset: asset)
    if let composition = orientedVideoComposition(track: track, duration: asset.duration) {
      item.videoComposition = composition
    }
    let videoOutput = AVPlayerItemVideoOutput(pixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ])
    item.add(videoOutput)
    let nextPlayer = AVPlayer(playerItem: item)
    let nextLayer = AVPlayerLayer(player: nextPlayer)
    nextLayer.videoGravity = .resizeAspect
    nextLayer.frame = bounds
    layer.addSublayer(nextLayer)
    previewLayer?.isHidden = true
    player = nextPlayer
    playerLayer = nextLayer
    replayVideoOutput = videoOutput
    replayPaused = false
    replayGeneration &+= 1
    let generation = replayGeneration
    playbackEndObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak self] _ in
      self?.finishReplay(generation: generation, durationMs: durationMs)
    }
    onPose([
      "replayPositionMs": 0,
      "replayDurationMs": durationMs.isFinite ? durationMs : 0,
      "model": modelName,
      "poseSchema": "halpe26"
    ])
    inferenceQueue.async { [weak self, weak nextPlayer] in
      guard let self, let nextPlayer, self.replayGeneration == generation else { return }
      self.posePipeline?.resetTracking()
      self.resetNativePipeline()
      self.startReplayTimer(
        player: nextPlayer,
        output: videoOutput,
        generation: generation,
        durationMs: durationMs
      )
      DispatchQueue.main.async {
        guard self.replayGeneration == generation, !self.replayPaused else { return }
        nextPlayer.play()
      }
    }
  }

  private func stopReplay() {
    let wasReplaying = player != nil || replayTimer != nil || replayVideoOutput != nil
    replayGeneration &+= 1
    replayTimer?.setEventHandler {}
    replayTimer?.cancel()
    replayTimer = nil
    if let observer = playbackEndObserver {
      NotificationCenter.default.removeObserver(observer)
      playbackEndObserver = nil
    }
    player?.pause()
    player = nil
    replayVideoOutput = nil
    replayPaused = false
    playerLayer?.removeFromSuperlayer()
    playerLayer = nil
    previewLayer?.isHidden = false
    guard wasReplaying else { return }
    inferenceQueue.async { [weak self] in
      guard let self else { return }
      self.posePipeline?.resetTracking()
      self.resetNativePipeline()
    }
    sessionQueue.async { [weak self] in
      guard let self else { return }
      self.configureAndStartIfAllowed()
    }
  }

  /**
   * Poll the exact AVPlayer presentation timeline. If inference is slower than
   * playback, AVPlayerItemVideoOutput returns the newest displayed frame, so
   * skeleton timestamps cannot drift behind the visible video.
   */
  private func startReplayTimer(
    player: AVPlayer,
    output: AVPlayerItemVideoOutput,
    generation: UInt64,
    durationMs: Double
  ) {
    let timer = DispatchSource.makeTimerSource(queue: replayQueue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(16), leeway: .milliseconds(2))
    timer.setEventHandler { [weak self, weak player] in
      guard let self, let player,
            self.replayGeneration == generation,
            !self.replayPaused else { return }
      let itemTime = player.currentTime()
      guard output.hasNewPixelBuffer(forItemTime: itemTime),
            let pixelBuffer = output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil) else {
        return
      }
      let seconds = CMTimeGetSeconds(itemTime)
      guard seconds.isFinite else { return }
      let timestampMs = max(0, Int64((seconds * 1_000).rounded()))
      self.inferenceQueue.sync {
        guard self.replayGeneration == generation else { return }
        self.processPixelBuffer(
          pixelBuffer,
          timestampMs: timestampMs,
          replayDurationMs: durationMs
        )
      }
    }
    replayTimer = timer
    timer.resume()
  }

  private func finishReplay(generation: UInt64, durationMs: Double) {
    guard replayGeneration == generation else { return }
    replayTimer?.setEventHandler {}
    replayTimer?.cancel()
    replayTimer = nil
    inferenceQueue.async { [weak self] in
      guard let self, self.replayGeneration == generation else { return }
      let payload: [String: Any] = [
        "width": 0,
        "height": 0,
        "timestampMs": durationMs,
        "model": self.modelName,
        "poseSchema": "halpe26",
        "previewMirrored": false,
        "processedFrames": Double(self.processedFrames),
        "validFrames": Double(self.validFrames),
        "processedFps": self.processedFps,
        "delegate": "CPU",
        "preprocessMs": 0,
        "previewMs": 0,
        "inferenceMs": self.averageInferenceMs,
        "equipmentInferenceMs": self.averageEquipmentMs,
        "rustMs": self.averageRustMs,
        "replayEnded": true,
        "replayPositionMs": durationMs,
        "replayDurationMs": durationMs
      ]
      DispatchQueue.main.async { [weak self] in self?.onPose(payload) }
    }
  }

  private func resetNativePipeline() {
    if rustConfigured { motionBridge.close() }
    rustConfigured = false
    nativeRecognitionActive = false
    configuredWidth = 0
    configuredHeight = 0
    processedFrames = 0
    validFrames = 0
    metricsStartedAtMs = 0
    processedFps = 0
    averageInferenceMs = 0
    averageEquipmentMs = 0
    averageRustMs = 0
  }

  private func orientedVideoComposition(
    track: AVAssetTrack,
    duration: CMTime
  ) -> AVMutableVideoComposition? {
    let sourceRect = CGRect(origin: .zero, size: track.naturalSize)
    let transformedRect = sourceRect.applying(track.preferredTransform)
    let renderSize = CGSize(width: abs(transformedRect.width), height: abs(transformedRect.height))
    guard renderSize.width > 0, renderSize.height > 0 else { return nil }
    let composition = AVMutableVideoComposition()
    composition.renderSize = renderSize
    composition.frameDuration = CMTime(value: 1, timescale: 30)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    let normalizedTransform = track.preferredTransform.concatenating(
      CGAffineTransform(translationX: -transformedRect.minX, y: -transformedRect.minY)
    )
    layerInstruction.setTransform(normalizedTransform, at: .zero)
    instruction.layerInstructions = [layerInstruction]
    composition.instructions = [instruction]
    return composition
  }

  private func emitVideoError(_ code: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onVideo(["status": "error", "error": code])
    }
  }

  private func emitPoseError(_ stage: String, status: Int32) {
    emitPoseError(stage, message: "native status \(status)")
  }

  private func emitPoseError(_ stage: String, message: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onPose([
        "error": "\(stage): \(message)",
        "model": self?.modelName ?? "yolox-nano-humanart+rtmpose-m-halpe26",
        "poseSchema": "halpe26"
      ])
    }
  }
}

private struct VisualEquipmentLumaFrame {
  let width: Int
  let height: Int
  let luma: Data
}

private struct PosePipelineException: LocalizedError {
  let code: String
  init(_ code: String) { self.code = code }
  var errorDescription: String? { code }
}

private func rollingAverage(_ current: Double, _ sample: Double, _ count: Int64) -> Double {
  guard count > 1 else { return sample }
  return current + (sample - current) / Double(count)
}

public class PoseCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PoseCamera")

    AsyncFunction("runtimeHealth") { () -> [String: Any] in
      let contractMajor = MPMotionBridge.runtimeContractMajor()
      let runtimeReady = contractMajor > 0
      let canonicalBridgeReady = runtimeReady && contractMajor == 1
      return [
        "canonicalBridgeReady": canonicalBridgeReady,
        "runtimeReady": runtimeReady,
        "reason": canonicalBridgeReady
          ? "ready"
          : runtimeReady ? "unsupported_packet_contract" : "native_runtime_unavailable",
      ]
    }

    AsyncFunction("listReplayVideos") { () -> [String] in
      guard let directory = maxPowerMoviesDirectory(create: false) else { return [] }
      let entries = (try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles]
      )) ?? []
      return entries
        .filter { $0.pathExtension.lowercased() == "mp4" || $0.pathExtension.lowercased() == "mov" }
        .sorted {
          let left = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
          let right = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
          return left > right
        }
        .map(\.path)
    }

    /**
     * Restrict deletion to a direct child of MaxPower's app-private Movies
     * directory. JS receives no general file deletion capability.
     */
    AsyncFunction("deleteReplayVideo") { (path: String) -> String in
      guard let directory = maxPowerMoviesDirectory(create: false) else { return "not_found" }
      let root = directory.resolvingSymlinksInPath().standardizedFileURL
      let candidate = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
      let extensionName = candidate.pathExtension.lowercased()
      guard candidate.deletingLastPathComponent().path == root.path,
            extensionName == "mp4" || extensionName == "mov" else {
        throw InvalidReplayVideoPathException()
      }
      guard FileManager.default.fileExists(atPath: candidate.path) else { return "not_found" }
      do {
        try FileManager.default.removeItem(at: candidate)
        return "deleted"
      } catch {
        throw ReplayVideoDeleteFailedException()
      }
    }

    View(PoseCameraView.self) {
      Events("onPose", "onVideo")
      Prop("model") { (view: PoseCameraView, value: String) in view.setModel(value) }
      Prop("recognitionProfile") { (view: PoseCameraView, value: String?) in view.setRecognitionProfile(value) }
      Prop("lensFacing") { (view: PoseCameraView, value: String) in view.setLensFacing(value) }
      Prop("recognitionActive") { (view: PoseCameraView, value: Bool) in view.setRecognitionActive(value) }
      Prop("videoRecording") { (view: PoseCameraView, value: Bool) in view.setVideoRecording(value) }
      Prop("replayPath") { (view: PoseCameraView, value: String?) in view.setReplayPath(value) }
      Prop("replayPaused") { (view: PoseCameraView, value: Bool) in view.setReplayPaused(value) }
    }
  }
}

private final class InvalidReplayVideoPathException: Exception, @unchecked Sendable {
  override var reason: String { "invalid_replay_video_path" }
}

private final class ReplayVideoDeleteFailedException: Exception, @unchecked Sendable {
  override var reason: String { "replay_video_delete_failed" }
}

private func maxPowerMoviesDirectory(create: Bool) -> URL? {
  let root = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask).first
    ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
  guard let root else { return nil }
  let directory = root.appendingPathComponent("MaxPower", isDirectory: true)
  guard create else { return directory }
  do {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  } catch {
    return nil
  }
}
