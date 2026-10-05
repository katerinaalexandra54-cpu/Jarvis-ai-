# JARVIS test plan

## Automated (no key, no phone): `npm test` (50 tests, also run in CI before the APK build)
Fake AI + fake Android layer (`tests/helpers.mjs`).

| Area | What is proven |
|---|---|
| Conversation / information | No tool for chit-chat; questions route as information |
| Flashlight, app open, battery | Right tool runs, the result goes back to the AI, the reply comes after |
| Failed tool | `{success:false,error}` reaches the AI verbatim; with an empty AI reply the fallback states the error, never "Done" |
| Unknown command | Invented tools rejected safely; declining without a tool is fine |
| Follow-up | Earlier tool call, result and known state are sent, so "turn it off" works |
| API / network failure | Before an action: the error reaches the UI. After an action ran: the reply says what happened and that the connection dropped |
| Multi-step, call/SMS confirm, validation, step cap | Order kept; no call without a yes; bad args never reach the phone; runaway loops stop |
| Weather / Wikipedia / news | Geocode then forecast, units, phone location, unknown place, offline, RSS parsing |
| Server auth | Tokens verify; tampered, expired, wrong-secret tokens rejected; wrong/missing access code refused; secure by default; revoked devices blocked; daily quota; allowlist; token-less requests never reach the AI provider |
| Providers | Key only in the header (dev mode); backend mode sends a bearer token and no AI key; 401 clears the token and asks for the code |

## Manual, on the phone
Install a build made with `VITE_API` set (DEPLOY.md). Run both allowed- and denied-permission cases below; grant each permission only when a test calls for it.

### First launch, server and voice
| # | Do | Expected |
|---|---|---|
| F1 | Fresh install, create the local account, ask JARVIS a basic question | The app asks for the server access code (not an OpenRouter key) on a server-backed build. |
| F2 | Enter an invalid access code, then the valid invite code; ask again | Invalid code is rejected; valid code registers the device and a real answer comes through the deployed server. |
| F3 | Repeat an AI request with Wi-Fi/mobile data disabled | A clear network error appears; no phone action is falsely reported as completed. |
| F4 | Use the microphone button, speak a question, and let JARVIS answer | Speech recognition returns text and the native TTS voice answers. Check the selected language and voice. |
| F5 | Deny microphone or notification permission, then enable wake word | The app explains the missing permission; wake listening does not start without the microphone and notification permissions. |
| F6 | Deny Contacts, Phone, SMS, or Location individually, then request a contact lookup/call/text/weather-at-location | The action fails safely with a permission explanation; grant permission and retry to confirm recovery. |

### Security
| # | Do | Expected |
|---|---|---|
| S1 | Fresh install, ask "hi" | A box asks for an access code. A wrong code shows "not valid". The right one connects. |
| S2 | Settings > AI Preferences | No key field; says it is connected. "Remove access" then asking again re-prompts for the code. |
| S3 | Unzip the APK and search it for `sk-or` | Nothing found. |
| S4 | Add the device id to `JARVIS_REVOKED`, redeploy, ask | Access code prompt returns. |
| S5 | Call `/api/ai/chat` with no token (curl) | 401. |

### Phone actions
| # | Say | Expected |
|---|---|---|
| 1 | "Turn on my flashlight" / "Turn it off" | Torch on, "Flashlight is on."; then off (it understood "it"). |
| 2 | "Open YouTube" / "Open Banana Phone 3000" | Opens / honest "couldn't find an app". |
| 3 | "How much battery do I have?" | Correct percent and charging state. |
| 4 | "What's my volume?" then "Turn it up a bit" | Reads the percent; the volume bar moves. |
| 5 | Play music, then "Pause", "Next", "Previous" | Player obeys. With nothing playing, "Play" reports that nothing started. |
| 6 | "Open YouTube and play music" | Opens, then plays, or an honest failure. |
| 7 | "Call [contact]" then "no" | "Call X?", then "Okay, cancelled." No call. |
| 8 | Camera in use elsewhere, then "Flashlight on" | Explains the failure; never says "on". |
| 9 | Airplane mode, ask anything | "No connection..." |

### Live information
| # | Say | Expected |
|---|---|---|
| L1 | "What's the weather in Paris?" | Spoken temperature and conditions. |
| L2 | "What's the weather?" (location permission on, Maps opened once) | Uses your location. With permission off: explains how to enable it. |
| L3 | "Will it rain tomorrow in London?" | Uses the forecast chance. |
| L4 | "Give me the news" / "News about football" | 2 to 3 headlines read naturally. |
| L5 | "Who was Ada Lovelace?" | Short factual answer. |
| L6 | "What's the bitcoin price?" | Says it has no live price data; offers a web search. |

### Wake word (the riskiest part: please test carefully and report)
| # | Do | Expected |
|---|---|---|
| W1 | Settings > Voice & Speech: grant Microphone and Notifications; switch wake word on | Notification "JARVIS is listening". No account, API key, or network is required for wake detection. |
| W2 | App open, say "Hey JARVIS, what time is it?" | Beep, then it listens and answers aloud. |
| W3 | Press Home (app in background), say "Hey JARVIS, turn on the flashlight" | Works. If the WebView is frozen by your phone you instead get a "Tap to talk" notification within 2 seconds. Report which one you get and your phone model. |
| W4 | Lock the screen and try again | Same two outcomes as W3. |
| W5 | Swipe the app away from recents, say "Hey JARVIS" | Record whether voice capture works directly or a "Tap to talk" notification appears. If the app cannot hand off to speech recognition, the notification should be available; tapping it starts listening. Record phone model and Android version. |
| W6 | Let JARVIS answer aloud | It does not re-trigger itself on its own voice. |
| W7 | Tap "Turn off" in the foreground notification | The service stops and the saved wake-word setting also turns off. |
| W8 | Reboot the phone | Wake word is off until you open the app (Android does not allow a microphone service to restart itself). |
| W9 | Normal day of use | Check battery use in Android settings after several hours. |
| W10 | Say similar phrases and background speech ("hey service", "Jarvis", TV/radio) | Record false activations and missed "Hey JARVIS" detections; tune the `#0.55` threshold only after a repeatable test set. |
| W11 | Fresh install and first wake | Measure model-copy/startup time, APK/storage size, CPU, and memory. |
| W12 | Repeat W2-W9 on at least one arm64 phone and one emulator/ABI if applicable | Confirm the bundled sherpa-onnx JNI libraries load and report exact device/Android versions. |
