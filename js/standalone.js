// The app keeps its data in IndexedDB, and on iOS Safari and the Home Screen app do not share it. So it only runs
// installed; a browser tab gets an install screen and never opens the database. localhost stays open for development.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

export function canRun(win) {
  const standalone = win.navigator.standalone === true || (!!win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  return standalone || LOCAL.includes(win.location.hostname) || win.location.protocol === 'file:';
}

export function installHtml() {
  return `<div class="empty install">
  <h1>Add Pickle to your Home Screen</h1>
  <p>Pickle keeps your log on this device, and a browser tab and the Home Screen app do not share it. Open it from the Home Screen so everything stays in one place.</p>
  <ol>
    <li>Open this page in Safari on your iPhone.</li>
    <li>Tap Share, then "Add to Home Screen".</li>
    <li>Open Pickle from the Home Screen.</li>
  </ol>
</div>`;
}
