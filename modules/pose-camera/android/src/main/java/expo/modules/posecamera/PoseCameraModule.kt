package expo.modules.posecamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PoseCamera")

    View(PoseCameraView::class) {
      Events("onPose")

      Prop("model") { view: PoseCameraView, model: String ->
        view.setModel(model)
      }
    }
  }
}
