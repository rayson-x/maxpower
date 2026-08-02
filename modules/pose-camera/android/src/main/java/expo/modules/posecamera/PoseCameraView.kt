package expo.modules.posecamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
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
  private var modelName: String = "heavy"
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
          onPose(
            mapOf(
              "landmarks" to landmarks,
              "width" to bitmap.width,
              "height" to bitmap.height,
              "timestampMs" to timestampMs.toDouble(),
              "model" to modelName
            )
          )
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
        CameraSelector.DEFAULT_BACK_CAMERA,
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
    }
  }
}
