require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ota-update"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["repository"]["url"]
  s.license      = package["license"]
  s.authors      = { "OTA Update" => "support@ota-update.dev" }

  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/your-org/ota-update.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"

  s.dependency "React-Core"

  s.swift_version = "5.0"
end
