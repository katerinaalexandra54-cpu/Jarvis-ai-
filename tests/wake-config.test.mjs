import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('sherpa-onnx replaces Porcupine in the Android wake path', () => {
  const service = read('android-bridge/java/JarvisWakeService.java');
  const gradle = read('android/app/build.gradle');
  const setup = read('scripts/setup-android.mjs');
  assert.match(service, /com\.k2fsa\.sherpa\.onnx\.KeywordSpotter/);
  assert.match(service, /setKeywordsThreshold\(0\.55f\)/);
  assert.match(service, /stream = spotter\.createStream\(\)/);
  assert.doesNotMatch(service, /picovoice|porcupine/i);
  assert.doesNotMatch(gradle, /picovoice|porcupine/i);
  assert.doesNotMatch(setup, /implementation ['"]ai\.picovoice/i);
});

test('sherpa-onnx model, keyword file, JNI libraries, and Vosk command path are present', () => {
  const model = 'android/app/src/main/assets/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
  for (const file of [
    'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'tokens.txt', 'keywords.txt', 'bpe.model',
  ]) assert.ok(fs.existsSync(path.join(root, model, file)), file);
  assert.equal(read(path.join(model, 'keywords.txt')).trim(), '▁HE Y ▁JA R VI S :1.0 #0.55');
  for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']) {
    assert.ok(fs.existsSync(path.join(root, 'android/app/src/main/jniLibs', abi, 'libsherpa-onnx-jni.so')), abi);
    assert.ok(fs.existsSync(path.join(root, 'android/app/src/main/jniLibs', abi, 'libonnxruntime.so')), abi);
  }
  const plugin = read('android/app/src/main/java/com/you/jarvis/JarvisPhonePlugin.java');
  assert.match(plugin, /org\.vosk\.Model/);
  assert.match(plugin, /listenOffline/);
});

test('phone-control accessibility actions are explicit and credential-safe', () => {
  const service = read('android-bridge/java/JarvisAccessibilityService.java');
  const plugin = read('android-bridge/java/JarvisPhonePlugin.java');
  const xml = read('android-bridge/res/xml/jarvis_accessibility.xml');
  assert.match(service, /public boolean scroll/);
  assert.match(service, /public boolean clickText/);
  assert.match(service, /if \(node\.isPassword\(\)\) return false/);
  assert.match(plugin, /public void typeVisibleText/);
  assert.match(plugin, /public void clickVisibleText/);
  assert.match(xml, /android:canRetrieveWindowContent="true"/);
});

test('wake service keeps Android foreground microphone requirements', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_MICROPHONE/);
  assert.match(manifest, /android:foregroundServiceType="microphone"/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.equal(read('android/app/build.gradle').match(/applicationId "com\.you\.jarvis"/)?.[0], 'applicationId "com.you.jarvis"');
});

test('wake startup guards Android and native failures instead of crashing the app', () => {
  const service = read('android-bridge/java/JarvisWakeService.java');
  const foreground = service.indexOf('showForeground();');
  const permission = service.indexOf('Manifest.permission.RECORD_AUDIO');
  assert.ok(permission >= 0 && permission < foreground, 'permissions are checked before foreground startup');
  assert.match(service, /catch \(Throwable t\)/);
  assert.match(service, /System\.loadLibrary\("onnxruntime"\)/);
  assert.match(service, /System\.loadLibrary\("sherpa-onnx-jni"\)/);
  assert.match(service, /MediaRecorder\.AudioSource\.MIC/);
  assert.match(service, /oldThread\.join\(500L\)/);
  assert.match(service, /stopForeground\(true\)/);
});
