# JARVIS sherpa-onnx wake-word update

## Implementation

- Replaced the Porcupine Android wake service and AccessKey flow with the free, open-source **sherpa-onnx** Java API and official Android JNI libraries.
- Bundled the official English `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` int8 model for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64`.
- Configured the runtime keyword file for `HEY JARVIS`, a conservative `#0.55` threshold, one CPU thread, and CPU provider.
- Kept Vosk as the opt-in offline command recognizer after wake-up. The existing AI backend, text-to-speech, UI, language settings, phone controls, protected access-code flow, Railway configuration, package ID `com.you.jarvis`, and signing configuration are preserved.
- Wake listening uses Android microphone permissions, a microphone foreground-service type, notification permission handling, a visible low-importance notification, cleanup on pause/stop/destroy, and a cooldown against repeated activations.
- The service is deliberately not sticky after process death. Android/OEM policies may prevent reliable screen-off or post-reboot operation.

## Model limitation

The bundled model is an open-vocabulary English KWS model trained from GigaSpeech data; it is **not** a pretrained model specifically trained for JARVIS. Sherpa-onnx supports runtime keyword customization, but accuracy, false triggers, CPU, battery, screen-off behavior, and microphone-service policy must be measured on real phones. If accuracy is insufficient, fine-tune the open English KWS base model using varied positive “Hey JARVIS” recordings plus hard negatives/noise, export to ONNX, replace the model assets, and repeat device testing.

No paid API, company email, credit card, cloud wake service, or API key is required.

## Setup

1. Install an Android SDK/NDK and configure `ANDROID_HOME` or `android/local.properties`.
2. Run `npm ci`.
3. Run `npm run android:sync`.
4. Build with `cd android && ./gradlew assembleDebug` or the project’s release/signing task.
5. Install on a physical device, grant Microphone and Notifications permissions, enable the wake word in Voice & Speech, and run the W1–W12 checklist in `TEST_PLAN.md`.

## Validation in this sandbox

- `npm test`: **61 passed, 0 failed**.
- `npm run build`: **passed**.
- `npm run android:sync`: **passed**; generated package remains `com.you.jarvis`.
- Android Gradle build: **not completed**. The sandbox has Java 21 but no Android SDK (`SDK location not found`; no `ANDROID_HOME`/`ANDROID_SDK_ROOT` and no `sdkmanager`/`adb`).
- Real-device testing: **not performed** in this sandbox. Do not claim wake-word reliability, screen-off operation, battery performance, or absence of false activations until the physical-device checklist is completed.
