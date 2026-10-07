# Sherpa-ONNX wake-word crash fix

## Root cause

The wake service had an unsafe startup boundary:

1. `JarvisWakeService.onStartCommand()` called `showForeground()` **before** checking microphone/notification permission and outside any recovery `try` block. Android can throw `SecurityException` from `startForeground()` for missing/invalid foreground-service permissions, an invalid microphone-service start, or a background-start policy violation. That exception escaped the service lifecycle and could terminate the app process.
2. Sherpa-ONNX initialization caught only `Exception`. Native loading failures such as `UnsatisfiedLinkError` are `Error`, not `Exception`, so a missing/incompatible ABI or transitive JNI dependency could also escape and crash the process.
3. The old service released `OnlineStream`/`KeywordSpotter` while the audio thread could still be inside native decoding. A rapid pause/restart could therefore use freed native memory and crash intermittently.
4. The microphone source was `VOICE_RECOGNITION`; the official sherpa-onnx Android sample uses `MIC`, which is more broadly supported across Android devices.

The bundled model paths and keyword asset were present and structurally valid. The ABI set contained matching native libraries for all packaged ABIs, but the old code did not explicitly load the native dependency chain or report linker failures safely.

## Exact fix

- Validate `RECORD_AUDIO` and Android 13+ notification permission before foreground startup.
- Wrap service startup and Sherpa/native initialization in `catch (Throwable)` and convert failures into a listener error, foreground cleanup, and `stopSelf()` rather than process termination.
- Explicitly load `libonnxruntime.so`, `libsherpa-onnx-c-api.so`, `libsherpa-onnx-cxx-api.so`, then `libsherpa-onnx-jni.so` for older Android linker namespaces.
- Use `MediaRecorder.AudioSource.MIC`, matching the official sherpa-onnx sample.
- Stop/release the microphone and join the previous audio thread before releasing native stream/spotter objects.
- Keep Sherpa-ONNX wake detection enabled and keep Vosk unchanged for offline command recognition.
- Added regression assertions for permission ordering, `Throwable` handling, dependency loading, microphone source, and cleanup.

## Files changed

- `android-bridge/java/JarvisWakeService.java`
- Generated `android/app/src/main/java/com/you/jarvis/JarvisWakeService.java`
- `tests/wake-config.test.mjs`
- Generated Android assets/native files are refreshed by `npm run android:sync`.

## Validation

- `npm run android:sync`: passed.
- `npm test`: **62 passed, 0 failed**.
- `npm run build`: passed.
- Android Gradle APK build: not available in this sandbox because no Android SDK is installed/configured (`ANDROID_HOME`/`ANDROID_SDK_ROOT` absent; Gradle reports `SDK location not found`).
- Real-device crash reproduction/verification: not available in this sandbox.

The wake feature remains implemented and enabled after the fix, but it cannot honestly be called fully functional until a physical Android device confirms startup, wake detection, permission-denial behavior, older Android compatibility, screen-off behavior, and battery/false-trigger performance.
