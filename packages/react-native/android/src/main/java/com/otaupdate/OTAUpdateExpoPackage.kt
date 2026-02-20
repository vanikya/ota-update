package com.otaupdate

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.ReactContext
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

/**
 * Expo Package implementation that provides ReactNativeHostHandler.
 * This is the key integration point for Expo's new architecture (bridgeless mode).
 *
 * In Expo's new architecture, bundle loading doesn't go through DefaultReactNativeHost.getJSBundleFile().
 * Instead, Expo's core scans for packages implementing this interface and calls the handlers.
 *
 * This is exactly how expo-updates works.
 */
class OTAUpdateExpoPackage : Package {

    companion object {
        private const val TAG = "OTAUpdateExpoPackage"
    }

    override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> {
        Log.d(TAG, "=== createReactNativeHostHandlers called ===")

        val handler = object : ReactNativeHostHandler {

            override fun getJSBundleFile(useDeveloperSupport: Boolean): String? {
                Log.d(TAG, "=== getJSBundleFile called (useDeveloperSupport=$useDeveloperSupport) ===")

                // In development mode, let Metro bundler handle it
                if (useDeveloperSupport) {
                    Log.d(TAG, "Developer support enabled, using Metro bundler")
                    return null
                }

                // Get the bundle path from OTAUpdateHelper
                val bundlePath = OTAUpdateHelper.getJSBundleFile(context)
                if (bundlePath != null) {
                    Log.d(TAG, "Returning OTA bundle: $bundlePath")
                } else {
                    Log.d(TAG, "No OTA bundle, using default")
                }
                return bundlePath
            }

            override fun getBundleAssetName(useDeveloperSupport: Boolean): String? {
                Log.d(TAG, "=== getBundleAssetName called (useDeveloperSupport=$useDeveloperSupport) ===")

                // In development mode, use default behavior
                if (useDeveloperSupport) {
                    return null
                }

                // Check if we have an OTA bundle
                val bundlePath = OTAUpdateHelper.getJSBundleFile(context)
                if (bundlePath != null) {
                    // Return null to force React Native to use getJSBundleFile() instead of bundled assets
                    Log.d(TAG, "OTA bundle exists, returning null to force getJSBundleFile")
                    return null
                }

                // No OTA bundle, use default bundled assets
                return null
            }

            override fun onWillCreateReactInstance(useDeveloperSupport: Boolean) {
                Log.d(TAG, "=== onWillCreateReactInstance (useDeveloperSupport=$useDeveloperSupport) ===")
            }

            override fun onDidCreateReactInstance(useDeveloperSupport: Boolean, reactContext: ReactContext) {
                Log.d(TAG, "=== onDidCreateReactInstance ===")
            }

            override fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {
                Log.e(TAG, "=== onReactInstanceException ===", exception)
                // If there's an exception with OTA bundle, we could clear it here for recovery
                // For now, just log it
            }
        }

        Log.d(TAG, "Returning ReactNativeHostHandler")
        return listOf(handler)
    }
}
