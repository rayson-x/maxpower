package expo.modules.posecamera

internal object MotionNative {
  init {
    System.loadLibrary("form_coach_motion_sdk")
    System.loadLibrary("pose_camera_motion")
  }

  external fun nativeConfigure(width: Int, height: Int, profileCode: Int, active: Boolean): Int
  external fun nativeSetProfile(profileCode: Int): Int
  external fun nativeSetActive(active: Boolean): Int
  external fun nativeProcessFrame(timestampMs: Long, flatLandmarks: DoubleArray): ByteArray?
  external fun nativeIsCurrentFrameValid(): Boolean
  external fun nativeClose()
}
