// The release number, the one place it is written: bump it on every release.
// A plain script, so both sides can load it: sw.js with importScripts (the browser's update check compares imported
// scripts byte for byte, so a bump here alone brings the new release) and js/core.js as a module import.
globalThis.WEIGHTPLAN_VERSION = '64';
