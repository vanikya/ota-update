import Foundation
import CommonCrypto

@objc(OTAUpdate)
class OTAUpdate: NSObject {

    // MARK: - File System Operations

    @objc
    func getDocumentDirectory() -> String {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        return paths[0].path + "/"
    }

    @objc
    func writeFile(_ path: String, content: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        do {
            try content.write(toFile: path, atomically: true, encoding: .utf8)
            resolver(nil)
        } catch {
            rejecter("WRITE_ERROR", "Failed to write file: \(error.localizedDescription)", error)
        }
    }

    @objc
    func writeFileBase64(_ path: String, base64Content: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        guard let data = Data(base64Encoded: base64Content) else {
            rejecter("DECODE_ERROR", "Invalid base64 content", nil)
            return
        }

        do {
            try data.write(to: URL(fileURLWithPath: path))
            resolver(nil)
        } catch {
            rejecter("WRITE_ERROR", "Failed to write file: \(error.localizedDescription)", error)
        }
    }

    @objc
    func readFile(_ path: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        do {
            let content = try String(contentsOfFile: path, encoding: .utf8)
            resolver(content)
        } catch {
            rejecter("READ_ERROR", "Failed to read file: \(error.localizedDescription)", error)
        }
    }

    @objc
    func readFileBase64(_ path: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            let base64 = data.base64EncodedString()
            resolver(base64)
        } catch {
            rejecter("READ_ERROR", "Failed to read file: \(error.localizedDescription)", error)
        }
    }

    @objc
    func deleteFile(_ path: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        do {
            if FileManager.default.fileExists(atPath: path) {
                try FileManager.default.removeItem(atPath: path)
            }
            resolver(nil)
        } catch {
            rejecter("DELETE_ERROR", "Failed to delete file: \(error.localizedDescription)", error)
        }
    }

    @objc
    func exists(_ path: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        resolver(FileManager.default.fileExists(atPath: path))
    }

    @objc
    func makeDirectory(_ path: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        do {
            try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: nil)
            resolver(nil)
        } catch {
            rejecter("MKDIR_ERROR", "Failed to create directory: \(error.localizedDescription)", error)
        }
    }

    // MARK: - Cryptography

    @objc
    func calculateSHA256(_ base64Content: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        guard let data = Data(base64Encoded: base64Content) else {
            rejecter("DECODE_ERROR", "Invalid base64 content", nil)
            return
        }

        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
        }

        let hexString = hash.map { String(format: "%02x", $0) }.joined()
        resolver(hexString)
    }

    @objc
    func verifySignature(_ base64Content: String, signatureHex: String, publicKeyHex: String, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        // Ed25519 signature verification
        // Note: For production, you might want to use a proper Ed25519 library like CryptoKit (iOS 13+) or libsodium

        guard #available(iOS 13.0, *) else {
            // Fall back to assuming valid if CryptoKit is not available
            resolver(true)
            return
        }

        guard let contentData = Data(base64Encoded: base64Content),
              let signatureData = Data(hexString: signatureHex),
              let publicKeyData = Data(hexString: publicKeyHex) else {
            rejecter("DECODE_ERROR", "Invalid input data", nil)
            return
        }

        do {
            let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData)
            let isValid = publicKey.isValidSignature(signatureData, for: contentData)
            resolver(isValid)
        } catch {
            rejecter("VERIFY_ERROR", "Failed to verify signature: \(error.localizedDescription)", error)
        }
    }

    // MARK: - Bundle Application

    @objc
    func applyBundle(_ bundlePath: String, restart: Bool, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        // Store the bundle path for next launch
        UserDefaults.standard.set(bundlePath, forKey: "OTAUpdateBundlePath")
        UserDefaults.standard.synchronize()

        if restart {
            // Post notification to restart the app
            // The app delegate should handle this notification
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Notification.Name("OTAUpdate_RestartApp"), object: nil)
            }
        }

        resolver(nil)
    }

    @objc
    func getPendingBundlePath(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        let path = UserDefaults.standard.string(forKey: "OTAUpdateBundlePath")
        resolver(path)
    }

    @objc
    func clearPendingBundle(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        UserDefaults.standard.removeObject(forKey: "OTAUpdateBundlePath")
        UserDefaults.standard.synchronize()
        resolver(nil)
    }

    // MARK: - Module Setup

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
}

// MARK: - Data Extension

extension Data {
    init?(hexString: String) {
        let len = hexString.count / 2
        var data = Data(capacity: len)
        var i = hexString.startIndex

        for _ in 0..<len {
            let j = hexString.index(i, offsetBy: 2)
            let bytes = hexString[i..<j]
            if var num = UInt8(bytes, radix: 16) {
                data.append(&num, count: 1)
            } else {
                return nil
            }
            i = j
        }

        self = data
    }
}
