package com.you.jarvis;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import ai.picovoice.porcupine.Porcupine;
import ai.picovoice.porcupine.PorcupineManager;

/**
 * Always-listening wake word ("Jarvis" / "Hey JARVIS") as a foreground microphone service.
 *
 * Flow: Porcupine hears the keyword -> mic is released -> the app (WebView brain) is told via {@link Listener}.
 * If the app does not acknowledge within 2 seconds (swiped away, WebView frozen) a "Tap to talk" notification is
 * shown instead, because Android blocks services from opening activities in the background.
 * The app calls resume() when it has finished answering so the mic is free for the speech recognizer in between.
 *
 * Detection uses Picovoice Porcupine. The built-in keyword is "Jarvis". If a custom "hey-jarvis.ppn" file is present in
 * android/app/src/main/assets it is used instead (train one for free in the Picovoice Console).
 */
public class JarvisWakeService extends Service {

    public interface Listener {
        void onWake();
        void onError(String message);
        void onStopped();
    }

    public static volatile Listener listener;
    public static volatile JarvisWakeService instance;

    public static final String EXTRA_KEY = "accessKey";
    public static final String EXTRA_SENSITIVITY = "sensitivity";
    public static final String EXTRA_WAKE = "jarvis_wake";
    private static final String ACTION_STOP = "com.you.jarvis.STOP_WAKE";
    private static final String CH_SERVICE = "jarvis_wake";
    private static final String CH_ALERT = "jarvis_wake_alert";
    private static final int ID_SERVICE = 4207;
    private static final int ID_ALERT = 4208;

    private final Handler main = new Handler(Looper.getMainLooper());
    private PorcupineManager manager;
    private String accessKey = "";
    private float sensitivity = 0.7f;
    private volatile boolean paused = false;
    private volatile boolean acked = false;
    private volatile boolean listening = false;

    @Override public IBinder onBind(Intent intent) { return null; }

    public boolean isListening() { return listening; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        // Must call startForeground quickly after startForegroundService().
        showForeground();
        instance = this;
        if (intent != null) {
            String k = intent.getStringExtra(EXTRA_KEY);
            if (k != null) accessKey = k.trim();
            sensitivity = intent.getFloatExtra(EXTRA_SENSITIVITY, 0.7f);
        }
        if (accessKey.isEmpty()) { fail("Add your Picovoice AccessKey in Settings > Voice & Speech."); return START_NOT_STICKY; }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail("Microphone permission is needed for the wake word."); return START_NOT_STICKY;
        }
        startEngine();
        // Not sticky on purpose: after a reboot or kill Android will not let a background app restart a
        // microphone service, so the app turns it back on the next time it is opened.
        return START_NOT_STICKY;
    }

    private boolean hasAsset(String name) {
        try { getAssets().open(name).close(); return true; } catch (Exception e) { return false; }
    }

    private void startEngine() {
        try {
            releaseEngine();
            PorcupineManager.Builder b = new PorcupineManager.Builder()
                    .setAccessKey(accessKey)
                    .setSensitivity(sensitivity)
                    .setErrorCallback(e -> { if (listener != null) listener.onError("Wake word engine error: " + e.getMessage()); });
            if (hasAsset("hey-jarvis.ppn")) b.setKeywordPath("hey-jarvis.ppn");
            else b.setKeyword(Porcupine.BuiltInKeyword.JARVIS);
            manager = b.build(getApplicationContext(), keywordIndex -> onDetected());
            manager.start();
            paused = false;
            listening = true;
        } catch (Exception e) {
            // Includes invalid/expired AccessKey, no internet on first activation, mic busy.
            fail("Wake word could not start: " + e.getMessage());
        }
    }

    private void releaseEngine() {
        listening = false;
        if (manager != null) {
            try { manager.stop(); } catch (Exception ignored) { }
            try { manager.delete(); } catch (Exception ignored) { }
            manager = null;
        }
    }

    // Called on Porcupine's audio thread.
    private void onDetected() {
        if (paused) return;
        paused = true;
        acked = false;
        main.post(() -> {
            if (manager != null) { try { manager.stop(); } catch (Exception ignored) { } }
            listening = false;
            try { new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70).startTone(ToneGenerator.TONE_PROP_BEEP, 120); } catch (Exception ignored) { }
            Listener l = listener;
            if (l != null) l.onWake();
            // App did not pick it up (swiped away or WebView frozen): fall back to a tap-to-talk notification.
            main.postDelayed(() -> {
                if (!acked) { showTapToTalk(); resume(); }
            }, 2000);
        });
    }

    /** The app confirms it received the wake event. */
    public void acknowledge() { acked = true; }

    public void pause() {
        main.post(() -> {
            paused = true;
            listening = false;
            if (manager != null) { try { manager.stop(); } catch (Exception ignored) { } }
        });
    }

    public void resume() {
        main.post(() -> {
            if (manager == null) return;
            try { manager.start(); paused = false; listening = true; }
            catch (Exception e) { fail("Wake word could not resume: " + e.getMessage()); }
        });
    }

    private void fail(String message) {
        Listener l = listener;
        if (l != null) l.onError(message);
        stopSelf();
    }

    // ---------- notifications ----------

    private PendingIntent openApp(boolean wake) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) launch = new Intent();
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (wake) launch.putExtra(EXTRA_WAKE, true);
        return PendingIntent.getActivity(this, wake ? 1 : 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel svc = new NotificationChannel(CH_SERVICE, "Wake word", NotificationManager.IMPORTANCE_LOW);
        svc.setDescription("Shows while JARVIS is listening for its wake word.");
        nm.createNotificationChannel(svc);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Talk to JARVIS", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(alert);
    }

    private void showForeground() {
        ensureChannels();
        PendingIntent stop = PendingIntent.getService(this, 2,
                new Intent(this, JarvisWakeService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CH_SERVICE)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("JARVIS is listening")
                .setContentText("Say \"Hey JARVIS\" to talk")
                .setContentIntent(openApp(false))
                .addAction(0, "Turn off", stop)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        if (Build.VERSION.SDK_INT >= 30) startForeground(ID_SERVICE, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(ID_SERVICE, n);
    }

    private void showTapToTalk() {
        ensureChannels();
        Notification n = new NotificationCompat.Builder(this, CH_ALERT)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Hey, I heard you")
                .setContentText("Tap to talk to JARVIS")
                .setContentIntent(openApp(true))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setTimeoutAfter(15000)
                .build();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID_ALERT, n);
    }

    @Override
    public void onDestroy() {
        releaseEngine();
        instance = null;
        Listener l = listener;
        if (l != null) l.onStopped();
        super.onDestroy();
    }
}
