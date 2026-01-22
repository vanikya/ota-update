#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(OTAUpdate, NSObject)

// File System Operations
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getDocumentDirectory)

RCT_EXTERN_METHOD(writeFile:(NSString *)path
                  content:(NSString *)content
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(writeFileBase64:(NSString *)path
                  base64Content:(NSString *)base64Content
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(readFile:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(readFileBase64:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(deleteFile:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(exists:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(makeDirectory:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(downloadFile:(NSString *)urlString
                  destPath:(NSString *)destPath
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

// Cryptography
RCT_EXTERN_METHOD(calculateSHA256:(NSString *)base64Content
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(calculateSHA256FromFile:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(verifySignature:(NSString *)base64Content
                  signatureHex:(NSString *)signatureHex
                  publicKeyHex:(NSString *)publicKeyHex
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

// Bundle Application
RCT_EXTERN_METHOD(applyBundle:(NSString *)bundlePath
                  restart:(BOOL)restart
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(getPendingBundlePath:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(clearPendingBundle:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

@end
