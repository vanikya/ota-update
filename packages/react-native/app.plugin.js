const { withMainApplication, withAppDelegate, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withOTAUpdateAndroid(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('getJSBundleFile')) {
      return config;
    }

    // Add imports if not present
    if (!contents.includes('import android.content.SharedPreferences')) {
      contents = contents.replace(
        /^(package .+?\n)/m,
        `$1\nimport android.content.SharedPreferences\nimport java.io.File\n`
      );
    }

    // For Kotlin-based MainApplication (Expo SDK 50+)
    // Find the ReactNativeHost and add getJSBundleFile override
    const kotlinPattern = /override\s+fun\s+getUseDeveloperSupport\(\):\s+Boolean\s*=\s*BuildConfig\.DEBUG/;

    if (kotlinPattern.test(contents)) {
      contents = contents.replace(
        kotlinPattern,
        `override fun getJSBundleFile(): String? {
        val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
        val bundlePath = prefs.getString("BundlePath", null)
        if (bundlePath != null && File(bundlePath).exists()) {
          return bundlePath
        }
        return null
      }

      override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

function withOTAUpdateIOS(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('OTAUpdateBundlePath')) {
      return config;
    }

    // For Swift AppDelegate
    if (config.modResults.language === 'swift') {
      // Add helper function before the class closing brace
      const helperFunction = `
  // OTA Update: Check for downloaded bundle
  private func getOTABundleURL() -> URL? {
    let defaults = UserDefaults.standard
    if let bundlePath = defaults.string(forKey: "OTAUpdateBundlePath") {
      let fileURL = URL(fileURLWithPath: bundlePath)
      if FileManager.default.fileExists(atPath: bundlePath) {
        return fileURL
      }
    }
    return nil
  }
`;

      // Find bundleURL method and modify it
      const bundleURLPattern = /func\s+bundleURL\(\)\s*->\s*URL\?\s*\{[\s\S]*?\n\s*\}/;

      if (bundleURLPattern.test(contents)) {
        contents = contents.replace(
          bundleURLPattern,
          `func bundleURL() -> URL? {
    // OTA Update: Check for downloaded bundle first
    if let otaBundle = getOTABundleURL() {
      return otaBundle
    }
    #if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
${helperFunction}`
        );
      }
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withOTAUpdate(config) {
  config = withOTAUpdateAndroid(config);
  config = withOTAUpdateIOS(config);
  return config;
};
