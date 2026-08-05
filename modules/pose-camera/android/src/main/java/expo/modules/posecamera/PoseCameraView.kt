package expo.modules.posecamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Base64
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors

class PoseCameraView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  val onPose by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    scaleType = PreviewView.ScaleType.FIT_CENTER
  }
  private val analysisExecutor = Executors.newSingleThreadExecutor()

  private var cameraProvider: ProcessCameraProvider? = null
  private var landmarker: PoseLandmarker? = null
  @Volatile private var modelName: String = "lite"
  @Volatile private var profileCode: Int = 5
  @Volatile private var recognitionActive = false
  private var rustConfigured = false
  private var configuredProfileCode: Int? = null
  private var nativeRecognitionActive = false
  private var metricsCollecting = false
  private var processedFrames = 0L
  private var validFrames = 0L
  private var metricsStartedAtMs = 0L
  private var processedFps = 0.0
  private var bound = false

  init {
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    ProcessCameraProvider.getInstance(context).also { future ->
      future.addListener({
        cameraProvider = future.get()
        bindCamera()
      }, ContextCompat.getMainExecutor(context))
    }
  }

  fun setModel(name: String) {
    if (name == modelName) return
    modelName = name
    analysisExecutor.execute {
      landmarker?.close()
      landmarker = null
      landmarker = createLandmarker()
    }
  }

  fun setExerciseId(exerciseId: String) {
    val nextCode = when (exerciseId) {
      "march_in_place" -> 5
      "side_step_touch" -> 6
      "alternating_knee_raise" -> 7
      "step_jack" -> 8
      else -> 0
    }
    if (nextCode == profileCode) return
    profileCode = nextCode
    analysisExecutor.execute {
      if (rustConfigured && configuredProfileCode != nextCode) {
        if (MotionNative.nativeSetProfile(nextCode) != 0) {
          emitError("rust-profile", IllegalStateException("profile rejected"))
        } else {
          configuredProfileCode = nextCode
        }
      }
    }
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
      }
    }
  }

  private fun createLandmarker(): PoseLandmarker? {
    val modelPath = "models/pose_landmarker_$modelName.task"
    fun options(delegate: Delegate) = PoseLandmarker.PoseLandmarkerOptions.builder()
      .setBaseOptions(
        BaseOptions.builder().setModelAssetPath(modelPath).setDelegate(delegate).build()
      )
      .setRunningMode(RunningMode.VIDEO)
      .setNumPoses(1)
      .build()
    return try {
      PoseLandmarker.createFromOptions(context, options(Delegate.GPU))
    } catch (gpuError: Exception) {
      try {
        PoseLandmarker.createFromOptions(context, options(Delegate.CPU))
      } catch (cpuError: Exception) {
        emitError("landmarker-init", cpuError)
        null
      }
    }
  }

  private fun bindCamera() {
    val provider = cameraProvider ?: return
    if (bound) return
    val lifecycleOwner = (appContext.currentActivity as? LifecycleOwner) ?: return
    bound = true

    analysisExecutor.execute {
      if (landmarker == null) landmarker = createLandmarker()
    }

    val preview = Preview.Builder().build().also {
      it.surfaceProvider = previewView.surfaceProvider
    }
    val analysis = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .build()

    analysis.setAnalyzer(analysisExecutor) { imageProxy ->
      try {
        val current = landmarker
        if (current != null) {
          var bitmap = imageProxy.toBitmap()
          val rotation = imageProxy.imageInfo.rotationDegrees
          if (rotation != 0) {
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
          }
          val timestampMs = SystemClock.uptimeMillis()
          val mpImage = BitmapImageBuilder(bitmap).build()
          val result = current.detectForVideo(mpImage, timestampMs)
          val first = result.landmarks().firstOrNull()
          val landmarks = first?.map { landmark ->
            listOf(
              landmark.x().toDouble(),
              landmark.y().toDouble(),
              landmark.z().toDouble(),
              landmark.visibility().orElse(0f).toDouble()
            )
          } ?: emptyList()
          if (!rustConfigured) {
            val desiredProfileCode = profileCode
            val desiredRecognitionActive = recognitionActive
            val status = MotionNative.nativeConfigure(
              bitmap.width,
              bitmap.height,
              desiredProfileCode,
              desiredRecognitionActive
            )
            if (status != 0) throw IllegalStateException("Rust configure failed ($status)")
            rustConfigured = true
            configuredProfileCode = desiredProfileCode
            nativeRecognitionActive = desiredRecognitionActive
            metricsCollecting = desiredRecognitionActive
            processedFrames = 0
            validFrames = 0
            processedFps = 0.0
            metricsStartedAtMs = if (metricsCollecting) timestampMs else 0
          }
          val flatLandmarks = DoubleArray(landmarks.size * 4)
          landmarks.forEachIndexed { index, values ->
            val offset = index * 4
            flatLandmarks[offset] = values[0]
            flatLandmarks[offset + 1] = values[1]
            flatLandmarks[offset + 2] = values[2]
            flatLandmarks[offset + 3] = values[3]
          }
          val packet = MotionNative.nativeProcessFrame(timestampMs, flatLandmarks)
          if (packet == null) {
            emitError("rust-frame", IllegalStateException("canonical packet unavailable"))
            return@setAnalyzer
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
          val payload = mutableMapOf<String, Any>(
            "landmarks" to landmarks,
            "width" to bitmap.width,
            "height" to bitmap.height,
            "timestampMs" to timestampMs.toDouble(),
            "model" to modelName,
            "previewMirrored" to true,
            "processedFrames" to processedFrames.toDouble(),
            "validFrames" to validFrames.toDouble(),
            "processedFps" to processedFps,
            "maxBacklogFrames" to 1.0
          )
          payload["packetBase64"] = Base64.encodeToString(packet, Base64.NO_WRAP)
          onPose(payload)
        }
      } catch (error: Exception) {
        emitError("inference", error)
      } finally {
        imageProxy.close()
      }
    }

    try {
      provider.unbindAll()
      provider.bindToLifecycle(
        lifecycleOwner,
        CameraSelector.DEFAULT_FRONT_CAMERA,
        preview,
        analysis
      )
    } catch (error: Exception) {
      emitError("bind", error)
    }
  }

  private fun emitError(stage: String, error: Exception) {
    onPose(mapOf("error" to "$stage: ${error.message}", "model" to modelName))
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    cameraProvider?.unbindAll()
    bound = false
    analysisExecutor.execute {
      landmarker?.close()
      landmarker = null
      if (rustConfigured) MotionNative.nativeClose()
      rustConfigured = false
      configuredProfileCode = null
      nativeRecognitionActive = false
      metricsCollecting = false
      processedFrames = 0
      validFrames = 0
      metricsStartedAtMs = 0
      processedFps = 0.0
    }
  }
}
