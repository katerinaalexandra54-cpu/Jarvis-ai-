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
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotter;
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotterResult;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.util.Locale;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Always-listening offline wake-word service using sherpa-onnx open-vocabulary KWS.
 *
 * The bundled English GigaSpeech KWS model is configured with the runtime keyword
 * "HEY JARVIS". It is not a model trained specifically for JARVIS, so threshold,
 * false-trigger rate, battery use, and screen-off behavior must be validated on a
 * real device before treating this as production-grade wake detection.
 */
public class JarvisWakeService extends Service {
    public interface Listener {
        void onWake();
        void onError(String message);
        void onStopped();
    }

    public static volatile Listener listener;
    public static volatile JarvisWakeService instance;

    // Kept for Intent compatibility with older JavaScript callers; no key is read or required.
    public static final String EXTRA_KEY = "accessKey";
    public static final String EXTRA_SENSITIVITY = "sensitivity";
    public static final String EXTRA_WAKE = "jarvis_wake";
    private static final String ACTION_STOP = "com.you.jarvis.STOP_WAKE";
    private static final String CH_SERVICE = "jarvis_wake";
    private static final String CH_ALERT = "jarvis_wake_alert";
    private static final int ID_SERVICE = 4207;
    private static final int ID_ALERT = 4208;
    private static final int SAMPLE_RATE = 16000;
    private static final String MODEL_ASSET = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01";
    private static final long MIN_TRIGGER_INTERVAL_MS = 3000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech wakeTts;
    private volatile boolean wakeTtsReady = false;

    private KeywordSpotter spotter;
    private Model voskModel;
    private Recognizer voskRecognizer;
    private OnlineStream stream;
    private AudioRecord recorder;
    private Thread audioThread;
    private volatile boolean stopAudio = false;
    private volatile boolean paused = false;
    private volatile boolean acked = false;
    private volatile boolean listening = false;
    private long lastTriggerAt = 0L;
    private final Object engineLock = new Object();

    @Override public IBinder onBind(Intent intent) { return null; }
    public boolean isListening() { return listening; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        instance = this;
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                fail("Microphone permission is needed for the wake word."); return START_NOT_STICKY;
            }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                fail("Notifications permission is needed while JARVIS is listening."); return START_NOT_STICKY;
            }
            // Android 12+/14 can throw SecurityException here. Keep it inside the recovery boundary.
            showForeground();
            wakeTts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && wakeTts != null) {
                    int language = wakeTts.setLanguage(Locale.forLanguageTag("en-NG"));
                    if (language == TextToSpeech.LANG_MISSING_DATA ||
                        language == TextToSpeech.LANG_NOT_SUPPORTED) {
                        wakeTts.setLanguage(Locale.US);
                    }
                    wakeTtsReady = true;
                }
            });
            startEngine();
        } catch (Throwable t) {
            fail(startupError("Android could not start the wake service", t));
        }
        // Deliberately not sticky: Android restricts restarting microphone services after process death.
        return START_NOT_STICKY;
    }

    private File modelDir() { return new File(getFilesDir(), MODEL_ASSET); }

    private void copyAssetTree(String assetPath, File target) throws IOException {
        String[] children = getAssets().list(assetPath);
        if (children != null && children.length > 0) {
            if (!target.exists() && !target.mkdirs()) throw new IOException("Could not create model directory.");
            for (String child : children) copyAssetTree(assetPath + "/" + child, new File(target, child));
            return;
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Could not create model directory.");
        try (InputStream in = getAssets().open(assetPath); FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) >= 0) if (n > 0) out.write(buffer, 0, n);
        }
    }

    private void ensureModelFiles() throws IOException {
        File dir = modelDir();
        if (!new File(dir, "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx").exists()) copyAssetTree(MODEL_ASSET, dir);
    }

    private void startEngine() {
        main.post(() -> {
            try {
                releaseEngine();
                ensureModelFiles();
                loadNativeLibraries();
                File dir = modelDir();
                OnlineTransducerModelConfig transducer = OnlineTransducerModelConfig.builder()
                        .setEncoder(new File(dir, "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx").getAbsolutePath())
                        .setDecoder(new File(dir, "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx").getAbsolutePath())
                        .setJoiner(new File(dir, "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx").getAbsolutePath())
                        .build();
                OnlineModelConfig model = OnlineModelConfig.builder()
                        .setTransducer(transducer)
                        .setTokens(new File(dir, "tokens.txt").getAbsolutePath())
                        .setNumThreads(1)
                        .setDebug(false)
                        .setProvider("cpu")
                        .setModelingUnit("bpe")
                        .build();
                KeywordSpotterConfig config = KeywordSpotterConfig.builder()
                        .setFeatureConfig(FeatureConfig.builder().setSampleRate(SAMPLE_RATE).setFeatureDim(80).build())
                        .setOnlineModelConfig(model)
                        .setKeywordsFile(new File(dir, "keywords.txt").getAbsolutePath())
                        .setKeywordsScore(1.0f)
                        .setKeywordsThreshold(0.55f)
                        .setNumTrailingBlanks(2)
                        .build();
                spotter = new KeywordSpotter(config);
                // Use the validated bundled keyword file. Passing a second tokenized
                // keyword string would duplicate the graph and can fail on older JNI builds.
                stream = spotter.createStream();
                if (stream.getPtr() == 0L) throw new IOException("Could not create the Hey JARVIS keyword stream.");
                startAudio();
            } catch (Throwable e) {
                releaseEngine();
                if (!startVoskFallback(startupError("Sherpa-onnx unavailable; using offline Vosk wake fallback", e)))
                    fail(startupError("Sherpa-onnx wake word could not start", e));
            }
        });
    }

    private void loadNativeLibraries() {
        // Load transitive dependencies explicitly for older Android linker namespaces.
        // Repeated System.loadLibrary calls are safe because Android caches loaded SONAMEs.
        System.loadLibrary("onnxruntime");
        System.loadLibrary("sherpa-onnx-c-api");
        System.loadLibrary("sherpa-onnx-cxx-api");
        System.loadLibrary("sherpa-onnx-jni");
    }

    private boolean startVoskFallback(String reason) {
        try {
            voskModel = JarvisVoskModel.open(this);
            voskRecognizer = new Recognizer(voskModel, SAMPLE_RATE, "[\"hey jarvis\", \"jarvis\", \"[unk]\"]");
            startAudio();
            android.util.Log.w("JarvisWakeService", reason + "; running constrained Vosk wake fallback.");
            return true;
        } catch (Throwable fallbackError) {
            android.util.Log.e("JarvisWakeService", "Vosk fallback failed: " + JarvisVoskModel.describe(this), fallbackError);
            releaseEngine();
            return false;
        }
    }
    private void processVoskAudio() {
        byte[] buffer = new byte[Math.max(4096, SAMPLE_RATE / 5 * 2)];
        try {
            while (!stopAudio && !paused && recorder != null && voskRecognizer != null) {
                int n = recorder.read(buffer, 0, buffer.length);
                if (n <= 0) continue;
                if (voskRecognizer.acceptWaveForm(buffer, n)) {
                    String text = voskText(voskRecognizer.getResult());
                    if (isWakePhrase(text)) { onDetected(); return; }
                } else if (isWakePhrase(voskText(voskRecognizer.getPartialResult()))) {
                    onDetected(); return;
                }
            }
        } catch (Exception e) {
            if (!stopAudio && !paused) main.post(() -> fail("Offline Vosk wake fallback stopped: " + e.getMessage()));
        }
    }
    private String voskText(String json) {
        try { return new org.json.JSONObject(json).optString("text", new org.json.JSONObject(json).optString("partial", "")); }
        catch (Exception ignored) { return ""; }
    }
    private boolean isWakePhrase(String text) { return text != null && text.matches("(?i).*\\bhey\\s+jarvis\\b.*|(?i).*\\bjarvis\\b.*"); }
    private String startupError(String prefix, Throwable t) {
        String detail = t == null ? "unknown error" : t.getMessage();
        if (detail == null || detail.trim().isEmpty()) detail = t == null ? "unknown error" : t.getClass().getSimpleName();
        return prefix + ": " + detail;
    }

    private void startAudio() throws IOException {
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) throw new IOException("This device cannot provide a 16 kHz microphone stream.");
        recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 4096));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("Android could not initialize the microphone.");
        recorder.startRecording();
        stopAudio = false;
        paused = false;
        listening = true;
        final int bufferSamples = Math.max(SAMPLE_RATE / 10, min / 2);
        audioThread = new Thread(() -> {
            if (voskRecognizer != null) processVoskAudio(); else processAudio(bufferSamples);
        }, voskRecognizer != null ? "jarvis-vosk-wake-fallback" : "jarvis-sherpa-kws");
        audioThread.start();
    }

    private void processAudio(int bufferSamples) {
        short[] pcm = new short[bufferSamples];
        try {
            while (!stopAudio && !paused && recorder != null && stream != null && spotter != null) {
                int n = recorder.read(pcm, 0, pcm.length);
                if (n <= 0) continue;
                float[] samples = new float[n];
                for (int i = 0; i < n; i++) samples[i] = pcm[i] / 32768.0f;
                stream.acceptWaveform(samples, SAMPLE_RATE);
                while (!stopAudio && spotter.isReady(stream)) {
                    spotter.decode(stream);
                    KeywordSpotterResult result = spotter.getResult(stream);
                    String keyword = result == null ? "" : result.getKeyword();
                    if (keyword != null && !keyword.trim().isEmpty()) {
                        spotter.reset(stream);
                        long now = System.currentTimeMillis();
                        if (now - lastTriggerAt >= MIN_TRIGGER_INTERVAL_MS) {
                            lastTriggerAt = now;
                            onDetected();
                        }
                    }
                }
            }
        } catch (Exception e) {
            if (!stopAudio && !paused) main.post(() -> fail("Sherpa-onnx wake word error: " + e.getMessage()));
        } finally {
            listening = false;
            releaseAudioOnly();
        }
    }

    private void releaseAudioOnly() {
        stopAudio = true;
        AudioRecord r = recorder;
        recorder = null;
        if (r != null) { try { r.stop(); } catch (Exception ignored) { } r.release(); }
    }

    private void releaseEngine() {
        synchronized (engineLock) {
            listening = false;
            stopAudio = true;
            releaseAudioOnly();
            Thread oldThread = audioThread;
            audioThread = null;
            if (oldThread != null && oldThread != Thread.currentThread()) {
                try { oldThread.join(500L); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            }
            OnlineStream s = stream; stream = null;
            if (s != null) try { s.release(); } catch (Throwable ignored) { }
            KeywordSpotter k = spotter; spotter = null;
            if (k != null) try { k.release(); } catch (Throwable ignored) { }
            Recognizer vr = voskRecognizer; voskRecognizer = null;
            if (vr != null) try { vr.close(); } catch (Throwable ignored) { }
            Model vm = voskModel; voskModel = null;
            if (vm != null) try { vm.close(); } catch (Throwable ignored) { }
        }
    }


    private void speakWakeAcknowledgement(Runnable afterSpeech) {
        if (wakeTts == null || !wakeTtsReady) {
            afterSpeech.run();
            return;
        }

        final java.util.concurrent.atomic.AtomicBoolean done =
                new java.util.concurrent.atomic.AtomicBoolean(false);
        Runnable finish = () -> {
            if (done.compareAndSet(false, true)) afterSpeech.run();
        };

        try {
            String utteranceId = "jarvis_ack_" + System.nanoTime();
            wakeTts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) {
                    if (utteranceId.equals(id)) main.post(finish);
                }
                @Override public void onError(String id) {
                    if (utteranceId.equals(id)) main.post(finish);
                }
            });

            int result = wakeTts.speak(
                    "Yes?", TextToSpeech.QUEUE_FLUSH, null, utteranceId);
            if (result == TextToSpeech.ERROR) finish.run();
            main.postDelayed(finish, 2500L);
        } catch (Throwable ignored) {
            finish.run();
        }
    }

    private void onDetected() {
        if (paused) return;
        paused = true;
        acked = false;

        main.post(() -> {
            releaseAudioOnly();
            speakWakeAcknowledgement(() -> {
                Listener l = listener;
                if (l != null) l.onWake();

                main.postDelayed(() -> {
                    if (!acked) {
                        showTapToTalk();
                        resume();
                    }
                }, 5000L);
            });
        });
    }

    public void acknowledge() { acked = true; }
    public void pause() { main.post(() -> { paused = true; releaseEngine(); }); }
    public void resume() { if (!isFinishing()) startEngine(); }
    private boolean isFinishing() { return stopAudio && instance == null; }

    private void fail(String message) {
        listening = false;
        try { stopForeground(true); } catch (Throwable ignored) { }
        Listener l = listener;
        if (l != null) main.post(() -> l.onError(message));
        stopSelf();
    }

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
        svc.setDescription("Shows while JARVIS is listening for its wake word."); nm.createNotificationChannel(svc);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Talk to JARVIS", NotificationManager.IMPORTANCE_HIGH); nm.createNotificationChannel(alert);
    }

    private void showForeground() {
        ensureChannels();
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, JarvisWakeService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CH_SERVICE)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("JARVIS is listening")
                .setContentText("Say \"Hey JARVIS\" to talk").setContentIntent(openApp(false)).addAction(0, "Turn off", stop)
                .setOngoing(true).setPriority(NotificationCompat.PRIORITY_LOW).build();
        if (Build.VERSION.SDK_INT >= 30) startForeground(ID_SERVICE, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE); else startForeground(ID_SERVICE, n);
    }

    private void showTapToTalk() {
        ensureChannels();
        Notification n = new NotificationCompat.Builder(this, CH_ALERT).setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Hey, I heard you").setContentText("Tap to talk to JARVIS").setContentIntent(openApp(true))
                .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).setTimeoutAfter(15000).build();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID_ALERT, n);
    }

    @Override public void onDestroy() {
        releaseEngine();
        if (wakeTts != null) {
            try {
                wakeTts.stop();
                wakeTts.shutdown();
            } catch (Throwable ignored) { }
            wakeTts = null;
        }
        wakeTtsReady = false;
        instance = null;
        Listener l = listener;
        if (l != null) l.onStopped();
        super.onDestroy();
    }
}
