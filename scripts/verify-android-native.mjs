#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const abis = {
  'arm64-v8a': { elfClass: 2, machine: 183 },
  'armeabi-v7a': { elfClass: 1, machine: 40 },
  x86: { elfClass: 1, machine: 3 },
  x86_64: { elfClass: 2, machine: 62 },
};
const names = ['libonnxruntime.so', 'libsherpa-onnx-c-api.so', 'libsherpa-onnx-cxx-api.so', 'libsherpa-onnx-jni.so'];
const source = path.join(root, 'android-bridge', 'jniLibs');
const generated = path.join(root, 'android', 'app', 'src', 'main', 'jniLibs');
const apk = process.argv[2];
const fail = message => { throw new Error(message); };
function checkBuffer(buf, label, abi, name) {
  if (buf.length < 20 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) fail(`${label}: ${name} is not ELF`);
  const expected = abis[abi];
  if (buf[4] !== expected.elfClass) fail(`${label}: ${name} has wrong ELF class for ${abi}`);
  const machine = buf[18] | (buf[19] << 8);
  if (machine !== expected.machine) fail(`${label}: ${name} has machine ${machine}, expected ${expected.machine} for ${abi}`);
}
function checkFile(file, label, abi, name) { checkBuffer(fs.readFileSync(file), label, abi, name); }
for (const [abi, expected] of Object.entries(abis)) {
  for (const name of names) {
    const a = path.join(source, abi, name);
    const b = path.join(generated, abi, name);
    if (!fs.existsSync(a)) fail(`Missing source native library: ${a}`);
    if (!fs.existsSync(b)) fail(`Missing generated native library: ${b}`);
    checkFile(a, 'android-bridge/jniLibs', abi, name);
    checkFile(b, 'android/app/src/main/jniLibs', abi, name);
    if (!Buffer.from(fs.readFileSync(a)).equals(Buffer.from(fs.readFileSync(b)))) fail(`Generated native library differs from source: ${abi}/${name}`);
  }
}
if (apk) {
  if (!fs.existsSync(apk)) fail(`APK does not exist: ${apk}`);
  for (const [abi, expected] of Object.entries(abis)) {
    for (const name of names) {
      const entry = `lib/${abi}/${name}`;
      let buf;
      try { buf = execFileSync('unzip', ['-p', apk, entry], { maxBuffer: 64 * 1024 * 1024 }); } catch { fail(`APK is missing ${entry}`); }
      checkBuffer(buf, `APK:${entry}`, abi, name);
    }
  }
}
console.log(`Verified ${names.length} native libraries for ${Object.keys(abis).length} ABIs${apk ? ' and the APK' : ''}.`);
