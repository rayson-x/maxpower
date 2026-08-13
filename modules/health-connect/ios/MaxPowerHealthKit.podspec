Pod::Spec.new do |s|
  s.name = 'MaxPowerHealthKit'
  s.version = '1.0.0'
  s.summary = 'Local-only HealthKit import bridge for MaxPower.'
  s.description = 'HealthKit types remain inside this Expo module.'
  s.author = 'MaxPower'
  s.homepage = 'https://maxpower.app'
  s.platforms = { :ios => '16.4' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
