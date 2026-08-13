# ONNX Runtime's Java facade is reached through JNI. Keep its native method
# names when the host application enables R8/minification.
-keep class ai.onnxruntime.** { *; }
