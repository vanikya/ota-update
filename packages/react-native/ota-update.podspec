require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ota-update"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = { "Vanikya" => "support@vanikya.com" }

  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/vanikya/ota-update.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"

  # Use install_modules_dependencies for new architecture support
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end

  s.swift_version = "5.0"
end
