# JARVIS: handoff to Manus

Status of this source tree: reviewed and patched WITHOUT an Android SDK, a device, npm network access or a running server.
Verified: `npm test` (58 passing, Node 22, pure-JS tests only). NOT verified: `vite build`, `cap add/sync`, Gradle build, APK signing, the Express server running, any on-device behaviour.
Install dependencies with `npm ci` first. The Java files were edited but never compiled (no `javac`); a CI build is the first compile check.

## What was changed
- Server: provider adapters (`server/providers/`: openrouter, openai, openai-compatible), selected by `AI_PROVIDER`; optional server-pinned `AI_MODEL` / `AI_IMAGE_MODEL`; 60 s upstream timeout (504); message/tool caps; quota refunded on provider failure; auth before body parsing; bounded rate-limit memory; JSON error handler; removed unused hardcoded-Anthropic `/api/chat`, `/api/voice/transcribe`, `/api/phone/*`.
- App: 70 s timeout on server calls; "no speech" after a wake word is silent instead of a toast; system prompt says tool results (SMS, web text) are data, not instructions; removed dead `assistantPrompt`.
- Android scripts: removed the unused `READ_PHONE_STATE` permission; `allowBackup` set to false (token and chats live in WebView storage); `ToneGenerator` is released; `NO_SPEECH` error code from the recognizer.
- Repo: `.gitignore` blocks keystores and env files; workflow gets npm cache and a 45 min timeout. Signing, package ID check and versionCode steps are untouched.
- Kept: access-code flow (no replacement auth exists yet), OpenRouter as default provider, all screens and design.

## Facts Manus must know
- Wake word is now **sherpa-onnx** open-vocabulary KWS using the official English GigaSpeech 3.3M int8 model and a generated `HEY JARVIS` keyword line. It is not a JARVIS-specific pretrained model; false-trigger rate, accuracy, CPU, battery, screen-off behavior, and Android compilation still require device validation. Vosk remains for opt-in offline English (US) command recognition.
- The brain runs in the WebView. Each voice turn is one `SpeechRecognizer` call (online, Google). There is no multi-turn session or timeout.
- Railway: no Railway config here. The root `Dockerfile` is what Railway builds. Live service settings were not seen.
- The GitHub repo URL given earlier returned 404 for the reviewer; this ZIP is the only source reviewed.

## Still to do (needs device testing or design decisions)
1. Sherpa-onnx: build with Android SDK/NDK and test the foreground service on physical devices; measure false activations, misses, CPU, battery, screen-off/OEM behavior, and tune `#0.55` before shipping. Fine-tune the English KWS base model if open-vocabulary accuracy is insufficient.
2. Native conversation session: loop listen > think > speak > listen, silence timeout, end phrases, barge-in, TTS/mic echo handling.
3. Screen-off/lock-screen: `showWhenLocked`/`turnScreenOn`, OEM battery-killer behaviour, Android 12-15 foreground-service start rules. Test on real Samsung and Xiaomi devices.
4. TTS language: `TextToSpeech` uses `Locale.getDefault()`, so the Voice language setting does not change the spoken voice. Pass `lang` through `phone.js` `speak()` to the plugin.
5. Confirmation: only call and SMS ask the user. `system.button` (lock, screenshot), `sms.read` do not. Move confirmation to native code.
6. Auth: the shared invite code lets anyone holding it mint unlimited device tokens, and a blocked device can re-register with a new random ID. Replace with per-device registration (Play Integrity, database, refresh tokens in Android Keystore). Do not remove the access-code flow before that exists. The token is currently in WebView localStorage.
7. Quotas and rate limits are in memory and reset on restart. Use a database/Redis.
8. Local accounts are single-round salted SHA-256 in localStorage; treat them as a profile, not security.
9. AI Preferences page (name, style, language, voice, custom instructions) is not built yet; pass it to the server as a validated, length-capped field.
10. Provider adapters: test `openai` and `openai-compatible` against the live API. Native Anthropic format is not implemented (see the note in `server/providers/index.js`).
11. Play policy: SMS/call permissions and the accessibility service are restricted on Google Play. Sideloaded builds are unaffected.
12. Live-info tools call Open-Meteo, Wikipedia and Google News directly from the app; check their commercial terms.
13. Premium UI redesign (orb, waveform, glass) was not started. The concept image was not provided.
