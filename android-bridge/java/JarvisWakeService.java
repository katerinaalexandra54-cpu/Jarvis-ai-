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
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;

import java.io.File;
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
    private static final String KEYWORD = "▁HE Y ▁JA R VI S :1.0 #0.55";
    private static final long MIN_TRIGGER_INTERVAL_MS = 3000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private KeywordSpotter spotter;
    private OnlineStream stream;
    private AudioRecord recorder;
    private Thread audioThread;
    private volatile boolean stopAudio = false;
    private volatile boolean paused = false;
    private volatile boolean acked = false;
    private volatile boolean listening = false;
    private long lastTriggerAt = 0L;

    @Override public IBinder onBind(Intent intent) { return null; }
    public boolean isListening() { return listening; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        showForeground();
        instance = this;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail("Microphone permission is needed for the wake word."); return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            fail("Notifications permission is needed while JARVIS is listening."); return START_NOT_STICKY;
        }
        startEngine();
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
                stream = spotter.createStream(KEYWORD);
                if (stream.getPtr() == 0L) throw new IOException("Could not create the Hey JARVIS keyword stream.");
                startAudio();
            } catch (Exception e) {
                releaseEngine();
                fail("Sherpa-onnx wake word could not start: " + (e.getMessage() == null ? "unknown error" : e.getMessage()));
            }
        });
    }

    private void startAudio() throws IOException {
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) throw new IOException("This device cannot provide a 16 kHz microphone stream.");
        recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 4096));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("Android could not initialize the microphone.");
        recorder.startRecording();
        stopAudio = false;
        paused = false;
        listening = true;
        final int bufferSamples = Math.max(SAMPLE_RATE / 10, min / 2);
        audioThread = new Thread(() -> processAudio(bufferSamples), "jarvis-sherpa-kws");
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
        listening = false;
        stopAudio = true;
        releaseAudioOnly();
        OnlineStream s = stream; stream = null;
        if (s != null) try { s.release(); } catch (Exception ignored) { }
        KeywordSpotter k = spotter; spotter = null;
        if (k != null) try { k.release(); } catch (Exception ignored) { }
    }

    private void onDetected() {
        if (paused) return;
        paused = true;
        acked = false;
        main.post(() -> {
            releaseAudioOnly();
            try { final ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70); tg.startTone(ToneGenerator.TONE_PROP_BEEP, 120); main.postDelayed(tg::release, 400); } catch (Exception ignored) { }
            Listener l = listener; if (l != null) l.onWake();
            main.postDelayed(() -> { if (!acked) { showTapToTalk(); resume(); } }, 2000);
        });
    }

    public void acknowledge() { acked = true; }
    public void pause() { main.post(() -> { paused = true; releaseEngine(); }); }
    public void resume() { if (!isFinishing()) startEngine(); }
    private boolean isFinishing() { return stopAudio && instance == null; }

    private void fail(String message) { Listener l = listener; if (l != null) l.onError(message); stopSelf(); }

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

    @Override public void onDestroy() { releaseEngine(); instance = null; Listener l = listener; if (l != null) l.onStopped(); super.onDestroy(); }
}
