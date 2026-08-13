package expo.modules.posecamera

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

internal data class RtmposeCandidate(
  val candidateId: Long,
  /** Normalized [x, y, width, height]. */
  val bbox: DoubleArray,
  /** Mean RGB in the shoulder/hip quadrilateral's bounding rectangle. */
  val torsoColor: DoubleArray,
  /** Halpe-26 [x, y, z, raw SimCC score]. */
  val landmarks: List<DoubleArray>,
)

private data class PixelDetection(
  val bbox: FloatArray,
  val score: Float,
  val candidateId: Long = -1,
)

private data class PixelCrop(
  val x: Float,
  val y: Float,
  val width: Float,
  val height: Float,
)

private data class CandidateAssociation(
  val index: Int,
  val iou: Float,
  val center: Float,
  val cost: Float,
)

/**
 * Android visual-observation Adapter for the same frozen models used by Web.
 * It emits raw YOLOX candidates and RTMPose Halpe-26 points only; Rust owns
 * subject selection, continuity repair, unknowns, phases and reps.
 *
 * This object is confined to PoseCameraView's single analysis executor.
 */
internal class RtmposePipeline(context: Context) : AutoCloseable {
  private val environment = OrtEnvironment.getEnvironment()
  private val detectorSession: OrtSession
  private val poseSession: OrtSession
  private var trackedDetections = emptyList<PixelDetection>()
  private var lastDetectorObservationMs: Long? = null
  private var nextCandidateId = 0L

  init {
    val detector = materializeVerifiedAsset(
      context,
      DETECTOR_ASSET,
      DETECTOR_SHA256,
    )
    val pose = materializeVerifiedAsset(
      context,
      POSE_ASSET,
      POSE_SHA256,
    )
    detectorSession = environment.createSession(detector.absolutePath, OrtSession.SessionOptions())
    poseSession = environment.createSession(pose.absolutePath, OrtSession.SessionOptions())
    require(detectorSession.inputNames.contains("input")) { "YOLOX input contract mismatch" }
    require(detectorSession.outputNames.containsAll(listOf("dets", "labels"))) {
      "YOLOX output contract mismatch"
    }
    require(poseSession.inputNames.contains("input")) { "RTMPose input contract mismatch" }
    require(poseSession.outputNames.containsAll(listOf("simcc_x", "simcc_y"))) {
      "RTMPose output contract mismatch"
    }
  }

  fun estimate(bitmap: Bitmap, timestampMs: Long): List<RtmposeCandidate> {
    val current = detectPeople(bitmap)
      .sortedByDescending(PixelDetection::score)
      .take(MAX_PERSON_CANDIDATES)
    if (current.isEmpty()) return emptyList()
    if (lastDetectorObservationMs?.let { timestampMs - it > CANDIDATE_IDENTITY_MEMORY_MS } == true) {
      trackedDetections = emptyList()
    }
    val detections = associateCandidateIds(
      current,
      trackedDetections,
      bitmap.width,
      bitmap.height,
    )
    trackedDetections = detections
    lastDetectorObservationMs = timestampMs
    return estimatePoses(bitmap, detections)
  }

  fun resetTracking() {
    trackedDetections = emptyList()
    lastDetectorObservationMs = null
    nextCandidateId = 0L
  }

  /** Preserve frame-to-frame candidate IDs; Rust still chooses the subject. */
  private fun associateCandidateIds(
    current: List<PixelDetection>,
    previous: List<PixelDetection>,
    width: Int,
    height: Int,
  ): List<PixelDetection> {
    val diagonal = max(1f, kotlin.math.hypot(width.toFloat(), height.toFloat()))
    val available = previous.indices.toMutableSet()
    return current.map { detection ->
      val match = available.map { index ->
        val prior = previous[index]
        val iou = bboxIou(detection.bbox, prior.bbox)
        val center = bboxCenterDistance(detection.bbox, prior.bbox, diagonal)
        val scale = abs(ln(max(1f, bboxArea(detection.bbox)) / max(1f, bboxArea(prior.bbox))))
        CandidateAssociation(index, iou, center, (1f - iou) * 0.65f + center * 2.5f + scale * 0.10f)
      }.minByOrNull(CandidateAssociation::cost)
      if (match != null && (match.iou >= 0.05f || match.center <= 0.12f)) {
        available.remove(match.index)
        detection.copy(candidateId = previous[match.index].candidateId)
      } else {
        detection.copy(candidateId = nextCandidateId++)
      }
    }
  }

  private fun detectPeople(bitmap: Bitmap): List<PixelDetection> {
    val ratio = min(
      DETECTOR_INPUT_SIZE.toFloat() / bitmap.width,
      DETECTOR_INPUT_SIZE.toFloat() / bitmap.height,
    )
    val drawWidth = max(1f, bitmap.width * ratio)
    val drawHeight = max(1f, bitmap.height * ratio)
    val inputBitmap = Bitmap.createBitmap(
      DETECTOR_INPUT_SIZE,
      DETECTOR_INPUT_SIZE,
      Bitmap.Config.ARGB_8888,
    )
    Canvas(inputBitmap).apply {
      drawColor(Color.rgb(114, 114, 114))
      drawBitmap(
        bitmap,
        null,
        RectF(0f, 0f, drawWidth, drawHeight),
        BILINEAR_PAINT,
      )
    }
    val pixels = IntArray(DETECTOR_INPUT_SIZE * DETECTOR_INPUT_SIZE)
    inputBitmap.getPixels(
      pixels,
      0,
      DETECTOR_INPUT_SIZE,
      0,
      0,
      DETECTOR_INPUT_SIZE,
      DETECTOR_INPUT_SIZE,
    )
    inputBitmap.recycle()
    val plane = DETECTOR_INPUT_SIZE * DETECTOR_INPUT_SIZE
    val input = directFloatBuffer(plane * 3)
    for (channel in 0 until 3) {
      for (pixel in pixels) {
        input.put(
          when (channel) {
            0 -> Color.blue(pixel).toFloat()
            1 -> Color.green(pixel).toFloat()
            else -> Color.red(pixel).toFloat()
          },
        )
      }
    }
    input.rewind()
    val detValues: FloatArray
    val labelValues: LongArray
    OnnxTensor.createTensor(
      environment,
      input,
      longArrayOf(1, 3, DETECTOR_INPUT_SIZE.toLong(), DETECTOR_INPUT_SIZE.toLong()),
    ).use { tensor ->
      detectorSession.run(mapOf("input" to tensor)).use { outputs ->
        val dets = outputs.get("dets").orElseThrow() as OnnxTensor
        val labels = outputs.get("labels").orElseThrow() as OnnxTensor
        detValues = dets.floatBuffer.copyToFloatArray()
        labelValues = labels.longBuffer.copyToLongArray()
      }
    }
    val count = min(labelValues.size, detValues.size / 5)
    val detections = ArrayList<PixelDetection>(count)
    for (index in 0 until count) {
      val offset = index * 5
      val score = detValues[offset + 4]
      if (labelValues[index] != 0L || score < MIN_PERSON_SCORE) continue
      val x1 = clamp(detValues[offset] / ratio, 0f, bitmap.width - 1f)
      val y1 = clamp(detValues[offset + 1] / ratio, 0f, bitmap.height - 1f)
      val x2 = clamp(detValues[offset + 2] / ratio, x1 + 1f, bitmap.width.toFloat())
      val y2 = clamp(detValues[offset + 3] / ratio, y1 + 1f, bitmap.height.toFloat())
      detections += PixelDetection(floatArrayOf(x1, y1, x2, y2), score)
    }
    return detections
  }

  private fun estimatePoses(
    bitmap: Bitmap,
    detections: List<PixelDetection>,
  ): List<RtmposeCandidate> {
    val plane = POSE_INPUT_WIDTH * POSE_INPUT_HEIGHT
    val input = directFloatBuffer(detections.size * 3 * plane)
    val crops = detections.map { paddedCrop(it.bbox) }
    for (crop in crops) {
      val cropBitmap = Bitmap.createBitmap(
        POSE_INPUT_WIDTH,
        POSE_INPUT_HEIGHT,
        Bitmap.Config.ARGB_8888,
      )
      Canvas(cropBitmap).apply {
        drawColor(Color.BLACK)
        val transform = Matrix().apply {
          setRectToRect(
            RectF(crop.x, crop.y, crop.x + crop.width, crop.y + crop.height),
            RectF(0f, 0f, POSE_INPUT_WIDTH.toFloat(), POSE_INPUT_HEIGHT.toFloat()),
            Matrix.ScaleToFit.FILL,
          )
        }
        drawBitmap(bitmap, transform, BILINEAR_PAINT)
      }
      val pixels = IntArray(plane)
      cropBitmap.getPixels(
        pixels,
        0,
        POSE_INPUT_WIDTH,
        0,
        0,
        POSE_INPUT_WIDTH,
        POSE_INPUT_HEIGHT,
      )
      cropBitmap.recycle()
      for (channel in 0 until 3) {
        for (pixel in pixels) {
          val value = when (channel) {
            0 -> Color.blue(pixel).toFloat()
            1 -> Color.green(pixel).toFloat()
            else -> Color.red(pixel).toFloat()
          }
          input.put((value - POSE_MEAN[channel]) / POSE_STD[channel])
        }
      }
    }
    input.rewind()
    val simccX: FloatArray
    val simccY: FloatArray
    OnnxTensor.createTensor(
      environment,
      input,
      longArrayOf(
        detections.size.toLong(),
        3,
        POSE_INPUT_HEIGHT.toLong(),
        POSE_INPUT_WIDTH.toLong(),
      ),
    ).use { tensor ->
      poseSession.run(mapOf("input" to tensor)).use { outputs ->
        val x = outputs.get("simcc_x").orElseThrow() as OnnxTensor
        val y = outputs.get("simcc_y").orElseThrow() as OnnxTensor
        simccX = x.floatBuffer.copyToFloatArray()
        simccY = y.floatBuffer.copyToFloatArray()
      }
    }
    return detections.mapIndexed { batchIndex, detection ->
      val crop = crops[batchIndex]
      val landmarks = ArrayList<DoubleArray>(HALPE_KEYPOINT_COUNT)
      for (keypoint in 0 until HALPE_KEYPOINT_COUNT) {
        val pointOffset = batchIndex * HALPE_KEYPOINT_COUNT + keypoint
        val (xIndex, xScore) = argmax(simccX, pointOffset * SIMCC_BINS_X, SIMCC_BINS_X)
        val (yIndex, yScore) = argmax(simccY, pointOffset * SIMCC_BINS_Y, SIMCC_BINS_Y)
        landmarks += doubleArrayOf(
          ((crop.x + (xIndex / 2f / POSE_INPUT_WIDTH) * crop.width) / bitmap.width).toDouble(),
          ((crop.y + (yIndex / 2f / POSE_INPUT_HEIGHT) * crop.height) / bitmap.height).toDouble(),
          0.0,
          clamp((xScore + yScore) / 2f, 0f, 1f).toDouble(),
        )
      }
      RtmposeCandidate(
        candidateId = detection.candidateId,
        bbox = doubleArrayOf(
          detection.bbox[0] / bitmap.width.toDouble(),
          detection.bbox[1] / bitmap.height.toDouble(),
          (detection.bbox[2] - detection.bbox[0]) / bitmap.width.toDouble(),
          (detection.bbox[3] - detection.bbox[1]) / bitmap.height.toDouble(),
        ),
        torsoColor = sampleTorsoColor(bitmap, landmarks),
        landmarks = landmarks,
      )
    }
  }

  private fun selectDominantContinuousPerson(
    detections: List<PixelDetection>,
    previous: FloatArray?,
    width: Int,
    height: Int,
  ): PixelDetection? {
    if (detections.isEmpty()) return null
    val frameArea = width.toFloat() * height
    val diagonal = kotlin.math.hypot(width.toFloat(), height.toFloat())
    val centerBox = floatArrayOf(width * 0.45f, height * 0.45f, width * 0.55f, height * 0.55f)
    val largestArea = detections.maxOf(::bboxArea)
    if (previous != null) {
      val previousArea = max(1f, bboxArea(previous))
      val dominant = detections.maxBy(::bboxArea)
      val dominantArea = bboxArea(dominant)
      if (
        previousArea < frameArea * 0.05f
        && dominantArea >= max(previousArea * 3f, frameArea * 0.08f)
        && bboxCenterDistance(dominant.bbox, centerBox, diagonal) <= 0.35f
      ) {
        return dominant
      }
    }
    val selected = detections.map { detection ->
      val area = bboxArea(detection)
      val areaRelative = if (largestArea > 0f) area / largestArea else 0f
      val frameAreaRatio = min(1f, area / max(frameArea * 0.35f, 1f))
      val imageCenter = 1f - min(1f, bboxCenterDistance(detection.bbox, centerBox, diagonal))
      val continuity = if (previous == null) 0f else bboxIou(detection.bbox, previous)
      val centerContinuity = if (previous == null) 0f else
        1f - min(1f, bboxCenterDistance(detection.bbox, previous, diagonal) * 3f)
      val score = if (previous == null) {
        areaRelative * 0.55f + frameAreaRatio * 0.20f + imageCenter * 0.25f
      } else {
        continuity * 0.58f + centerContinuity * 0.25f + areaRelative * 0.12f + imageCenter * 0.05f
      }
      Triple(detection, score, continuity)
    }.maxBy { it.second }
    if (previous != null) {
      val previousArea = max(1f, bboxArea(previous))
      val sizeRatio = bboxArea(selected.first) / previousArea
      val centerJump = bboxCenterDistance(selected.first.bbox, previous, diagonal)
      if (
        (selected.third < 0.12f && centerJump > 0.10f)
        || (selected.third < 0.05f && sizeRatio !in 0.45f..2.5f)
      ) return null
    }
    return selected.first
  }

  override fun close() {
    resetTracking()
    detectorSession.close()
    poseSession.close()
  }

  companion object {
    const val MODEL_NAME = "yolox-nano-humanart+rtmpose-m-halpe26"
    const val POSE_SCHEMA = "halpe26"
    const val HALPE_KEYPOINT_COUNT = 26

    private const val DETECTOR_INPUT_SIZE = 416
    private const val POSE_INPUT_WIDTH = 192
    private const val POSE_INPUT_HEIGHT = 256
    private const val SIMCC_BINS_X = POSE_INPUT_WIDTH * 2
    private const val SIMCC_BINS_Y = POSE_INPUT_HEIGHT * 2
    private const val MIN_PERSON_SCORE = 0.15f
    private const val MAX_PERSON_CANDIDATES = 4
    private const val CANDIDATE_IDENTITY_MEMORY_MS = 1_500L
    private const val BBOX_PADDING = 1.25f
    private const val DETECTOR_ASSET = "models/yolox-nano-humanart-416x416.onnx"
    private const val POSE_ASSET = "models/rtmpose-m-halpe26-256x192.onnx"
    private const val DETECTOR_SHA256 =
      "1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821"
    private const val POSE_SHA256 =
      "26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf"
    private val POSE_MEAN = floatArrayOf(123.675f, 116.28f, 103.53f)
    private val POSE_STD = floatArrayOf(58.395f, 57.12f, 57.375f)
    private val BILINEAR_PAINT = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    private fun materializeVerifiedAsset(
      context: Context,
      assetPath: String,
      expectedSha256: String,
    ): File {
      val directory = File(context.codeCacheDir, "maxpower-pose-models").apply { mkdirs() }
      val output = File(directory, File(assetPath).name)
      if (output.isFile && sha256(output) == expectedSha256) return output
      val temporary = File(directory, "${output.name}.partial")
      if (temporary.exists()) temporary.delete()
      context.assets.open(assetPath).use { input ->
        temporary.outputStream().use { destination -> input.copyTo(destination) }
      }
      check(sha256(temporary) == expectedSha256) { "pose model integrity mismatch: $assetPath" }
      if (output.exists()) check(output.delete()) { "could not replace stale pose model" }
      check(temporary.renameTo(output)) { "could not install pose model" }
      return output
    }

    private fun sha256(file: File): String {
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val block = ByteArray(1024 * 1024)
        while (true) {
          val count = input.read(block)
          if (count < 0) break
          digest.update(block, 0, count)
        }
      }
      return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun directFloatBuffer(count: Int): FloatBuffer =
      ByteBuffer.allocateDirect(count * Float.SIZE_BYTES)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()

    private fun FloatBuffer.copyToFloatArray(): FloatArray {
      rewind()
      return FloatArray(remaining()).also(::get)
    }

    private fun java.nio.LongBuffer.copyToLongArray(): LongArray {
      rewind()
      return LongArray(remaining()).also(::get)
    }

    private fun paddedCrop(bbox: FloatArray): PixelCrop {
      val centerX = (bbox[0] + bbox[2]) / 2f
      val centerY = (bbox[1] + bbox[3]) / 2f
      var width = (bbox[2] - bbox[0]) * BBOX_PADDING
      var height = (bbox[3] - bbox[1]) * BBOX_PADDING
      val inputAspect = POSE_INPUT_WIDTH.toFloat() / POSE_INPUT_HEIGHT
      if (width > height * inputAspect) height = width / inputAspect
      else width = height * inputAspect
      return PixelCrop(centerX - width / 2f, centerY - height / 2f, width, height)
    }

    private fun sampleTorsoColor(
      bitmap: Bitmap,
      landmarks: List<DoubleArray>,
    ): DoubleArray {
      val torso = intArrayOf(5, 6, 11, 12).map { landmarks[it] }
      if (torso.any { it[3] < 0.2 }) return doubleArrayOf(0.0, 0.0, 0.0)
      val left = clamp(
        floor(torso.minOf { it[0] } * bitmap.width).toFloat(),
        0f,
        bitmap.width - 1f,
      ).toInt()
      val right = clamp(
        ceil(torso.maxOf { it[0] } * bitmap.width).toFloat(),
        left + 1f,
        bitmap.width.toFloat(),
      ).toInt()
      val top = clamp(
        floor(torso.minOf { it[1] } * bitmap.height).toFloat(),
        0f,
        bitmap.height - 1f,
      ).toInt()
      val bottom = clamp(
        ceil(torso.maxOf { it[1] } * bitmap.height).toFloat(),
        top + 1f,
        bitmap.height.toFloat(),
      ).toInt()
      val width = right - left
      val height = bottom - top
      if (width <= 0 || height <= 0) return doubleArrayOf(0.0, 0.0, 0.0)
      val pixels = IntArray(width * height)
      bitmap.getPixels(pixels, 0, width, left, top, width, height)
      var red = 0L
      var green = 0L
      var blue = 0L
      for (pixel in pixels) {
        red += Color.red(pixel)
        green += Color.green(pixel)
        blue += Color.blue(pixel)
      }
      val denominator = pixels.size * 255.0
      return doubleArrayOf(red / denominator, green / denominator, blue / denominator)
    }

    private fun bboxIou(left: FloatArray, right: FloatArray): Float {
      val intersectionWidth = max(0f, min(left[2], right[2]) - max(left[0], right[0]))
      val intersectionHeight = max(0f, min(left[3], right[3]) - max(left[1], right[1]))
      val intersection = intersectionWidth * intersectionHeight
      val union = bboxArea(left) + bboxArea(right) - intersection
      return if (union > 0f) intersection / union else 0f
    }

    private fun bboxArea(detection: PixelDetection): Float = bboxArea(detection.bbox)

    private fun bboxArea(bbox: FloatArray): Float =
      max(0f, bbox[2] - bbox[0]) * max(0f, bbox[3] - bbox[1])

    private fun bboxCenterDistance(left: FloatArray, right: FloatArray, diagonal: Float): Float =
      kotlin.math.hypot(
        (left[0] + left[2]) / 2f - (right[0] + right[2]) / 2f,
        (left[1] + left[3]) / 2f - (right[1] + right[3]) / 2f,
      ) / diagonal

    private fun argmax(data: FloatArray, offset: Int, length: Int): Pair<Int, Float> {
      var bestIndex = 0
      var bestValue = Float.NEGATIVE_INFINITY
      for (index in 0 until length) {
        val value = data[offset + index]
        if (value > bestValue) {
          bestIndex = index
          bestValue = value
        }
      }
      return bestIndex to bestValue
    }

    private fun clamp(value: Float, minimum: Float, maximum: Float): Float =
      min(maximum, max(minimum, value))
  }
}
