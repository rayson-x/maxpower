cmake_minimum_required(VERSION 3.22.1)
project(pose_camera_motion)

add_library(maxpower_motion_sdk SHARED IMPORTED)
set_target_properties(maxpower_motion_sdk PROPERTIES
  IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../../../build/rustJni/${ANDROID_ABI}/libmaxpower_motion_sdk.so"
  # Rust cdylib 不带 SONAME；不声明 NO_SONAME 时，链接器会把构建机的绝对路径
  # 写进 NEEDED，运行时 dlopen 按绝对路径找库 → UnsatisfiedLinkError 崩溃。
  IMPORTED_NO_SONAME TRUE
)

add_library(pose_camera_motion SHARED motion_bridge.cpp)
target_include_directories(pose_camera_motion PRIVATE ../../../../common)
target_link_libraries(pose_camera_motion maxpower_motion_sdk android log)
