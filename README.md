# JARVIS (Android)

Voice assistant app: talk to Jarvis, it answers out loud and controls your phone (alarms, timers, open apps,
screenshots, Home/Back/Recents, flashlight, calls, read and send texts) after you grant permissions.
Chat, summarizer, image generator, translator, calculator and document analysis run on OpenRouter.

## Run in a browser (design + chat testing)
    npm ci
    npm run dev

Phone actions only work inside the Android app. Voice input in a browser needs Chrome.

## Build the APK on GitHub
Push this folder to a repo. `.github/workflows/build-apk.yml` runs on every push to `main`:
it builds the web app, creates the Android project, installs the Jarvis phone plugin, icons and permissions
(`scripts/setup-android.mjs`), builds debug and release APKs, signs the release with the existing
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD` Actions secrets, then uploads
`jarvis-debug-apk` and `jarvis-signed-release-apk` under Actions > the run > Artifacts. Also configure
the `VITE_API` repository variable with the deployed server URL. Secret values are never stored in source.
Release `versionCode` is `10000 +` the GitHub workflow run number, so subsequent runs increase it; if an
already published build has a greater version code, raise the workflow's starting offset before updating it.

## Build locally
    npm ci
    VITE_API=https://YOUR-SERVER npm run build
    npx cap add android
    npm run android:setup
    npx cap sync android
    cd android && ./gradlew assembleDebug

## First run on the phone
1. Create an account (stored on the phone).
2. Ask JARVIS anything. In a server-backed build it asks for your server access code once. Direct OpenRouter-key entry is developer-build-only.
3. Settings > Phone Control: tap Allow permissions, then Turn on Accessibility and enable Jarvis
   (needed for screenshots, Home, Back, Recents).

## Logo
`public/assets/jarvis-mark.jpg` is the in-app logo. Launcher icons and splash are generated into
`android-bridge/res` and copied by the setup script. Replace the jpg with a higher-resolution file and re-run
the icon step to sharpen them.


## How the JARVIS brain works
```
Mic -> speech recognition -> brain (src/lib/brain) -> AI provider -> tool call -> Android plugin -> result -> AI -> reply -> speech
```
- `src/lib/providers/` AI provider layer. Only `openrouter.js` knows OpenRouter (direct, developer builds). Production builds use `backend.js`, and the server's `server/providers/` adapters talk to the AI vendor.
- `src/lib/brain/systemPrompt.js` JARVIS personality and the honesty rules.
- `src/lib/brain/tools.js` the only things the AI may do (explicit tools, validated arguments, no code execution).
- `src/lib/brain/agent.js` the loop: AI -> tools -> results -> AI. `router.js` labels each request (conversation / information / action / multi_step) and caps the steps. `memory.js` keeps the short-term context.
- Native tools live in `android-bridge/java/JarvisPhonePlugin.java` (setTorch, getVolume/setVolume, getBattery, getDeviceInfo, mediaControl, plus the original methods).

## Security model (production)
- **No AI key on the phone.** The key lives only on the server (`server/`). Release builds refuse to run without `VITE_API`, and any key saved by an older build is erased on launch.
- The app gets a signed, expiring (90-day) device token by entering an access code once. The server rate-limits, applies a per-device daily quota, restricts models, and can block a device. See `DEPLOY.md`.
- Developer builds (`npm run dev`, or `VITE_ALLOW_DIRECT=true`) can still paste an OpenRouter key into the app. Never ship those.
- Switching provider is a server change (`AI_PROVIDER`, see `server/providers/`), not an app update.

## Live information
Weather (Open-Meteo), Wikipedia lookups and news headlines (Google News RSS) are tools the AI can call. Check each service's terms before a commercial launch: Open-Meteo's free API is for non-commercial use, and the news feed has no formal API terms. They are isolated in `brain/tools.js` so each can be swapped for a paid API.

## Wake word
"Hey JARVIS" uses the free, open-source sherpa-onnx open-vocabulary keyword spotter in
`JarvisWakeService.java`. It runs locally in an Android foreground microphone service with a visible
low-importance notification; no API key, account, cloud service, company email, or credit card is needed.
The bundled English `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` model is a general English KWS
model, not a model trained specifically for JARVIS. Its runtime keyword file contains `HEY JARVIS` with
a conservative `#0.55` trigger threshold and one CPU thread. This is a practical open-vocabulary attempt,
not a guarantee of wake-word accuracy or low false-trigger rate.

The Android integration includes the official v1.13.8 prebuilt native libraries for arm64-v8a,
armeabi-v7a, x86, and x86_64. An Android SDK/NDK and a successful Gradle build are required before
shipping. Screen-off behavior, OEM battery restrictions, CPU use, false activations, and missed detections
must be measured on real devices. The service is intentionally not sticky after process death because
Android restricts background microphone-service restarts.

If the open-vocabulary model is not accurate enough, the supported open-source option is to fine-tune
the English PyTorch KWS base model with varied positive “Hey JARVIS” recordings and hard-negative/noise
recordings, export it to ONNX, regenerate the keyword/model assets, and repeat device testing. No such
custom-trained model is claimed or included here.

## Offline speech recognition (Vosk)
The Android build also bundles `com.alphacephei:vosk-android:0.3.75` and the official Apache-2.0
`vosk-model-small-en-us-0.15` model (about 68 MB unpacked). In Settings > Voice & Speech, enable
**Use offline speech recognition** to recognize English (US) commands on-device. The recognized command
still goes to the protected JARVIS backend for reasoning; no continuous ambient audio is uploaded.
For other selected languages, the app falls back to the existing Android recognizer because the bundled
model is US English only. The model is copied from APK assets to app-private storage on first use and
released with the native plugin.

Vosk is used for opt-in offline command recognition after wake-up. It remains separate from sherpa-onnx:
sherpa-onnx detects the wake phrase, then the existing assistant flow listens for the command with Vosk
when offline recognition is enabled and sends only the recognized command to the protected AI backend.

## Tests
`npm test` runs the automated suite. See `TEST_PLAN.md` for the manual phone checklist.
