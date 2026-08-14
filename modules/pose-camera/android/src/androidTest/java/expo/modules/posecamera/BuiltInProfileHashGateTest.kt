package expo.modules.posecamera

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BuiltInProfileHashGateTest {
  @Test
  fun benchLocalEnvelopeRequiresBothExpectedHashWords() {
    assertThrows(IllegalArgumentException::class.java) {
      NativeRecognitionProfile.parse(builtInEnvelope(109).toString())
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeRecognitionProfile.parse(
        builtInEnvelope(109).put("expectedProfileHashLow", 1).toString(),
      )
    }
  }

  @Test
  fun legacyBuiltInEnvelopeRemainsCompatibleWithoutHash() {
    for (profileCode in listOf(5, 112, 113, 114, 115)) {
      val parsed = NativeRecognitionProfile.parse(builtInEnvelope(profileCode).toString())
      assertEquals(profileCode, parsed.profileCode)
    }
  }

  @Test
  fun configureAndRuntimeSwitchRejectMissingOrMismatchedBenchHash() {
    val profileCode = 109
    val low = MotionNative.nativeBuiltinProfileHashLow(profileCode)
    val high = MotionNative.nativeBuiltinProfileHashHigh(profileCode)
    assertNotEquals(0L, Integer.toUnsignedLong(low) or Integer.toUnsignedLong(high))
    val expected = NativeProfileHash(low, high)

    try {
      assertEquals(-20, MotionNative.nativeConfigure(640, 480, profileCode, 1, false, 0))
      assertEquals(
        -21,
        MotionNative.nativeConfigure(
          640,
          480,
          profileCode,
          1,
          false,
          0,
          NativeProfileHash(low xor 1, high),
        ),
      )
      assertEquals(0, MotionNative.nativeConfigure(640, 480, profileCode, 1, false, 0, expected))

      assertEquals(-20, MotionNative.nativeSetProfile(110))
      val nextLow = MotionNative.nativeBuiltinProfileHashLow(110)
      val nextHigh = MotionNative.nativeBuiltinProfileHashHigh(110)
      assertEquals(-21, MotionNative.nativeSetProfile(110, NativeProfileHash(nextLow, nextHigh xor 1)))
      assertEquals(0, MotionNative.nativeSetProfile(110, NativeProfileHash(nextLow, nextHigh)))
    } finally {
      MotionNative.nativeClose()
    }
  }

  @Test
  fun envelopePreservesUnsignedRustHashWordsWithoutRecomputingThem() {
    val profileCode = 111
    val low = MotionNative.nativeBuiltinProfileHashLow(profileCode)
    val high = MotionNative.nativeBuiltinProfileHashHigh(profileCode)
    val envelope = builtInEnvelope(profileCode)
      .put("expectedProfileHashLow", Integer.toUnsignedLong(low))
      .put("expectedProfileHashHigh", Integer.toUnsignedLong(high))

    val parsed = NativeRecognitionProfile.parse(envelope.toString())
        as NativeRecognitionProfile.BuiltIn
    assertNotNull(parsed.expectedProfileHash)
    assertEquals(low, parsed.expectedProfileHash!!.low)
    assertEquals(high, parsed.expectedProfileHash!!.high)
  }

  @Test
  fun nonBenchBuiltInConfigureRemainsCompatibleWithoutHash() {
    try {
      assertEquals(0, MotionNative.nativeConfigure(640, 480, 112, 1, false, 0))
    } finally {
      MotionNative.nativeClose()
    }
  }

  private fun builtInEnvelope(profileCode: Int): JSONObject = JSONObject()
    .put("schemaVersion", "maxpower-native-recognition-profile/v1")
    .put("mode", "built_in")
    .put("profileCode", profileCode)
    .put("equipmentVision", "barbell_axis")
}
