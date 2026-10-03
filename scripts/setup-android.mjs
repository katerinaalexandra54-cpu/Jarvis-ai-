// Run after `npx cap add android`. Idempotent: installs the Jarvis phone plugin,
// permissions, accessibility service, launcher icons and splash into ./android.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const android = path.join(root, 'android');
const bridge = path.join(root, 'android-bridge');
if (!fs.existsSync(android)) { console.error('No ./android folder. Run: npx cap add android'); process.exit(1); }

const main = path.join(android, 'app/src/main');
const res = path.join(main, 'res');

// 1. Find MainActivity + package name
function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = find(p, name); if (r) return r; }
    else if (e.name === name) return p;
  }
}
const mainActivity = find(path.join(main, 'java'), 'MainActivity.java');
if (!mainActivity) { console.error('MainActivity.java not found'); process.exit(1); }
let src = fs.readFileSync(mainActivity, 'utf8');
const pkg = src.match(/^package\s+([\w.]+);/m)[1];
const javaDir = path.dirname(mainActivity);

// 2. Copy Java files under the app's package
for (const f of fs.readdirSync(path.join(bridge, 'java'))) {
  let code = fs.readFileSync(path.join(bridge, 'java', f), 'utf8').replace(/^package\s+[\w.]+;/m, `package ${pkg};`);
  fs.writeFileSync(path.join(javaDir, f), code);
}

// 3. Register the plugin in MainActivity
if (!src.includes('JarvisPhonePlugin')) {
  src = src.replace(/public class MainActivity extends BridgeActivity\s*\{\s*\}/,
`public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(JarvisPhonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}`);
  if (!src.includes('JarvisPhonePlugin')) { console.error('Could not patch MainActivity.java; add registerPlugin(JarvisPhonePlugin.class) yourself.'); process.exit(1); }
  fs.writeFileSync(mainActivity, src);
}

// 4. Resources: icons, splash, accessibility config
fs.cpSync(path.join(bridge, 'res'), res, { recursive: true, force: true });
for (const d of fs.readdirSync(res)) {
  const s = path.join(res, d, 'splash.png');
  if (d.startsWith('drawable') && d !== 'drawable' && fs.existsSync(s)) fs.copyFileSync(path.join(bridge, 'res/drawable/splash.png'), s);
}
const strings = path.join(res, 'values/strings.xml');
let sx = fs.readFileSync(strings, 'utf8');
if (!sx.includes('jarvis_accessibility_description')) {
  sx = sx.replace('</resources>', '    <string name="jarvis_accessibility_description">Lets Jarvis press Home, Back and Recents, open notifications and take screenshots when you ask.</string>\n</resources>');
  fs.writeFileSync(strings, sx);
}

// 5. Manifest: permissions, package queries, accessibility service
const manifestPath = path.join(main, 'AndroidManifest.xml');
let mf = fs.readFileSync(manifestPath, 'utf8');
if (!mf.includes('JarvisAccessibilityService')) {
  const perms = ['RECORD_AUDIO', 'READ_CONTACTS', 'CALL_PHONE', 'SEND_SMS', 'READ_SMS', 'READ_PHONE_STATE']
    .map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n')
    + '\n    <uses-permission android:name="com.android.alarm.permission.SET_ALARM" />\n    <uses-permission android:name="android.permission.FLASHLIGHT" />\n';
  const queries = `    <queries>
        <intent><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="https" /></intent>
    </queries>
`;
  const service = `        <service
            android:name=".JarvisAccessibilityService"
            android:exported="true"
            android:label="Jarvis"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter><action android:name="android.accessibilityservice.AccessibilityService" /></intent-filter>
            <meta-data android:name="android.accessibilityservice" android:resource="@xml/jarvis_accessibility" />
        </service>
`;
  mf = mf.replace('<application', perms + queries + '    <application').replace('</application>', service + '    </application>');
  fs.writeFileSync(manifestPath, mf);
}

// 6. Wake word ("Hey JARVIS"): foreground microphone service, extra permissions, Porcupine SDK. Idempotent.
mf = fs.readFileSync(manifestPath, 'utf8');
if (!mf.includes('JarvisWakeService')) {
  const wakePerms = ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'POST_NOTIFICATIONS', 'ACCESS_COARSE_LOCATION']
    .filter(p => !mf.includes(`android.permission.${p}"`))
    .map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  const wakeService = `        <service\n            android:name=\".JarvisWakeService\"\n            android:exported=\"false\"\n            android:foregroundServiceType=\"microphone\" />\n`;
  mf = mf.replace('<application', (wakePerms ? wakePerms + '\n' : '') + '    <application').replace('</application>', wakeService + '    </application>');
  fs.writeFileSync(manifestPath, mf);
}
const gradlePath = path.join(android, 'app/build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('porcupine-android')) {
  gradle = gradle.replace(/dependencies\s*\{/, "dependencies {\n    implementation 'ai.picovoice:porcupine-android:4.0.2'");
  if (!gradle.includes('porcupine-android')) { console.error('Could not add the Porcupine dependency to app/build.gradle; add implementation \'ai.picovoice:porcupine-android:4.0.2\' yourself.'); process.exit(1); }
  fs.writeFileSync(gradlePath, gradle);
}
// Optional custom wake-word model: put hey-jarvis.ppn in android-bridge/assets/ and it is bundled automatically.
const assetsSrc = path.join(bridge, 'assets');
if (fs.existsSync(assetsSrc)) fs.cpSync(assetsSrc, path.join(main, 'assets'), { recursive: true, force: true });
console.log(`Jarvis phone bridge installed for package ${pkg}.`);
