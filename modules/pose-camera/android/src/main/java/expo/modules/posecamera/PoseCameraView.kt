package expo.modules.posecamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import android.os.Environment
import android.util.Base64
import android.util.Size
import android.view.TextureView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.Date
import java.util.Locale
import java.util.UUID

class PoseCameraView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  val onPose by EventDispatcher()
  val onVideo by EventDispatcher()

  private val textureView = TextureView(context)
  private val analysisExecutor = Executors.newSingleThreadExecutor()

  private var cameraProvider: ProcessCameraProvider? = null
  private var posePipeline: RtmposePipeline? = null
  private val modelName: String = RtmposePipeline.MODEL_NAME
  @Volatile private var recognitionProfile: NativeRecognitionProfile = NativeRecognitionProfile.None
  @Volatile private var lensFacing: String = "front"
  @Volatile private var recognitionActive = false
  private var rustConfigured = false
  private var configuredProfileKey: String? = null
  private var nativeRecognitionActive = false
  private var metricsCollecting = false
  private var processedFrames = 0L
  private var validFrames = 0L
  private var metricsStartedAtMs = 0L
  private var processedFps = 0.0
  private var activeDelegate = "CPU"
  private var averagePreprocessMs = 0.0
  private var averagePreviewMs = 0.0
  private var averageInferenceMs = 0.0
  private var averageEquipmentMs = 0.0
  private var averageRustMs = 0.0
  private var bound = false
  private var pendingBind = false
  private var videoCapture: VideoCapture<Recorder>? = null
  private var activeVideoRecording: Recording? = null
  private var activeVideoFile: File? = null
  @Volatile private var videoRecordingRequested = false

  // ---- 视频回放识别 ----
  // 回放与相机互斥：抽帧线程只负责 MediaMetadataRetriever 抽帧 + 节奏控制，
  // 推理与 Rust 调用一律提交到 analysisExecutor（与相机同一单线程纪律，不并发）。
  @Volatile private var replayMode = false
  @Volatile private var replayStopRequested = false
  @Volatile private var replayPaused = false
  private var replayThread: Thread? = null
  private var replayingPath: String? = null

  init {
    // 预览不走独立 Preview use case：
    // PreviewView 子视图在 RN 树里布局为 0x0（configure 超时黑屏），
    // 自管 TextureView 的旋转矩阵又和分析坐标系对不齐。
    // 改为只绑 ImageAnalysis，把旋转好的 upright 分析帧逐帧画到 TextureView——
    // 预览画面与分析帧是同一张图，骨架/预览/坐标系天然一致。
    addView(textureView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    ProcessCameraProvider.getInstance(context).also { future ->
      future.addListener({
        cameraProvider = future.get()
        requestBindCamera()
      }, ContextCompat.getMainExecutor(context))
    }
  }

  /** 把 upright 分析帧画到 TextureView：FIT_CENTER 留黑边（与 TS 骨架映射同公式），前置镜像。 */
  private fun drawPreviewFrame(bitmap: Bitmap, mirrored: Boolean) {
    if (!textureView.isAvailable) return
    val canvas = textureView.lockCanvas() ?: return
    try {
      val viewW = canvas.width.toFloat()
      val viewH = canvas.height.toFloat()
      // 与 TS 侧 mapping 一致：min 缩放 + 居中（上下/左右留黑）
      val scale = minOf(viewW / bitmap.width, viewH / bitmap.height)
      val drawW = bitmap.width * scale
      val drawH = bitmap.height * scale
      val left = (viewW - drawW) / 2f
      val top = (viewH - drawH) / 2f
      canvas.drawColor(android.graphics.Color.BLACK)
      if (mirrored) {
        canvas.save()
        canvas.scale(-1f, 1f, viewW / 2f, viewH / 2f)
      }
      canvas.drawBitmap(
        bitmap,
        Rect(0, 0, bitmap.width, bitmap.height),
        RectF(left, top, left + drawW, top + drawH),
        null
      )
      if (mirrored) canvas.restore()
    } finally {
      textureView.unlockCanvasAndPost(canvas)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    maybeBindAfterLayout()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    maybeBindAfterLayout()
  }

  /**
   * CameraX 的 Preview surface 依赖 SurfaceView 完成 attach + layout；
   * 构造期就 bind 会让 capture session 永远等不到 surface（configure 超时、黑屏）。
   * 所以 bind 延迟到视图真正挂载且尺寸非零之后。
   */
  private fun requestBindCamera() {
    if (isAttachedToWindow && width > 0 && height > 0) {
      post { bindCamera() }
    } else {
      pendingBind = true
    }
  }

  private fun maybeBindAfterLayout() {
    if (!pendingBind || width == 0 || height == 0) return
    pendingBind = false
    post { bindCamera() }
  }

  fun setModel(name: String) {
    // Legacy prop retained while callers migrate from lite/full/heavy. The
    // Android production Adapter is now the single frozen RTMPose-m model.
  }

  fun setLensFacing(facing: String) {
    val normalized = if (facing == "back") "back" else "front"
    if (normalized == lensFacing) return
    lensFacing = normalized
    if (bound) {
      // Finalize the current segment before rebinding. Keep the request true:
      // the finalize callback starts a new local segment on the new lens while
      // the shared set/session and recognition projection stay alive in JS.
      stopVideoRecording()
      videoCapture = null
      cameraProvider?.unbindAll()
      bound = false
      bindCamera()
    }
  }

  fun setRecognitionProfile(profileJson: String?) {
    val next = try {
      NativeRecognitionProfile.parse(profileJson)
    } catch (error: Exception) {
      emitError("rust-profile-envelope", error)
      NativeRecognitionProfile.None
    }
    if (next.key == recognitionProfile.key) return
    recognitionProfile = next
    analysisExecutor.execute {
      if (rustConfigured && configuredProfileKey != next.key) {
        val wasActive = nativeRecognitionActive
        if (wasActive && MotionNative.nativeSetActive(false) != 0) {
          emitError("rust-profile", IllegalStateException("could not pause active set"))
          return@execute
        }
        nativeRecognitionActive = false
        val status = installNativeProfile(next)
        if (status != 0) {
          emitError("rust-profile", IllegalStateException("profile rejected ($status)"))
          return@execute
        }
        configuredProfileKey = next.key
        if (wasActive) {
          if (MotionNative.nativeSetActive(true) != 0) {
            emitError("rust-profile", IllegalStateException("could not resume active set"))
            return@execute
          }
          nativeRecognitionActive = true
        }
      }
    }
  }

  /** Clears the previous rep engine, then installs exactly one selected profile. */
  private fun installNativeProfile(profile: NativeRecognitionProfile): Int {
    val selectStatus = MotionNative.nativeSetProfile(profile.profileCode)
    if (selectStatus != 0) return selectStatus
    return if (profile is NativeRecognitionProfile.Data) {
      MotionNative.nativeInstallProfile(profile.identity, profile.abiArguments)
    } else 0
  }

  fun setRecognitionActive(active: Boolean) {
    if (active == recognitionActive) return
    recognitionActive = active
    analysisExecutor.execute {
      if (rustConfigured && nativeRecognitionActive != active) {
        if (MotionNative.nativeSetActive(active) != 0) {
          emitError("rust-set", IllegalStateException("set lifecycle rejected"))
          return@execute
        }
        nativeRecognitionActive = active
      }
      metricsCollecting = active
      if (active) {
        processedFrames = 0
        validFrames = 0
        metricsStartedAtMs = 0
        processedFps = 0.0
        resetPerformanceBreakdown()
      }
    }
  }

  /**
   * Video is an explicit, local-only companion artifact. It is never sent to
   * the pose pipeline or an LLM; the user can later replay this MP4 from the
   * app-private Movies directory.
   */
  fun setVideoRecording(active: Boolean) {
    if (active == videoRecordingRequested) return
    videoRecordingRequested = active
    post {
      if (active) startVideoRecording() else stopVideoRecording()
    }
  }

  private fun createPosePipeline(): RtmposePipeline? {
    return try {
      RtmposePipeline(context).also { activeDelegate = "CPU" }
    } catch (error: Exception) {
      activeDelegate = "unavailable"
      emitError("rtmpose-init", error)
      null
    }
  }

  private fun bindCamera() {
    val provider = cameraProvider ?: return
    if (bound || replayMode) return
    val lifecycleOwner = (appContext.currentActivity as? LifecycleOwner) ?: return

    analysisExecutor.execute {
      if (posePipeline == null) posePipeline = createPosePipeline()
    }

    val analysis = ImageAnalysis.Builder()
      .setResolutionSelector(resolutionSelector())
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .build()

    analysis.setAnalyzer(analysisExecutor) { imageProxy ->
      try {
        if (posePipeline != null) {
          val preprocessStartedAt = SystemClock.elapsedRealtimeNanos()
          var bitmap = imageProxy.toBitmap()
          val rotation = imageProxy.imageInfo.rotationDegrees
          if (rotation != 0) {
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
          }
          val preprocessMs = elapsedMs(preprocessStartedAt)
          processUprightFrame(bitmap, SystemClock.uptimeMillis(), null, preprocessMs)
        }
      } catch (error: Exception) {
        emitError("inference", error)
      } finally {
        imageProxy.close()
      }
    }

    val recorder = Recorder.Builder()
      .setQualitySelector(QualitySelector.from(Quality.HD))
      .build()
    val video = VideoCapture.withOutput(recorder)
    try {
      provider.unbindAll()
      provider.bindToLifecycle(
        lifecycleOwner,
        cameraSelector(),
        analysis,
        video
      )
      bound = true
      videoCapture = video
      if (videoRecordingRequested) startVideoRecording()
    } catch (error: Exception) {
      videoCapture = null
      emitError("bind", error)
      if (videoRecordingRequested) {
        onVideo(mapOf("status" to "error", "error" to "video_capture_bind_failed"))
      }
    }
  }

  private fun startVideoRecording() {
    if (!videoRecordingRequested || replayMode || activeVideoRecording != null) return
    // Recording can be requested before CameraX finishes binding. `bindCamera`
    // retries this method after installing VideoCapture; only an actual bind
    // failure emits a terminal error event.
    val capture = videoCapture ?: return
    // Keep videos directly under the app-private Movies directory: the replay
    // library scans this same directory and can discover completed recordings
    // without asking Android's shared-media/Gallery permission.
    val directory = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
    if (directory == null || (!directory.exists() && !directory.mkdirs())) {
      onVideo(mapOf("status" to "error", "error" to "video_directory_unavailable"))
      return
    }
    val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
    val file = File(directory, "maxpower_${stamp}_${UUID.randomUUID().toString().take(8)}.mp4")
    activeVideoFile = file
    val output = FileOutputOptions.Builder(file).build()
    try {
      activeVideoRecording = capture.output
        .prepareRecording(context, output)
        .start(ContextCompat.getMainExecutor(context)) { event ->
          if (event is VideoRecordEvent.Finalize) {
            activeVideoRecording = null
            val finalized = activeVideoFile
            activeVideoFile = null
            if (event.hasError()) {
              finalized?.delete()
              onVideo(mapOf(
                "status" to "error",
                "error" to "video_recording_failed:${event.error}"
              ))
            } else if (finalized != null) {
              onVideo(mapOf(
                "status" to "saved",
                "path" to finalized.absolutePath,
                "uri" to Uri.fromFile(finalized).toString(),
                "fileName" to finalized.name,
                "durationMs" to event.recordingStats.recordedDurationNanos.div(1_000_000L).toDouble(),
                "bytes" to event.recordingStats.numBytesRecorded.toDouble()
              ))
            }
            if (videoRecordingRequested) post { startVideoRecording() }
          }
        }
    } catch (_: Exception) {
      activeVideoFile = null
      file.delete()
      onVideo(mapOf("status" to "error", "error" to "video_recording_start_failed"))
    }
  }

  private fun stopVideoRecording() {
    activeVideoRecording?.stop()
  }

  /**
   * 相机/回放共用的逐帧管线：预览绘制 → YOLOX + RTMPose → Rust → onPose。
   * 必须在 analysisExecutor 上调用（Adapter 与 MotionNative 均非线程安全）。
   * replayDurationMs 非空表示回放帧：时间戳为视频时间 ms，预览不镜像。
   */
  private fun processUprightFrame(
    bitmap: Bitmap,
    timestampMs: Long,
    replayDurationMs: Long?,
    preprocessMs: Double = 0.0
  ) {
    val current = posePipeline ?: return
    val isReplay = replayDurationMs != null
    val previewStartedAt = SystemClock.elapsedRealtimeNanos()
    drawPreviewFrame(bitmap, !isReplay && lensFacing == "front")
    val previewMs = elapsedMs(previewStartedAt)
    val inferenceStartedAt = SystemClock.elapsedRealtimeNanos()
    val candidates = current.estimate(bitmap, timestampMs)
    val inferenceMs = elapsedMs(inferenceStartedAt)
    val equipmentStartedAt = SystemClock.elapsedRealtimeNanos()
    val visualFrame = if (recognitionProfile.equipmentVision == NativeEquipmentVision.BarbellAxis) {
      bitmap.visualEquipmentLumaFrame()
    } else null
    val equipmentMs = elapsedMs(equipmentStartedAt)
    val orientedWidth = bitmap.width
    val orientedHeight = bitmap.height
    val landmarks = candidates.firstOrNull()?.landmarks?.map(DoubleArray::toList) ?: emptyList()
    if (!rustConfigured) {
      val desiredProfile = recognitionProfile
      val desiredRecognitionActive = recognitionActive
      val status = MotionNative.nativeConfigure(
        orientedWidth,
        orientedHeight,
        desiredProfile.profileCode,
        1,
        false
      )
      if (status != 0) throw IllegalStateException("Rust configure failed ($status)")
      if (desiredProfile is NativeRecognitionProfile.Data) {
        val installStatus = MotionNative.nativeInstallProfile(
          desiredProfile.identity,
          desiredProfile.abiArguments
        )
        if (installStatus != 0) {
          throw IllegalStateException("Rust profile install failed ($installStatus)")
        }
      }
      if (desiredRecognitionActive && MotionNative.nativeSetActive(true) != 0) {
        throw IllegalStateException("Rust set start failed")
      }
      rustConfigured = true
      configuredProfileKey = desiredProfile.key
      nativeRecognitionActive = desiredRecognitionActive
      metricsCollecting = desiredRecognitionActive
      processedFrames = 0
      validFrames = 0
      processedFps = 0.0
      metricsStartedAtMs = if (metricsCollecting) timestampMs else 0
    }
    val candidateIds = LongArray(candidates.size)
    val candidateMetadata = DoubleArray(candidates.size * 7)
    val flatLandmarks = DoubleArray(candidates.size * RtmposePipeline.HALPE_KEYPOINT_COUNT * 4)
    candidates.forEachIndexed { candidateIndex, candidate ->
      require(candidate.landmarks.size == RtmposePipeline.HALPE_KEYPOINT_COUNT) {
        "RTMPose candidate must contain Halpe-26"
      }
      candidateIds[candidateIndex] = candidate.candidateId
      val metadataOffset = candidateIndex * 7
      candidate.bbox.copyInto(candidateMetadata, metadataOffset)
      candidate.torsoColor.copyInto(candidateMetadata, metadataOffset + 4)
      candidate.landmarks.forEachIndexed { landmarkIndex, values ->
        values.copyInto(
          flatLandmarks,
          (candidateIndex * RtmposePipeline.HALPE_KEYPOINT_COUNT + landmarkIndex) * 4,
        )
      }
    }
    val rustStartedAt = SystemClock.elapsedRealtimeNanos()
    val packet = MotionNative.processObservations(
      timestampMs,
      candidateIds,
      candidateMetadata,
      flatLandmarks,
      RtmposePipeline.HALPE_KEYPOINT_COUNT,
      visualLuma = visualFrame?.luma,
      visualWidth = visualFrame?.width ?: 0,
      visualHeight = visualFrame?.height ?: 0,
    )
    val barbellAxis = MotionNative.visualBarbellAxis()
    val rustMs = elapsedMs(rustStartedAt)
    if (packet == null) {
      emitError("rust-frame", IllegalStateException("canonical packet unavailable"))
      return
    }
    if (metricsCollecting) {
      if (metricsStartedAtMs == 0L) metricsStartedAtMs = timestampMs
      processedFrames += 1
      if (MotionNative.nativeIsCurrentFrameValid()) validFrames += 1
      val elapsedMs = timestampMs - metricsStartedAtMs
      if (processedFrames > 1 && elapsedMs > 0) {
        processedFps = (processedFrames - 1) * 1000.0 / elapsedMs.toDouble()
      }
    }
    averagePreprocessMs = smoothed(averagePreprocessMs, preprocessMs)
    averagePreviewMs = smoothed(averagePreviewMs, previewMs)
    averageInferenceMs = smoothed(averageInferenceMs, inferenceMs)
    averageEquipmentMs = smoothed(averageEquipmentMs, equipmentMs)
    averageRustMs = smoothed(averageRustMs, rustMs)
    val payload = mutableMapOf<String, Any>(
      "landmarks" to landmarks,
      "width" to orientedWidth,
      "height" to orientedHeight,
      "timestampMs" to timestampMs.toDouble(),
      "model" to modelName,
      "poseSchema" to RtmposePipeline.POSE_SCHEMA,
      "previewMirrored" to (!isReplay && lensFacing == "front"),
      "processedFrames" to processedFrames.toDouble(),
      "validFrames" to validFrames.toDouble(),
      "processedFps" to processedFps,
      "delegate" to activeDelegate,
      "preprocessMs" to averagePreprocessMs,
      "previewMs" to averagePreviewMs,
      "inferenceMs" to averageInferenceMs,
      "equipmentInferenceMs" to averageEquipmentMs,
      "rustMs" to averageRustMs,
      "maxBacklogFrames" to 1.0
    )
    if (barbellAxis != null) {
      payload["equipmentAxis"] = mapOf(
        "kind" to "barbell_shaft",
        "source" to barbellAxis.source,
        "confidence" to barbellAxis.confidence,
        "x1" to barbellAxis.x1,
        "y1" to barbellAxis.y1,
        "x2" to barbellAxis.x2,
        "y2" to barbellAxis.y2,
        "centerY" to barbellAxis.centerY,
        "submittedToRust" to barbellAxis.submittedToRust,
      )
    }
    if (isReplay) {
      payload["replayPositionMs"] = timestampMs.toDouble()
      payload["replayDurationMs"] = replayDurationMs.toDouble()
    }
    payload["packetBase64"] = Base64.encodeToString(packet, Base64.NO_WRAP)
    onPose(payload)
  }

  // ---- 视频回放识别 ----

  /** prop replayPath：非空开始回放（重复路径忽略），null/空停止并恢复相机。 */
  fun setReplayPath(path: String?) {
    if (path.isNullOrEmpty()) {
      stopReplay()
      return
    }
    if (path == replayingPath) return
    startReplay(path)
  }

  fun setReplayPaused(paused: Boolean) {
    replayPaused = paused
  }

  fun startReplay(path: String) {
    videoRecordingRequested = false
    stopVideoRecording()
    stopReplay()
    replayMode = true
    replayStopRequested = false
    replayPaused = false
    replayingPath = path
    // 回放与相机互斥：解绑 CameraX，停止后经 requestBindCamera 恢复
    post {
      cameraProvider?.unbindAll()
      bound = false
      videoCapture = null
    }
    analysisExecutor.execute {
      posePipeline?.resetTracking()
      // 视频分辨率未必与相机帧一致，Rust 侧按回放首帧尺寸重新 configure
      resetNativePipeline()
    }
    val thread = Thread({ runReplayLoop(path) }, "pose-replay")
    replayThread = thread
    thread.start()
  }

  fun stopReplay() {
    val thread = replayThread
    replayStopRequested = true
    replayPaused = false
    thread?.interrupt()
    replayThread = null
    replayingPath = null
    if (!replayMode) return
    replayMode = false
    analysisExecutor.execute {
      // 相机时间轴与视频时间轴互不兼容，清空候选身份并重建 Rust 会话。
      posePipeline?.resetTracking()
      resetNativePipeline()
    }
    requestBindCamera()
  }

  /** 复位 Rust 会话状态（需在 analysisExecutor 上调用）。 */
  private fun resetNativePipeline() {
    if (rustConfigured) MotionNative.nativeClose()
    rustConfigured = false
    configuredProfileKey = null
    nativeRecognitionActive = false
    metricsCollecting = false
    processedFrames = 0
    validFrames = 0
    metricsStartedAtMs = 0
    processedFps = 0.0
    resetPerformanceBreakdown()
  }

  /**
   * 抽帧循环（独立线程）：按 ~33ms 视频时间步进抽关键帧，
   * 旋转 upright 后提交 analysisExecutor 走与相机完全相同的管线，
   * 并等待该帧推理完成再抽下一帧（严格串行，不堆积）。
   */
  private fun runReplayLoop(path: String) {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(path)
      val durationMs = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val rotation = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (durationMs <= 0) throw IllegalStateException("duration unavailable")
      val durationUs = durationMs * 1000L
      val stepUs = 33_000L
      var videoTimeUs = 0L
      var wallStartMs = SystemClock.uptimeMillis()
      var pauseStartedAtMs = 0L
      while (!replayStopRequested && videoTimeUs <= durationUs) {
        if (replayPaused) {
          // 暂停：视频时间不动，恢复时把墙钟基准平移暂停时长
          if (pauseStartedAtMs == 0L) pauseStartedAtMs = SystemClock.uptimeMillis()
          Thread.sleep(30)
          continue
        }
        if (pauseStartedAtMs != 0L) {
          wallStartMs += SystemClock.uptimeMillis() - pauseStartedAtMs
          pauseStartedAtMs = 0L
        }
        val raw = retriever.getFrameAtTime(videoTimeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        val videoMs = videoTimeUs / 1000L
        if (raw != null) {
          val upright = if (rotation != 0) {
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
          } else raw
          val latch = CountDownLatch(1)
          analysisExecutor.execute {
            try {
              processUprightFrame(upright, videoMs, durationMs)
            } catch (error: Exception) {
              emitError("replay-frame", error)
            } finally {
              latch.countDown()
            }
          }
          latch.await()
        }
        videoTimeUs += stepUs
        // 实时节奏：墙钟对齐视频时间；处理慢了自然掉节奏，不追赶
        val delayMs = wallStartMs + videoTimeUs / 1000L - SystemClock.uptimeMillis()
        if (delayMs > 0) Thread.sleep(delayMs)
      }
      if (!replayStopRequested) emitReplayEnded(durationMs)
    } catch (error: Exception) {
      if (!replayStopRequested) emitError("replay", error)
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
      }
    }
  }

  /** 自然播完：发 replayEnded 事件（携带最终统计，TS 侧据此出组后报告）。 */
  private fun emitReplayEnded(durationMs: Long) {
    onPose(
      mapOf(
        "landmarks" to emptyList<List<Double>>(),
        "width" to 0,
        "height" to 0,
        "timestampMs" to durationMs.toDouble(),
        "model" to modelName,
        "poseSchema" to RtmposePipeline.POSE_SCHEMA,
        "previewMirrored" to false,
        "processedFrames" to processedFrames.toDouble(),
        "validFrames" to validFrames.toDouble(),
        "processedFps" to processedFps,
        "delegate" to activeDelegate,
        "preprocessMs" to averagePreprocessMs,
        "previewMs" to averagePreviewMs,
        "inferenceMs" to averageInferenceMs,
        "rustMs" to averageRustMs,
        "replayEnded" to true,
        "replayPositionMs" to durationMs.toDouble(),
        "replayDurationMs" to durationMs.toDouble()
      )
    )
  }

  private fun cameraSelector(): CameraSelector =
    if (lensFacing == "back") CameraSelector.DEFAULT_BACK_CAMERA
    else CameraSelector.DEFAULT_FRONT_CAMERA

  /**
   * 显式 VGA 分析帧：YOLOX 416 与 RTMPose 256x192 不需要 720p 输入；
   * 降低 RGBA 转换、旋转复制与绘制成本，同时保留独立 HD 录像。
   * ColorOS（OnePlus Ace 2）上默认分辨率组合会让
   * createCaptureSession 挂起超时（黑屏 + 0 FPS），限定分辨率后恢复。
   */
  private fun resolutionSelector(): ResolutionSelector =
    ResolutionSelector.Builder()
      .setResolutionStrategy(
        ResolutionStrategy(
          Size(640, 480),
          ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
        )
      )
      .build()

  private fun emitError(stage: String, error: Exception) {
    onPose(mapOf("error" to "$stage: ${error.message}", "model" to modelName))
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stopReplay()
    cameraProvider?.unbindAll()
    bound = false
    videoRecordingRequested = false
    stopVideoRecording()
    videoCapture = null
    analysisExecutor.execute {
      posePipeline?.close()
      posePipeline = null
      if (rustConfigured) MotionNative.nativeClose()
      rustConfigured = false
      configuredProfileKey = null
      nativeRecognitionActive = false
      metricsCollecting = false
      processedFrames = 0
      validFrames = 0
      metricsStartedAtMs = 0
      processedFps = 0.0
      resetPerformanceBreakdown()
    }
  }

  private fun resetPerformanceBreakdown() {
    averagePreprocessMs = 0.0
    averagePreviewMs = 0.0
    averageInferenceMs = 0.0
    averageEquipmentMs = 0.0
    averageRustMs = 0.0
  }

  private fun smoothed(previous: Double, sample: Double): Double =
    if (previous == 0.0) sample else previous * 0.9 + sample * 0.1

  private fun elapsedMs(startedAtNanos: Long): Double =
    (SystemClock.elapsedRealtimeNanos() - startedAtNanos) / 1_000_000.0
}

private sealed class NativeRecognitionProfile(
  val key: String,
  val profileCode: Int,
  val equipmentVision: NativeEquipmentVision,
) {
  data object None : NativeRecognitionProfile("none", 0, NativeEquipmentVision.Off)

  class BuiltIn(code: Int, equipmentVision: NativeEquipmentVision) :
    NativeRecognitionProfile("built-in:$code:$equipmentVision", code, equipmentVision)

  class Data(
    val identity: String,
    val abiArguments: DoubleArray,
    equipmentVision: NativeEquipmentVision,
  ) : NativeRecognitionProfile(
    "data:$identity:${abiArguments[0]}:${abiArguments[1]}:$equipmentVision",
    0,
    equipmentVision,
  )

  companion object {
    private const val SCHEMA = "maxpower-native-recognition-profile/v1"
    private const val ABI_ARGUMENT_COUNT = 24

    fun parse(json: String?): NativeRecognitionProfile {
      if (json.isNullOrBlank()) return None
      val envelope = JSONObject(json)
      require(envelope.getString("schemaVersion") == SCHEMA) {
        "unsupported recognition profile schema"
      }
      val equipmentVision = NativeEquipmentVision.parse(envelope.optString("equipmentVision", "off"))
      return when (envelope.getString("mode")) {
        "none" -> None
        "built_in" -> {
          val code = envelope.getInt("profileCode")
          require(code in 1..8 || code in 101..108) { "invalid built-in profile code" }
          BuiltIn(code, equipmentVision)
        }
        "data" -> {
          val identity = envelope.getString("identity")
          require(identity.isNotBlank() && identity.toByteArray(Charsets.UTF_8).size <= 512) {
            "invalid profile identity"
          }
          val encoded = envelope.getJSONArray("abiArguments")
          require(encoded.length() == ABI_ARGUMENT_COUNT) { "invalid profile ABI argument count" }
          val arguments = DoubleArray(ABI_ARGUMENT_COUNT) { index ->
            encoded.getDouble(index).also { require(it.isFinite()) { "non-finite profile argument" } }
          }
          Data(identity, arguments, equipmentVision)
        }
        else -> throw IllegalArgumentException("unsupported recognition profile mode")
      }
    }
  }
}

private enum class NativeEquipmentVision {
  Off,
  BarbellAxis;

  companion object {
    fun parse(value: String): NativeEquipmentVision = when (value) {
      "off" -> Off
      "barbell_axis" -> BarbellAxis
      else -> throw IllegalArgumentException("unsupported equipment vision mode")
    }
  }
}
