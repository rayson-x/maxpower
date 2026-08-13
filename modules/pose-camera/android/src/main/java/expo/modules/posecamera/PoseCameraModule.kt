package expo.modules.posecamera

import android.os.Environment
import java.io.File
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PoseCamera")

    // 扫描应用私有 Movies 目录（getExternalFilesDir）下的可回放视频
    AsyncFunction("listReplayVideos") { ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<String>()
      val dir = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
        ?: return@AsyncFunction emptyList<String>()
      val files: List<String> = dir.listFiles()
        ?.filter {
          it.isFile && (it.name.endsWith(".mp4", ignoreCase = true) ||
            it.name.endsWith(".webm", ignoreCase = true))
        }
        ?.sortedByDescending { it.lastModified() }
        ?.map { it.absolutePath }
        ?: emptyList()
      return@AsyncFunction files
    }

    /**
     * Video deletion is deliberately constrained to direct children of the
     * app-private Movies directory. A JavaScript path must never turn this
     * bridge into an arbitrary filesystem deletion primitive.
     */
    AsyncFunction("deleteReplayVideo") { path: String ->
      val context = appContext.reactContext ?: return@AsyncFunction "not_found"
      val directory = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
        ?: return@AsyncFunction "not_found"
      val root = directory.canonicalFile
      val candidate = try {
        File(path).canonicalFile
      } catch (_: Exception) {
        throw IllegalArgumentException("invalid_replay_video_path")
      }
      val extension = candidate.extension.lowercase()
      if (candidate.parentFile != root || (extension != "mp4" && extension != "webm")) {
        throw IllegalArgumentException("invalid_replay_video_path")
      }
      if (!candidate.exists()) return@AsyncFunction "not_found"
      if (!candidate.delete()) throw IllegalStateException("replay_video_delete_failed")
      return@AsyncFunction "deleted"
    }

    View(PoseCameraView::class) {
      Events("onPose", "onVideo")

      Prop("model") { view: PoseCameraView, model: String ->
        view.setModel(model)
      }
      Prop("recognitionProfile") { view: PoseCameraView, profileJson: String? ->
        view.setRecognitionProfile(profileJson)
      }
      Prop("lensFacing") { view: PoseCameraView, facing: String ->
        view.setLensFacing(facing)
      }
      Prop("recognitionActive") { view: PoseCameraView, active: Boolean ->
        view.setRecognitionActive(active)
      }
      Prop("videoRecording") { view: PoseCameraView, active: Boolean ->
        view.setVideoRecording(active)
      }
      // 视频回放识别：设置路径即开始回放（与相机互斥），清空即停止并恢复相机
      Prop("replayPath") { view: PoseCameraView, path: String? ->
        view.setReplayPath(path)
      }
      Prop("replayPaused") { view: PoseCameraView, paused: Boolean ->
        view.setReplayPaused(paused)
      }
    }
  }
}
