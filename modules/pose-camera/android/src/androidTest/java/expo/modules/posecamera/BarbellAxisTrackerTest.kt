package expo.modules.posecamera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BarbellAxisTrackerTest {
  @Test
  fun currentFrameShaftIsMeasuredAndOneMissingFrameIsOnlyPredicted() {
    val tracker = BarbellAxisTracker()
    try {
      val measured = tracker.process(frameWithShaft(0.42f), 1_000, listOf(subject()))
      assertNotNull(measured)
      assertEquals("measured", measured!!.source)
      assertTrue(measured.confidence >= 0.50)
      assertTrue(kotlin.math.abs(measured.centerY - 0.42) < 0.03)
      assertTrue(measured.rustMetadata()[5] >= 0.50)
      assertEquals(2.0, measured.rustMetadata()[7], 0.0)

      val predicted = tracker.process(blankFrame(), 1_067, listOf(subject()))
      assertNotNull(predicted)
      assertEquals("predicted", predicted!!.source)
      assertEquals(false, predicted.measured)
      assertEquals(3.0, predicted.rustMetadata()[7], 0.0)
    } finally {
      tracker.close()
    }
  }

  @Test
  fun measuredShaftAndHalpePoseReachRustInTheSameFrame() {
    val tracker = BarbellAxisTracker()
    try {
      val subject = subject()
      val shaft = tracker.process(frameWithShaft(0.42f), 1_000, listOf(subject))
      assertNotNull(shaft)
      assertTrue(shaft!!.measured)

      assertEquals(0, MotionNative.nativeConfigure(WIDTH, HEIGHT, 0, 1, false, 0))
      val withEquipment = MotionNative.processObservations(
        1_000,
        longArrayOf(subject.candidateId),
        subjectMetadata(subject),
        subject.landmarks.flatMap(DoubleArray::asList).toDoubleArray(),
        26,
        longArrayOf(shaft.proposalId),
        shaft.rustMetadata(),
      )
      assertNotNull(withEquipment)

      MotionNative.nativeClose()
      assertEquals(0, MotionNative.nativeConfigure(WIDTH, HEIGHT, 0, 1, false, 0))
      val poseOnly = MotionNative.processObservations(
        1_000,
        longArrayOf(subject.candidateId),
        subjectMetadata(subject),
        subject.landmarks.flatMap(DoubleArray::asList).toDoubleArray(),
        26,
      )
      assertNotNull(poseOnly)
      assertFalse(
        "Rust packet must preserve current-frame equipment evidence",
        withEquipment!!.contentEquals(poseOnly!!),
      )
    } finally {
      MotionNative.nativeClose()
      tracker.close()
    }
  }

  private fun frameWithShaft(normalizedY: Float): Bitmap = blankFrame().also { bitmap ->
    val canvas = Canvas(bitmap)
    val paint = Paint().apply {
      color = Color.WHITE
      strokeWidth = 6f
      isAntiAlias = false
    }
    canvas.drawLine(70f, normalizedY * HEIGHT, WIDTH - 70f, normalizedY * HEIGHT, paint)
  }

  private fun blankFrame(): Bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888).also {
    it.eraseColor(Color.BLACK)
  }

  private fun subject(): RtmposeCandidate {
    val landmarks = List(26) { doubleArrayOf(0.5, 0.5, 0.0, 0.0) }
    landmarks[5][0] = 0.40
    landmarks[5][1] = 0.50
    landmarks[5][3] = 0.95
    landmarks[6][0] = 0.60
    landmarks[6][1] = 0.50
    landmarks[6][3] = 0.95
    landmarks[9][0] = 0.24
    landmarks[9][1] = 0.42
    landmarks[9][3] = 0.80
    landmarks[10][0] = 0.76
    landmarks[10][1] = 0.42
    landmarks[10][3] = 0.80
    return RtmposeCandidate(
      candidateId = 1,
      bbox = doubleArrayOf(0.15, 0.10, 0.70, 0.80),
      torsoColor = doubleArrayOf(0.0, 0.0, 0.0),
      landmarks = landmarks,
    )
  }

  private fun subjectMetadata(subject: RtmposeCandidate): DoubleArray = doubleArrayOf(
    subject.bbox[0],
    subject.bbox[1],
    subject.bbox[2],
    subject.bbox[3],
    subject.torsoColor[0],
    subject.torsoColor[1],
    subject.torsoColor[2],
  )

  private companion object {
    const val WIDTH = 640
    const val HEIGHT = 480
  }
}
