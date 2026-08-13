package expo.modules.posecamera

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MotionNativeRealHalpe26ParityTest {
  @After
  fun closeRust() {
    MotionNative.nativeClose()
  }

  @Test
  fun replaysFrontBenchMirrorHalpe26PacketsByteExactly() {
    val fixture = readAsset(FIXTURE_ASSET)
    val oracle = readAsset(ORACLE_ASSET)
    val source = fixture.getJSONObject("source")
    val config = fixture.getJSONObject("bridgeConfig")
    val frames = fixture.getJSONArray("frames")
    val expectedFrames = oracle.getJSONArray("frames")

    assertEquals("halpe26", config.getString("poseSchema"))
    assertEquals(false, config.getBoolean("active"))
    assertEquals(frames.length(), expectedFrames.length())
    assertEquals(
      0,
      MotionNative.nativeConfigure(
        source.getInt("widthPx"),
        source.getInt("heightPx"),
        config.getInt("profileCode"),
        config.getInt("poseSchemaCode"),
        false,
      ),
    )

    for (frameIndex in 0 until frames.length()) {
      val frame = frames.getJSONObject(frameIndex)
      val expected = expectedFrames.getJSONObject(frameIndex)
      val candidates = frame.getJSONArray("candidates")
      val candidateIds = LongArray(candidates.length())
      val metadata = DoubleArray(candidates.length() * 7)
      val landmarks = DoubleArray(candidates.length() * HALPE_KEYPOINT_COUNT * 4)
      val equipment = frame.getJSONArray("equipmentObservations")
      val equipmentIds = LongArray(equipment.length())
      val equipmentMetadata = DoubleArray(equipment.length() * EQUIPMENT_METADATA_COUNT)

      for (candidateIndex in 0 until candidates.length()) {
        val candidate = candidates.getJSONObject(candidateIndex)
        candidateIds[candidateIndex] = candidate.getLong("candidateId")
        copyNumbers(candidate.getJSONArray("bbox"), metadata, candidateIndex * 7)
        copyNumbers(candidate.getJSONArray("torsoColor"), metadata, candidateIndex * 7 + 4)
        val candidateLandmarks = candidate.getJSONArray("landmarks")
        assertEquals(HALPE_KEYPOINT_COUNT, candidateLandmarks.length())
        for (landmarkIndex in 0 until candidateLandmarks.length()) {
          copyNumbers(
            candidateLandmarks.getJSONArray(landmarkIndex),
            landmarks,
            (candidateIndex * HALPE_KEYPOINT_COUNT + landmarkIndex) * 4,
          )
        }
      }

      for (equipmentIndex in 0 until equipment.length()) {
        val observation = equipment.getJSONObject(equipmentIndex)
        val offset = equipmentIndex * EQUIPMENT_METADATA_COUNT
        equipmentIds[equipmentIndex] = observation.getLong("proposalId")
        equipmentMetadata[offset] = equipmentKindCode(observation.getString("kind")).toDouble()
        copyNumbers(observation.getJSONArray("bbox"), equipmentMetadata, offset + 1)
        equipmentMetadata[offset + 5] = observation.getDouble("score")
        equipmentMetadata[offset + 6] = if (observation.isNull("uncertaintyPx")) {
          -1.0
        } else {
          observation.getDouble("uncertaintyPx")
        }
        equipmentMetadata[offset + 7] =
          equipmentSourceCode(observation.getString("source")).toDouble()
        equipmentMetadata[offset + 8] =
          equipmentFlags(observation.getJSONObject("attributes")).toDouble()
      }

      assertEquals(expected.getLong("timestampMs"), frame.getLong("timestampMs"))
      val packet = MotionNative.processObservations(
        frame.getLong("timestampMs"),
        candidateIds,
        metadata,
        landmarks,
        HALPE_KEYPOINT_COUNT,
        equipmentIds,
        equipmentMetadata,
      )
      assertNotNull("packet missing at source frame ${frame.getInt("sourceFrameNumber")}", packet)
      assertArrayEquals(
        "packet drift at source frame ${frame.getInt("sourceFrameNumber")}",
        decodeHex(expected.getString("packetHex")),
        packet,
      )
      assertEquals(expected.getBoolean("currentFrameValid"), MotionNative.nativeIsCurrentFrameValid())
    }
  }

  private fun readAsset(name: String): JSONObject {
    val context = InstrumentationRegistry.getInstrumentation().context
    return JSONObject(context.assets.open(name).bufferedReader().use { it.readText() })
  }

  private fun copyNumbers(source: JSONArray, target: DoubleArray, offset: Int) {
    for (index in 0 until source.length()) target[offset + index] = source.getDouble(index)
  }

  private fun decodeHex(value: String): ByteArray {
    require(value.length % 2 == 0)
    return ByteArray(value.length / 2) { index ->
      value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }
  }

  private fun equipmentKindCode(value: String): Int = when (value) {
    "weight_plate" -> 0
    "barbell_shaft" -> 1
    "dumbbell" -> 2
    "machine_handle" -> 3
    else -> error("unknown equipment kind $value")
  }

  private fun equipmentSourceCode(value: String): Int = when (value) {
    "detector" -> 0
    "optical_flow" -> 1
    "geometry" -> 2
    "predicted" -> 3
    else -> error("unknown equipment source $value")
  }

  private fun equipmentFlags(attributes: JSONObject): Int {
    var flags = 0
    if (attributes.getBoolean("reflectionCandidate")) flags = flags or 1
    if (attributes.getBoolean("staticRackCandidate")) flags = flags or (1 shl 1)
    flags = flags or when (attributes.getString("occlusion")) {
      "none" -> 0
      "partial" -> 1 shl 2
      "heavy" -> 1 shl 3
      else -> error("unknown equipment occlusion")
    }
    if (attributes.getBoolean("truncated")) flags = flags or (1 shl 4)
    return flags
  }

  private companion object {
    const val HALPE_KEYPOINT_COUNT = 26
    const val EQUIPMENT_METADATA_COUNT = 9
    const val FIXTURE_ASSET = "front-bench-mirror-halpe26-multi-candidate-v1.json"
    const val ORACLE_ASSET = "front-bench-mirror-halpe26-multi-candidate-v1.rust-oracle.json"
  }
}
