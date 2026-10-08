# JARVIS runtime-fix report

## Current status

The current final debug and unsigned release APKs were clean-built after the fixes below. The sandbox has no attached Android device, so real Android 9 runtime installation and WhatsApp testing could not be performed here.

## Vosk failure

### Root cause addressed

The previous code used only `am/final.mdl` as an extraction marker. If an earlier extraction was interrupted, that one file could exist while the remaining model was incomplete; subsequent launches skipped extraction and Vosk failed with `Failed to create a model`.

### Fix

Added `android-bridge/java/JarvisVoskModel.java`, used by both `JarvisPhonePlugin` and `JarvisWakeService`:

- Copies to `vosk-model-small-en-us-0.15.staging`.
- Validates all required acoustic, graph, configuration, and ivector files.
- Requires every file to be non-empty.
- Atomically renames the staging directory into the runtime files directory.
- Writes `.complete` only after validation succeeds.
- Deletes incomplete/stale installations before retrying.
- Reports the exact runtime path, directory existence, required-file sizes, and Model initialization error.

Runtime model path:

```text
<application files directory>/vosk-model-small-en-us-0.15
```

The final APK contains the complete model under:

```text
assets/vosk-model-small-en-us-0.15/
```

All APK model-file hashes match the source assets exactly. The model is a real Vosk model: `final.mdl` is binary data and `graph/Gr.fst` is a valid OpenFst binary FST, not a Git LFS pointer, HTML page, ZIP, or empty file.

## Sherpa/ONNX ELF failure

The current final APK was inspected directly. For `arm64-v8a`, `libonnxruntime.so`, `libsherpa-onnx-c-api.so`, `libsherpa-onnx-cxx-api.so`, and `libsherpa-onnx-jni.so` all begin with ELF magic `7f 45 4c 46`, are ARM64 ELF shared libraries, and match the official sherpa-onnx v1.13.8 Android release hashes.

All required Sherpa libraries pass verification for:

- `arm64-v8a`
- `armeabi-v7a`
- `x86`
- `x86_64`

The build now deletes stale generated JNI directories before copying the authoritative bridge binaries and verifies the actual APK contents after Gradle. The earlier reported bad-ELF APK was not the current verified artifact; it must not be reused for testing.

## Messaging and WhatsApp behavior

`messagingSnapshot` now waits up to three seconds for the target app's accessibility tree after opening, avoiding the common WhatsApp startup race. It recursively inspects visible, non-password nodes and returns text, content descriptions, class names, resource IDs, clickable state, scrollable state, package name, and node count.

The service still cannot read content that WhatsApp or another app does not expose through Android Accessibility. In that case it reports the real limitation rather than inventing a message.

The notification listener is complementary and opt-in. Android requires the user to manually grant notification access. An explicit preview request reads active notifications and returns app package, title/sender, text preview, and timestamp. It does not silently monitor or upload notifications and does not read password/security fields.

Confirmed replies still require a real visible input and Send control; JARVIS never reports sent unless the accessibility action succeeds.

## Voice pipeline

- Primary wake detector: Sherpa-ONNX.
- Controlled fallback: constrained Vosk wake recognizer using the same validated model.
- Offline command recognition: Vosk.
- Response: existing JARVIS TTS.
- Foreground microphone service and Android permission declarations preserved.

A real device is still required to verify wake sensitivity, microphone permissions, Android 9 service behavior, Vosk recognition quality, and TTS output.

## Validation

- `npm run android:sync`: passed
- `npm test`: **70 passed, 0 failed**
- `npm run build`: passed
- Clean `assembleDebug assembleRelease`: passed
- Final APK native ELF verification: passed for all four ABIs
- Final APK Vosk model hash comparison: passed
- Package ID: `com.you.jarvis`
- Attached Android devices in sandbox: none
- Real Android 9 ARM64 runtime test: not possible from this environment

## Final APKs

The final debug APK is installable and intended for device testing. The release APK is unsigned in this sandbox; the existing protected CI signing workflow remains unchanged.
