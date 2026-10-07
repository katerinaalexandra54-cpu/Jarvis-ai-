# JARVIS phone-agent update

## Architecture

The existing provider-neutral tool registry remains the command layer. The AI can call only declared tools, the tool executor validates arguments, and `src/lib/phone.js` maps actions to the native Capacitor bridge. Native Android code performs the actual operation and returns success or a plain-English failure. The assistant never treats a failed native result as success.

The user-controlled Android AccessibilityService now exposes three explicit primitives: scrolling the visible app, clicking a named visible clickable control, and entering user-provided text into the focused non-password field. The service does not passively collect screen text. Password fields and fields whose class name indicates password entry are refused. The service must be manually enabled by the user in Android Settings.

## Actions supported or extended

| Action | Implementation | Important limitation |
|---|---|---|
| Open installed app | Existing native package launch | App must be installed and expose a launcher activity |
| YouTube search | New `app.search` tool opens the supported YouTube search URL | Search is handed to YouTube/browser; no claim is made about results beyond URL launch |
| Call contact/number | Existing contact lookup and Android `ACTION_CALL` | Contact/phone permission and explicit confirmation required |
| Send SMS | Existing `SmsManager` path | SMS permission and explicit confirmation required |
| WhatsApp/Telegram message | New `message.compose` tool resolves contact, confirms, then opens a deep-link/web composer | Android/app policies do not provide reliable direct send; the user must tap Send, and JARVIS reports preparation rather than delivery |
| Flashlight, volume, media, alarms, timers | Existing native actions | Result is reported from native API verification where available |
| Home, Back, Recents, notifications, quick settings, screenshot, lock | Existing AccessibilityService global actions | Accessibility must be enabled; lock action does not bypass authentication |
| Scroll | New native accessibility action | Requires user-enabled service; some custom app surfaces may reject it |
| Click visible control | New native accessibility action with confirmation | Requires a visible clickable control and explicit confirmation; no password/OTP/purchase automation |
| Type text | New native accessibility action | Only focused non-password fields; never secure credentials |
| Wi-Fi/Bluetooth and other settings | Existing path opens Android settings panels | Android restricts silent direct toggling for many settings; JARVIS opens the supported panel instead |

## Safety behavior

Calls, SMS, and WhatsApp/Telegram composer preparation require confirmation. Accessibility clicking also requires confirmation. The app never asks for or reads PINs, passwords, OTPs, banking credentials, or lock-screen data. It never attempts to bypass the lock screen, silently enables Accessibility, autonomously browses social media, sends a message without the required confirmation, or claims an external message was delivered when Android only opened a composer.

## Sherpa-ONNX crash fix

The previous wake-service startup hazards remain fixed: permissions are checked before foreground startup, Android and native initialization failures are caught as `Throwable`, JNI dependencies are loaded explicitly, the microphone source is `MIC`, the bundled keyword graph is used directly, and the old audio thread is joined before native resources are released. Vosk remains the offline command recognizer.

## Validation

`npm run android:sync` passed. `npm test` passed with 67 tests and zero failures. `npm run build` passed. The Android Gradle APK attempt reached configuration but cannot continue because the Android SDK is not installed/configured (`SDK location not found`). No physical Android device is available here, so real-app verification of WhatsApp/Telegram deep links, accessibility behavior, lock-screen behavior, and Sherpa wake performance remains required.
