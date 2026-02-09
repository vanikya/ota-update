package com.otaupdate

import android.content.Context
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.ViewManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

/**
 * OTAUpdatePackage implements both React Native's ReactPackage and Expo's Package interfaces.
 *
 * The Expo Package interface is critical for bundle loading with Expo's new architecture.
 * It provides ReactNativeHostHandler which allows us to override:
 * - getJSBundleFile: Returns path to downloaded OTA bundle
 * - getBundleAssetName: Returns null when OTA bundle exists to force using getJSBundleFile
 */
class OTAUpdatePackage : ReactPackage, Package {

    companion object {
        private const val TAG = "OTAUpdatePackage"
    }

    // ReactPackage implementation
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(OTAUpdateModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }

    // Expo Package implementation - this is the key for Expo new architecture support
    override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> {
        Log.d(TAG, "=== createReactNativeHostHandlers called ===")

        val handler = object : ReactNativeHostHandler {

            override fun getJSBundleFile(useDeveloperSupport: Boolean): String? {
                Log.d(TAG, "=== getJSBundleFile called (useDeveloperSupport=$useDeveloperSupport) ===")

                // In development mode, let Metro bundler handle it
                if (useDeveloperSupport) {
                    Log.d(TAG, "Developer support enabled, returning null")
                    return null
                }

                // Get the bundle path from OTAUpdateHelper
                val bundlePath = OTAUpdateHelper.getJSBundleFile(context)
                Log.d(TAG, "OTAUpdateHelper returned bundle path: $bundlePath")
                return bundlePath
            }

            override fun getBundleAssetName(useDeveloperSupport: Boolean): String? {
                Log.d(TAG, "=== getBundleAssetName called (useDeveloperSupport=$useDeveloperSupport) ===")

                // In development mode, use default behavior
                if (useDeveloperSupport) {
                    Log.d(TAG, "Developer support enabled, returning null (use default)")
                    return null
                }

                // Check if we have an OTA bundle
                val bundlePath = OTAUpdateHelper.getJSBundleFile(context)
                if (bundlePath != null) {
                    // Return null to force React Native to use getJSBundleFile instead of bundled assets
                    Log.d(TAG, "OTA bundle exists at $bundlePath, returning null to force getJSBundleFile")
                    return null
                }

                // No OTA bundle, use default bundled assets
                Log.d(TAG, "No OTA bundle, returning null (use default bundled assets)")
                return null
            }

            override fun onWillCreateReactInstance(useDeveloperSupport: Boolean) {
                Log.d(TAG, "=== onWillCreateReactInstance called (useDeveloperSupport=$useDeveloperSupport) ===")
            }

            override fun onDidCreateReactInstance(useDeveloperSupport: Boolean, reactContext: ReactContext) {
                Log.d(TAG, "=== onDidCreateReactInstance called ===")
            }

            override fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {
                Log.e(TAG, "=== onReactInstanceException called ===", exception)
                // If there's an exception with OTA bundle, we could clear it here
                // For now, just log the exception
            }
        }

        Log.d(TAG, "Returning ReactNativeHostHandler")
        return listOf(handler)
    }
}
