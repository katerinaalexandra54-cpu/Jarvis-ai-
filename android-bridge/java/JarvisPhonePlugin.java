package com.you.jarvis;

import android.Manifest;
import android.accessibilityservice.AccessibilityService;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.provider.Telephony;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.telephony.SmsManager;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(
    name = "JarvisPhone",
    permissions = {
        @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "phone", strings = { Manifest.permission.CALL_PHONE }),
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS, Manifest.permission.READ_SMS }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class JarvisPhonePlugin extends Plugin {

    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String queuedSpeech = null;

    private boolean has(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void launch(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private void destroyRecognizer() {
        SpeechRecognizer active = recognizer;
        recognizer = null;
        if (active != null) {
            try { active.destroy(); } catch (Exception ignored) { }
        }
    }

    private void reportSpeechError(String message) {
        JSObject event = new JSObject();
        event.put("message", message);
        if (getActivity() != null) getActivity().runOnUiThread(() -> notifyListeners("speechError", event));
        else notifyListeners("speechError", event);
    }

    private void speakNow(String text) {
        try {
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis") == TextToSpeech.ERROR)
                reportSpeechError("Android could not speak the response.");
        } catch (Exception e) {
            reportSpeechError("Android could not speak the response.");
        }
    }

    // ---------- permissions & status ----------

    private JSObject statusObject() {
        JSObject o = new JSObject();
        o.put("mic", has(Manifest.permission.RECORD_AUDIO));
        o.put("contacts", has(Manifest.permission.READ_CONTACTS));
        o.put("phone", has(Manifest.permission.CALL_PHONE));
        o.put("sms", has(Manifest.permission.SEND_SMS) && has(Manifest.permission.READ_SMS));
        o.put("accessibility", JarvisAccessibilityService.instance != null);
        o.put("location", has(Manifest.permission.ACCESS_COARSE_LOCATION));
        o.put("notifications", (Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS))
                && NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        JarvisWakeService w = JarvisWakeService.instance;
        o.put("wakeRunning", w != null && w.isListening());
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestAllPermissions(PluginCall call) {
        String[] aliases = Build.VERSION.SDK_INT >= 33
                ? new String[] { "mic", "contacts", "phone", "sms", "location", "notifications" }
                : new String[] { "mic", "contacts", "phone", "sms", "location" };
        requestPermissionForAliases(aliases, call, "permissionsDone");
    }

    @PermissionCallback
    private void permissionsDone(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        launch(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        call.resolve();
    }

    // ---------- voice ----------

    @PluginMethod
    public void listen(final PluginCall call) {
        if (!has(Manifest.permission.RECORD_AUDIO)) {
            call.reject("Microphone permission is needed. Allow it in Settings > Phone Control.");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition is not available on this phone.");
            return;
        }
        final String lang = call.getString("lang", Locale.getDefault().toLanguageTag());
        getActivity().runOnUiThread(() -> {
            try {
                if (recognizer != null) recognizer.destroy();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { }
                    @Override public void onBeginningOfSpeech() { }
                    @Override public void onRmsChanged(float rmsdB) { }
                    @Override public void onBufferReceived(byte[] buffer) { }
                    @Override public void onEndOfSpeech() { }
                    @Override public void onEvent(int eventType, Bundle params) { }

                    @Override
                    public void onError(int error) {
                        call.reject("I didn't catch that (code " + error + ").");
                        destroyRecognizer();
                    }

                    @Override
                    public void onResults(Bundle results) {
                        ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        JSObject o = new JSObject();
                        o.put("text", (list != null && !list.isEmpty()) ? list.get(0) : "");
                        call.resolve(o);
                        destroyRecognizer();
                    }

                    @Override
                    public void onPartialResults(Bundle partial) {
                        ArrayList<String> list = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (list != null && !list.isEmpty()) {
                            JSObject o = new JSObject();
                            o.put("text", list.get(0));
                            notifyListeners("partial", o);
                        }
                    }
                });
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                recognizer.startListening(i);
                notifyListeners("listeningStarted", new JSObject());
            } catch (Exception e) {
                destroyRecognizer();
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void stopListening(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.stopListening();
            call.resolve();
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "");
        if (tts == null) {
            queuedSpeech = text;
            try {
                tts = new TextToSpeech(getContext(), status -> {
                    if (tts == null) return;
                    ttsReady = (status == TextToSpeech.SUCCESS);
                    if (!ttsReady) {
                        TextToSpeech failed = tts;
                        tts = null;
                        queuedSpeech = null;
                        if (failed != null) failed.shutdown();
                        reportSpeechError("Android text-to-speech is unavailable.");
                        return;
                    }
                    int language = tts.setLanguage(Locale.getDefault());
                    if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                        queuedSpeech = null;
                        reportSpeechError("The selected Android voice is not available.");
                        return;
                    }
                    if (queuedSpeech != null) {
                        String pending = queuedSpeech;
                        queuedSpeech = null;
                        speakNow(pending);
                    }
                });
            } catch (Exception e) {
                queuedSpeech = null;
                reportSpeechError("Android text-to-speech could not start.");
            }
        } else if (ttsReady) {
            speakNow(text);
        } else {
            queuedSpeech = text;
        }
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null && ttsReady) tts.stop();
        call.resolve();
    }

    // ---------- alarms, timers, apps, settings ----------

    @PluginMethod
    public void setAlarm(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        int hour = call.getInt("hour", 7);
        int minute = call.getInt("minute", 0);
        i.putExtra(AlarmClock.EXTRA_HOUR, hour);
        i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("label", "Jarvis alarm"));
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        try {
            launch(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No clock app found to set the alarm.");
        }
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
        int seconds = call.getInt("seconds", 60);
        i.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("label", "Jarvis timer"));
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        try {
            launch(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No clock app found to start the timer.");
        }
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String name = call.getString("name", "").trim().toLowerCase(Locale.ROOT);
        if (name.isEmpty()) { call.reject("Which app should I open?"); return; }
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        ResolveInfo best = null;
        for (ResolveInfo ri : apps) {
            String label = ri.loadLabel(pm).toString().toLowerCase(Locale.ROOT);
            if (label.equals(name)) { best = ri; break; }
            if (best == null && (label.contains(name) || name.contains(label))) best = ri;
        }
        if (best == null) { call.reject("I couldn't find an app called " + name + "."); return; }
        Intent launch = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (launch == null) { call.reject("I can't open that app."); return; }
        launch(launch);
        JSObject o = new JSObject();
        o.put("app", best.loadLabel(pm).toString());
        call.resolve(o);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String page = call.getString("page", "");
        String action;
        switch (page) {
            case "wifi": action = Settings.ACTION_WIFI_SETTINGS; break;
            case "bluetooth": action = Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "display": action = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "sound": action = Settings.ACTION_SOUND_SETTINGS; break;
            case "battery": action = Settings.ACTION_BATTERY_SAVER_SETTINGS; break;
            case "location": action = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
            case "apps": action = Settings.ACTION_APPLICATION_SETTINGS; break;
            case "accessibility": action = Settings.ACTION_ACCESSIBILITY_SETTINGS; break;
            default: action = Settings.ACTION_SETTINGS;
        }
        try { launch(new Intent(action)); call.resolve(); }
        catch (ActivityNotFoundException e) { call.reject("That settings page isn't available."); }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        try { launch(new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", "")))); call.resolve(); }
        catch (Exception e) { call.reject("I couldn't open that link."); }
    }

    @PluginMethod
    public void flashlight(PluginCall call) {
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            String target = null;
            for (String id : cm.getCameraIdList()) {
                android.hardware.camera2.CameraCharacteristics cc = cm.getCameraCharacteristics(id);
                if (!Boolean.TRUE.equals(cc.get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE))) continue;
                Integer facing = cc.get(android.hardware.camera2.CameraCharacteristics.LENS_FACING);
                if (target == null) target = id;
                if (facing != null && facing == android.hardware.camera2.CameraCharacteristics.LENS_FACING_BACK) { target = id; break; }
            }
            if (target == null) { call.reject("This phone has no flashlight."); return; }
            cm.setTorchMode(target, call.getBoolean("on", true));
            call.resolve();
        } catch (Exception e) {
            call.reject("I couldn't switch the flashlight.");
        }
    }

    @PluginMethod
    public void globalAction(PluginCall call) {
        JarvisAccessibilityService svc = JarvisAccessibilityService.instance;
        if (svc == null) {
            call.reject("Turn on Jarvis in Accessibility settings first (Settings > Phone Control).");
            return;
        }
        String a = call.getString("action", "");
        int code;
        switch (a) {
            case "home": code = AccessibilityService.GLOBAL_ACTION_HOME; break;
            case "back": code = AccessibilityService.GLOBAL_ACTION_BACK; break;
            case "recents": code = AccessibilityService.GLOBAL_ACTION_RECENTS; break;
            case "notifications": code = AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quickSettings": code = AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "powerDialog": code = AccessibilityService.GLOBAL_ACTION_POWER_DIALOG; break;
            case "screenshot":
                if (Build.VERSION.SDK_INT < 28) { call.reject("Screenshots need Android 9 or newer."); return; }
                code = AccessibilityService.GLOBAL_ACTION_TAKE_SCREENSHOT; break;
            case "lock":
                if (Build.VERSION.SDK_INT < 28) { call.reject("Locking needs Android 9 or newer."); return; }
                code = AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN; break;
            default: call.reject("Unknown action."); return;
        }
        if (svc.performGlobalAction(code)) call.resolve(); else call.reject("Android refused that action.");
    }

    // ---------- contacts, calls, texts ----------

    private String nameFor(String number) {
        if (number == null || !has(Manifest.permission.READ_CONTACTS)) return number;
        Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number));
        try (Cursor c = getContext().getContentResolver().query(uri,
                new String[] { ContactsContract.PhoneLookup.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return number;
    }

    private JSObject lookup(String name) throws Exception {
        if (!has(Manifest.permission.READ_CONTACTS)) throw new Exception("Contacts permission is needed.");
        try (Cursor c = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[] { ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER },
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?",
                new String[] { "%" + name + "%" }, null)) {
            if (c != null && c.moveToFirst()) {
                JSObject o = new JSObject();
                o.put("name", c.getString(0));
                o.put("number", c.getString(1));
                return o;
            }
        }
        throw new Exception("I couldn't find " + name + " in your contacts.");
    }

    @PluginMethod
    public void findContact(PluginCall call) {
        try { call.resolve(lookup(call.getString("name", ""))); }
        catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void placeCall(PluginCall call) {
        if (!has(Manifest.permission.CALL_PHONE)) { call.reject("Phone permission is needed."); return; }
        String number = call.getString("number", "");
        try {
            launch(new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number))));
            call.resolve();
        } catch (Exception e) { call.reject("I couldn't place the call."); }
    }

    @PluginMethod
    public void sendSms(PluginCall call) {
        if (!has(Manifest.permission.SEND_SMS)) { call.reject("SMS permission is needed."); return; }
        String number = call.getString("number", "");
        String body = call.getString("body", "");
        try {
            SmsManager sm = Build.VERSION.SDK_INT >= 31
                ? getContext().getSystemService(SmsManager.class)
                : SmsManager.getDefault();
            sm.sendMultipartTextMessage(number, null, sm.divideMessage(body), null, null);
            call.resolve();
        } catch (Exception e) { call.reject("The message didn't send: " + e.getMessage()); }
    }

    @PluginMethod
    public void readSms(PluginCall call) {
        if (!has(Manifest.permission.READ_SMS)) { call.reject("SMS permission is needed."); return; }
        int count = call.getInt("count", 3);
        String from = call.getString("from", "").toLowerCase(Locale.ROOT);
        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                new String[] { Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE },
                null, null, Telephony.Sms.DATE + " DESC LIMIT 60")) {
            while (c != null && c.moveToNext() && out.length() < count) {
                String address = c.getString(0);
                String name = nameFor(address);
                if (!from.isEmpty()
                        && !String.valueOf(name).toLowerCase(Locale.ROOT).contains(from)
                        && !String.valueOf(address).toLowerCase(Locale.ROOT).contains(from)) continue;
                JSObject m = new JSObject();
                m.put("address", address);
                m.put("name", name);
                m.put("body", c.getString(1));
                m.put("date", c.getLong(2));
                out.put(m);
            }
        } catch (Exception e) { call.reject("I couldn't read your messages."); return; }
        JSObject o = new JSObject();
        o.put("messages", out);
        call.resolve(o);
    }

    // ---------- JARVIS tool layer: torch, volume, battery, device, media ----------
    // Every method either resolves with real data or rejects with a plain-English reason,
    // so the AI can report exactly what happened.

    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean on = call.getBoolean("enabled", true);
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            String id = null;
            for (String cid : cm.getCameraIdList()) {
                android.hardware.camera2.CameraCharacteristics cc = cm.getCameraCharacteristics(cid);
                Boolean flash = cc.get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = cc.get(android.hardware.camera2.CameraCharacteristics.LENS_FACING);
                if (Boolean.TRUE.equals(flash) && facing != null
                        && facing == android.hardware.camera2.CameraCharacteristics.LENS_FACING_BACK) { id = cid; break; }
            }
            if (id == null) { call.reject("This phone has no flashlight."); return; }
            cm.setTorchMode(id, on);
            JSObject o = new JSObject();
            o.put("enabled", on);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("I couldn't switch the flashlight (" + e.getMessage() + "). Another app may be using the camera.");
        }
    }

    private int streamFor(String name) {
        switch (name == null ? "" : name) {
            case "ring": return android.media.AudioManager.STREAM_RING;
            case "alarm": return android.media.AudioManager.STREAM_ALARM;
            case "notification": return android.media.AudioManager.STREAM_NOTIFICATION;
            default: return android.media.AudioManager.STREAM_MUSIC;
        }
    }

    @PluginMethod
    public void getVolume(PluginCall call) {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            String stream = call.getString("stream", "media");
            int s = streamFor(stream);
            int max = am.getStreamMaxVolume(s);
            int raw = am.getStreamVolume(s);
            JSObject o = new JSObject();
            o.put("stream", stream);
            o.put("level", max == 0 ? 0 : Math.round(100f * raw / max));
            o.put("raw", raw);
            o.put("max", max);
            call.resolve(o);
        } catch (Exception e) { call.reject("I couldn't read the volume."); }
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            String stream = call.getString("stream", "media");
            int s = streamFor(stream);
            int max = am.getStreamMaxVolume(s);
            int level = Math.max(0, Math.min(100, call.getInt("level", 50)));
            int raw = Math.round(level / 100f * max);
            am.setStreamVolume(s, raw, android.media.AudioManager.FLAG_SHOW_UI);
            int now = am.getStreamVolume(s);
            if (now != raw) { call.reject("Android did not apply the volume change (it may be locked by Do Not Disturb)."); return; }
            JSObject o = new JSObject();
            o.put("stream", stream);
            o.put("level", max == 0 ? 0 : Math.round(100f * now / max));
            call.resolve(o);
        } catch (SecurityException e) {
            call.reject("Android blocked the volume change. Turn off Do Not Disturb and try again.");
        } catch (Exception e) { call.reject("I couldn't change the volume."); }
    }

    @PluginMethod
    public void getBattery(PluginCall call) {
        try {
            Intent i = getContext().registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (i == null) { call.reject("Battery information isn't available."); return; }
            int level = i.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
            int scale = i.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
            int status = i.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
            if (level < 0 || scale <= 0) { call.reject("Battery information isn't available."); return; }
            boolean charging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                    || status == android.os.BatteryManager.BATTERY_STATUS_FULL;
            JSObject o = new JSObject();
            o.put("percent", Math.round(100f * level / scale));
            o.put("charging", charging);
            call.resolve(o);
        } catch (Exception e) { call.reject("I couldn't read the battery."); }
    }

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject o = new JSObject();
        o.put("manufacturer", Build.MANUFACTURER);
        o.put("model", Build.MODEL);
        o.put("androidVersion", Build.VERSION.RELEASE);
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("language", Locale.getDefault().toLanguageTag());
        o.put("timezone", java.util.TimeZone.getDefault().getID());
        call.resolve(o);
    }

    @PluginMethod
    public void mediaControl(final PluginCall call) {
        String action = call.getString("action", "");
        int code;
        switch (action) {
            case "play": code = android.view.KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pause": code = android.view.KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            case "next": code = android.view.KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": code = android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            default: call.reject("Unknown media action."); return;
        }
        try {
            final android.media.AudioManager am = (android.media.AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code));
            am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code));
            final String act = action;
            // Android can't confirm that a player obeyed, so report whether audio is actually playing afterwards.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                JSObject o = new JSObject();
                o.put("action", act);
                o.put("musicActive", am.isMusicActive());
                call.resolve(o);
            }, 700);
        } catch (Exception e) { call.reject("I couldn't send that media command."); }
    }

    // ---------- location (for weather), speech state ----------

    @PluginMethod
    public void getLocation(PluginCall call) {
        if (!has(Manifest.permission.ACCESS_COARSE_LOCATION)) { call.reject("Location permission is needed. Allow it in Settings > Phone Control."); return; }
        android.location.LocationManager lm = (android.location.LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        android.location.Location best = null;
        try {
            for (String provider : lm.getProviders(true)) {
                try {
                    android.location.Location l = lm.getLastKnownLocation(provider);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException ignored) { /* e.g. GPS provider with coarse-only permission */ }
            }
        } catch (Exception e) { call.reject("I couldn't read your location."); return; }
        if (best == null) { call.reject("Android has no recent location. Open a maps app once, or turn Location on, then try again."); return; }
        JSObject o = new JSObject();
        o.put("latitude", best.getLatitude());
        o.put("longitude", best.getLongitude());
        o.put("ageSeconds", (System.currentTimeMillis() - best.getTime()) / 1000);
        call.resolve(o);
    }

    @PluginMethod
    public void isSpeaking(PluginCall call) {
        JSObject o = new JSObject();
        o.put("speaking", tts != null && ttsReady && tts.isSpeaking());
        call.resolve(o);
    }

    // ---------- wake word ("Hey JARVIS") ----------

    private boolean pendingWake = false;
    private JarvisWakeService.Listener wakeListener;

    @Override
    public void load() {
        if (getActivity() != null && getActivity().getIntent() != null
                && getActivity().getIntent().getBooleanExtra(JarvisWakeService.EXTRA_WAKE, false)) {
            pendingWake = true;
            getActivity().getIntent().removeExtra(JarvisWakeService.EXTRA_WAKE);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(JarvisWakeService.EXTRA_WAKE, false)) {
            intent.removeExtra(JarvisWakeService.EXTRA_WAKE);
            pendingWake = true;
            emit("wake", null);
        }
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        if (tts != null) {
            try { if (ttsReady) tts.stop(); } catch (Exception ignored) { }
            try { tts.shutdown(); } catch (Exception ignored) { }
            tts = null;
            ttsReady = false;
            queuedSpeech = null;
        }
        if (JarvisWakeService.listener == wakeListener) JarvisWakeService.listener = null;
        super.handleOnDestroy();
    }

    private void emit(final String event, final String message) {
        final JSObject o = new JSObject();
        if (message != null) o.put("message", message);
        if (getActivity() != null) getActivity().runOnUiThread(() -> notifyListeners(event, o));
        else notifyListeners(event, o);
    }

    @PluginMethod
    public void startWake(PluginCall call) {
        String key = call.getString("accessKey", "").trim();
        if (key.isEmpty()) { call.reject("Add your Picovoice AccessKey first (Settings > Voice & Speech)."); return; }
        if (!has(Manifest.permission.RECORD_AUDIO)) { call.reject("Microphone permission is needed. Tap Allow permissions first."); return; }
        if ((Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS))
                || !NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.reject("Notifications permission is needed for the wake-word status and tap-to-talk fallback. Allow it in Settings > Phone Control.");
            return;
        }
        wakeListener = new JarvisWakeService.Listener() {
            @Override public void onWake() { emit("wake", null); }
            @Override public void onError(String message) { emit("wakeError", message); }
            @Override public void onStopped() { emit("wakeStopped", null); }
        };
        JarvisWakeService.listener = wakeListener;
        Float sens = call.getFloat("sensitivity", 0.7f);
        Intent i = new Intent(getContext(), JarvisWakeService.class);
        i.putExtra(JarvisWakeService.EXTRA_KEY, key);
        i.putExtra(JarvisWakeService.EXTRA_SENSITIVITY, sens == null ? 0.7f : sens.floatValue());
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Android would not start the wake-word service (" + e.getMessage() + "). Open the app and try again.");
        }
    }

    @PluginMethod
    public void stopWake(PluginCall call) {
        getContext().stopService(new Intent(getContext(), JarvisWakeService.class));
        call.resolve();
    }

    @PluginMethod
    public void wakeAck(PluginCall call) {
        JarvisWakeService w = JarvisWakeService.instance;
        if (w != null) w.acknowledge();
        call.resolve();
    }

    @PluginMethod
    public void pauseWake(PluginCall call) {
        JarvisWakeService w = JarvisWakeService.instance;
        if (w != null) w.pause();
        call.resolve();
    }

    @PluginMethod
    public void resumeWake(PluginCall call) {
        JarvisWakeService w = JarvisWakeService.instance;
        if (w != null) w.resume();
        call.resolve();
    }

    @PluginMethod
    public void consumePendingWake(PluginCall call) {
        JSObject o = new JSObject();
        o.put("pending", pendingWake);
        pendingWake = false;
        call.resolve(o);
    }

    // ---------- images ----------

    @PluginMethod
    public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) { call.reject("Saving images needs Android 10 or newer."); return; }
        String data = call.getString("dataUrl", "");
        String mime = call.getString("mime", "image/png");
        String name = call.getString("name", "jarvis-image");
        try {
            byte[] bytes = Base64.decode(data.substring(data.indexOf(",") + 1), Base64.DEFAULT);
            ContentResolver r = getContext().getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            v.put(MediaStore.Images.Media.MIME_TYPE, mime);
            v.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Jarvis");
            Uri uri = r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            try (OutputStream os = r.openOutputStream(uri)) { os.write(bytes); }
            call.resolve();
        } catch (Exception e) { call.reject("Couldn't save the image."); }
    }
}
