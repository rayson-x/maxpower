cmake_minimum_required(VERSION 3.22.1)
project(pose_camera_motion)

add_library(form_coach_motion_sdk SHARED IMPORTED)
set_target_properties(form_coach_motion_sdk PROPERTIES
  IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../../../build/rustJni/${ANDROID_ABI}/libform_coach_motion_sdk.so"
)

add_library(pose_camera_motion SHARED motion_bridge.cpp)
target_include_directories(pose_camera_motion PRIVATE ../../../../common)
target_link_libraries(pose_camera_motion form_coach_motion_sdk android log)
