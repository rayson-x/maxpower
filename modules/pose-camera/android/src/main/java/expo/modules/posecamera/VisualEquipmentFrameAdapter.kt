package expo.modules.posecamera

import android.graphics.Bitmap
import kotlin.math.max
import kotlin.math.roundToInt

/** Platform-only pixel transport. All shaft semantics and temporal state live in Rust. */
internal data class VisualEquipmentLumaFrame(
  val width: Int,
  val height: Int,
  val luma: ByteArray,
)

internal fun Bitmap.visualEquipmentLumaFrame(maximumDimension: Int = 480): VisualEquipmentLumaFrame {
  require(maximumDimension >= 8)
  val longest = max(width, height)
  val scale = if (longest > maximumDimension) maximumDimension.toDouble() / longest else 1.0
  val outputWidth = max(8, (width * scale).roundToInt())
  val outputHeight = max(8, (height * scale).roundToInt())
  val scaled = if (outputWidth == width && outputHeight == height) {
    this
  } else {
    Bitmap.createScaledBitmap(this, outputWidth, outputHeight, true)
  }
  try {
    val pixels = IntArray(outputWidth * outputHeight)
    scaled.getPixels(pixels, 0, outputWidth, 0, 0, outputWidth, outputHeight)
    val luma = ByteArray(pixels.size)
    pixels.forEachIndexed { index, color ->
      val red = color ushr 16 and 0xff
      val green = color ushr 8 and 0xff
      val blue = color and 0xff
      luma[index] = ((77 * red + 150 * green + 29 * blue + 128) ushr 8).toByte()
    }
    return VisualEquipmentLumaFrame(outputWidth, outputHeight, luma)
  } finally {
    if (scaled !== this) scaled.recycle()
  }
}
