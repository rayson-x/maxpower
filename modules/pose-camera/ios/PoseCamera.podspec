repo_root = File.expand_path('../../..', __dir__)
run_preflight = lambda do |arguments, remediation|
  next if system('node', *arguments, chdir: repo_root)

  raise Pod::Informative, <<~MESSAGE
    PoseCamera native preparation failed.
    Run from the repository root: #{remediation}
  MESSAGE
end

run_preflight.call(
  ['tools/client-realtime-agent/fetch-web-vision-models.mjs', '--verify'],
  'node tools/client-realtime-agent/fetch-web-vision-models.mjs --execute'
)
run_preflight.call(
  ['tools/motion-sdk/preflight-native.mjs', 'apple', '--artifacts', 'modules/pose-camera/ios/Frameworks'],
  'sh tools/motion-sdk/build-native.sh apple modules/pose-camera/ios/Frameworks'
)

Pod::Spec.new do |s|
  s.name           = 'PoseCamera'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'onnxruntime-objc', '1.24.2'

  s.vendored_frameworks = 'Frameworks/MotionSdk.xcframework'
  s.resources = [
    '../../../public/models/yolox-nano-humanart-416x416.onnx',
    '../../../public/models/rtmpose-m-halpe26-256x192.onnx'
  ]

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
  }

  s.public_header_files = 'RtmposePipeline.h', 'MotionBridge.h'
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  # The XCFramework is generated from the shared Rust crate. CocoaPods links
  # it as a vendored binary, but must never scan its copied headers as module
  # source or make the generated directory eligible for source commits.
  s.exclude_files = 'Frameworks/**/*'
end
