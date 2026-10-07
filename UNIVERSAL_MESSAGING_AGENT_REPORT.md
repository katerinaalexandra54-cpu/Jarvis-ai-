# Universal Android MessagingAgent report

## What was implemented

JARVIS now has a generic `message.*` action layer instead of relying only on WhatsApp- or Telegram-specific commands. When the user explicitly asks to read the current conversation, the Android bridge inspects the active app's visible accessibility tree and returns a bounded set of visible, non-password nodes with package name, text, content descriptions, resource IDs, clickability, and scrollability. The data is collected only for that request and is passed to the agent for the requested response.

`message.scroll_read` scrolls the active app through an accessibility node or a gesture and then takes another bounded snapshot. `message.reply_current` requires confirmation, types only into a focused non-password field, clicks a visible Send/Reply/Post control, and returns success only when both steps succeed. If Android exposes insufficient controls, the result is an honest failure. The existing app-specific SMS, contact, WhatsApp composer, and Telegram composer tools remain available as fallbacks, but composer preparation never claims delivery.

## Compatibility categories

| Category | Current behavior |
|---|---|
| **Supported** | Any installed app whose active UI exposes a visible conversation, safe focused input, and recognizable clickable Send/Reply/Post control through Android AccessibilityService. Generic read, scroll, type, click, and verified reply paths are available. |
| **Partially supported** | WhatsApp, WhatsApp Business, Telegram, Facebook Messenger, Instagram, Signal, Discord, Snapchat, Viber, LINE, WeChat, Skype, Teams, Slack, X, and similar apps when their current screen exposes compatible nodes. UI labels, secure custom views, WebViews, and app policy can prevent one or more operations. |
| **Open-only** | Apps that can be launched but expose no reliable accessible conversation/input/send controls. JARVIS can open them and explain that Android is not exposing enough controls. YouTube search uses its supported public search URL. |
| **Not automatable** | Passwords, PINs, OTPs, banking authentication codes, secure fields, lock-screen bypass, hidden/private UI, and any message send for which Android does not expose a verifiable Send control. |

This is not a claim that every Android app is automatable. Android AccessibilityService behavior, app versions, custom rendering, WebViews, regional builds, and app policies determine the actual result on each device.

## Privacy and safety

The service must be explicitly enabled by the user in Android Settings. It does not passively upload conversations or run a background conversation scraper. Snapshot calls are initiated only by a matching user request, are bounded to visible non-password nodes, and exclude password fields. Replies always require confirmation. JARVIS never asks for or reads passwords, PINs, OTPs, or banking credentials, never bypasses Android authentication, and never reports a message as sent without native verification.

Notification-listener integration is intentionally not silently enabled. Android requires a separate user-granted notification-access setting, and retaining notification message bodies would create a passive content-monitoring path. The current privacy-preserving implementation uses explicit active-screen accessibility reads; a future notification adapter should be opt-in, local-only, retention-limited, and separately disclosed.

## Validation

The project synchronized successfully, the Vite production build passed, and all **69 automated tests passed**. The Android Gradle build remains blocked in this sandbox because no Android SDK is configured. Real-device compatibility testing is still required for each installed messaging app and for the affected Sherpa-ONNX wake path.
