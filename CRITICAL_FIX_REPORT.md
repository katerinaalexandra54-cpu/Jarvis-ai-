# JARVIS critical wake-word and messaging update

## Root cause of the reported bad ELF

The checked-in `android-bridge/jniLibs` binaries were not Git LFS pointers or text files. They match the official sherpa-onnx v1.13.8 Android release exactly and are valid Android ELF shared objects for all four ABIs. The earlier source-level checks did not inspect a built APK, and the previously published APK was therefore not proven to contain these exact files.

The build path has now been made authoritative and reproducible:

- `android-bridge/jniLibs` is the single native-library source of truth.
- `scripts/setup-android.mjs` deletes the generated `android/app/src/main/jniLibs` directory before copying the verified source tree, preventing stale overrides.
- `scripts/verify-android-native.mjs` checks ELF magic, ELF class, and machine type for `libonnxruntime.so` and all Sherpa libraries across `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64`.
- CI verifies source/generated copies before Gradle, both unsigned APKs after Gradle, and the final signed release APK before upload.

The first actual build also exposed and fixed a missing `OnlineModelConfig` import in `JarvisWakeService`; this had not been caught by the JavaScript tests.

## Actual APK verification

A clean build was completed with Android API 34, build-tools 34.0.0, and JDK 17.

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Unsigned release APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
- Both passed direct APK extraction checks for every required ABI.
- The direct debug APK entry `lib/arm64-v8a/libonnxruntime.so` was reported as a real ELF 64-bit ARM aarch64 shared object.
- `lib/arm64-v8a/libsherpa-onnx-jni.so` was also reported as a real ELF 64-bit ARM aarch64 shared object.

Hashes from this build:

```text
1428867e342e0aa5ad8a50ab2ed39a490ef4314aa3e6a29c89dbf12237b834c4  debug APK
bbcb95d74fabbf2e9d651710bfb7b4d577bfd94dcff10b60639738fd6cd47f90  unsigned release APK
```

The release APK is unsigned in this sandbox because signing credentials are not available here. Existing CI signing configuration was preserved.

## Wake fallback

Sherpa-ONNX remains primary. If Sherpa native loading, model initialization, or stream creation fails, the foreground service now attempts a constrained offline Vosk recognizer using the bundled Vosk model and the grammar `hey jarvis`, `jarvis`, and `[unk]`. It uses the same microphone foreground-service path, has guarded cleanup, logs the fallback mode internally, and transitions through the existing wake flow when the phrase is recognized. If both engines fail, the service reports the real failure and stops safely.

This fallback is a resilience path, not a claim that Sherpa is initialized successfully on a physical device.

## Universal MessagingAgent

The generic active-app accessibility MessagingAgent remains in place. It supports bounded explicit reads of visible non-password nodes, scroll-and-read, confirmed reply composition, visible Send-control activation, and honest open-only fallbacks. An opt-in `JarvisNotificationListenerService` has also been registered. Android notification access remains a manual user setting; content capture is disabled by default and is not uploaded or silently monitored.

## Validation

- `npm run android:sync`: passed
- `npm test`: **70 passed, 0 failed**
- `npm run build`: passed
- Clean Android debug/release Gradle build: passed
- Direct APK ELF verification: passed for both APKs and all four ABIs
- Physical Android 9 arm64 install and runtime test: not available in this sandbox; the APK must still be installed on the reported device to confirm dynamic loading, Sherpa initialization, microphone behavior, Vosk fallback, and real messaging-app accessibility.
