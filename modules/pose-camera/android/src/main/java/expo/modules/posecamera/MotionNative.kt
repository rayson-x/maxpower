package expo.modules.posecamera

internal object MotionNative {
  init {
    System.loadLibrary("maxpower_motion_sdk")
    System.loadLibrary("pose_camera_motion")
  }

  external fun nativeConfigure(
    width: Int,
    height: Int,
    profileCode: Int,
    poseSchemaCode: Int,
    active: Boolean,
  ): Int
  external fun nativeSetProfile(profileCode: Int): Int
  external fun nativeInstallProfile(identity: String, abiArguments: DoubleArray): Int
  external fun nativeSetActive(active: Boolean): Int
  external fun nativeContractMajor(): Int
  external fun nativeProcessFrame(timestampMs: Long, flatLandmarks: DoubleArray): ByteArray?
  /**
   * Stable Adapter seam for pose + equipment observations. Person metadata is
   * [x, y, width, height, torsoR, torsoG, torsoB]. Every equipment array uses
   * one format consistently: legacy box-only observations are
   * [kind, x, y, width, height, score, uncertaintyPx, source, flags], while
   * the additive form appends [axisPresent, x1, y1, x2, y2]. axisPresent is 0
   * or 1, so box-only and measured-axis observations can share one frame. A
   * negative uncertainty means unknown. Axis endpoints are never inferred from
   * the box. Rust owns subject/equipment identity.
   */
  fun processObservations(
    timestampMs: Long,
    candidateIds: LongArray,
    candidateMetadata: DoubleArray,
    flatLandmarks: DoubleArray,
    landmarkCount: Int,
    equipmentIds: LongArray = LongArray(0),
    equipmentMetadata: DoubleArray = DoubleArray(0),
    visualLuma: ByteArray? = null,
    visualWidth: Int = 0,
    visualHeight: Int = 0,
  ): ByteArray? = nativeProcessObservations(
    timestampMs,
    candidateIds,
    candidateMetadata,
    flatLandmarks,
    landmarkCount,
    equipmentIds,
    equipmentMetadata,
    visualLuma,
    visualWidth,
    visualHeight,
  )

  private external fun nativeProcessObservations(
    timestampMs: Long,
    candidateIds: LongArray,
    candidateMetadata: DoubleArray,
    flatLandmarks: DoubleArray,
    landmarkCount: Int,
    equipmentIds: LongArray,
    equipmentMetadata: DoubleArray,
    visualLuma: ByteArray?,
    visualWidth: Int,
    visualHeight: Int,
  ): ByteArray?
  private external fun nativeVisualBarbellAxis(): DoubleArray?

  fun visualBarbellAxis(): BarbellAxisObservation? {
    val values = nativeVisualBarbellAxis() ?: return null
    require(values.size == 8 && values.all(Double::isFinite)) {
      "Rust visual barbell axis is invalid"
    }
    val source = when (values[0].toInt()) {
      1 -> "measured"
      2 -> "predicted"
      3 -> "fused"
      else -> return null
    }
    return BarbellAxisObservation(
      source = source,
      x1 = values[1],
      y1 = values[2],
      x2 = values[3],
      y2 = values[4],
      centerY = values[5],
      confidence = values[6],
      uncertaintyPx = values[7],
    )
  }
  external fun nativeIsCurrentFrameValid(): Boolean
  external fun nativeClose()
}
