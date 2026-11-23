Pod::Spec.new do |s|
  s.name           = 'FoyerInk'
  s.version        = '1.0.0'
  s.summary        = 'Apple Pencil ink for Foyer'
  s.description    = 'Draws the stroke being written with PencilKit, inside the page that iOS zooms.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PencilKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = "**/*.{h,m,mm,swift}"
end
