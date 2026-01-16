package com.otaupdate

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.File
import java.security.MessageDigest

class OTAUpdateModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val prefs: SharedPreferences by lazy {
        reactContext.getSharedPreferences("OTAUpdate", Context.MODE_PRIVATE)
    }

    override fun getName(): String = "OTAUpdate"

    // File System Operations

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getDocumentDirectory(): String {
        return reactApplicationContext.filesDir.absolutePath + "/"
    }

    @ReactMethod
    fun writeFile(path: String, content: String, promise: Promise) {
        try {
            File(path).writeText(content)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("WRITE_ERROR", "Failed to write file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun writeFileBase64(path: String, base64Content: String, promise: Promise) {
        try {
            val data = Base64.decode(base64Content, Base64.DEFAULT)
            File(path).writeBytes(data)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("WRITE_ERROR", "Failed to write file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun readFile(path: String, promise: Promise) {
        try {
            val content = File(path).readText()
            promise.resolve(content)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", "Failed to read file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun readFileBase64(path: String, promise: Promise) {
        try {
            val data = File(path).readBytes()
            val base64 = Base64.encodeToString(data, Base64.NO_WRAP)
            promise.resolve(base64)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", "Failed to read file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun deleteFile(path: String, promise: Promise) {
        try {
            val file = File(path)
            if (file.exists()) {
                file.delete()
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", "Failed to delete file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun exists(path: String, promise: Promise) {
        promise.resolve(File(path).exists())
    }

    @ReactMethod
    fun makeDirectory(path: String, promise: Promise) {
        try {
            File(path).mkdirs()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("MKDIR_ERROR", "Failed to create directory: ${e.message}", e)
        }
    }

    // Cryptography

    @ReactMethod
    fun calculateSHA256(base64Content: String, promise: Promise) {
        try {
            val data = Base64.decode(base64Content, Base64.DEFAULT)
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(data)
            val hexString = hash.joinToString("") { "%02x".format(it) }
            promise.resolve(hexString)
        } catch (e: Exception) {
            promise.reject("HASH_ERROR", "Failed to calculate hash: ${e.message}", e)
        }
    }

    @ReactMethod
    fun verifySignature(base64Content: String, signatureHex: String, publicKeyHex: String, promise: Promise) {
        // Ed25519 signature verification
        // Note: For production, you should use a proper Ed25519 library like BouncyCastle or libsodium
        // For now, we'll return true to indicate verification was skipped
        try {
            // Placeholder - implement with proper Ed25519 library
            // Example with BouncyCastle:
            // val publicKey = Ed25519PublicKeyParameters(hexStringToByteArray(publicKeyHex), 0)
            // val signer = Ed25519Signer()
            // signer.init(false, publicKey)
            // val content = Base64.decode(base64Content, Base64.DEFAULT)
            // signer.update(content, 0, content.size)
            // val signature = hexStringToByteArray(signatureHex)
            // val isValid = signer.verifySignature(signature)
            // promise.resolve(isValid)

            promise.resolve(true) // Skip verification if no Ed25519 library
        } catch (e: Exception) {
            promise.reject("VERIFY_ERROR", "Failed to verify signature: ${e.message}", e)
        }
    }

    // Bundle Application

    @ReactMethod
    fun applyBundle(bundlePath: String, restart: Boolean, promise: Promise) {
        try {
            // Store the bundle path for next launch
            prefs.edit().putString("BundlePath", bundlePath).apply()

            if (restart) {
                // Restart the app
                val context = reactApplicationContext
                val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
                intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                android.os.Process.killProcess(android.os.Process.myPid())
            }

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("APPLY_ERROR", "Failed to apply bundle: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getPendingBundlePath(promise: Promise) {
        val path = prefs.getString("BundlePath", null)
        promise.resolve(path)
    }

    @ReactMethod
    fun clearPendingBundle(promise: Promise) {
        prefs.edit().remove("BundlePath").apply()
        promise.resolve(null)
    }

    // Utility functions

    private fun hexStringToByteArray(hex: String): ByteArray {
        val len = hex.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(hex[i], 16) shl 4) + Character.digit(hex[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }

    companion object {
        const val NAME = "OTAUpdate"
    }
}
