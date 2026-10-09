// The app keeps its data in IndexedDB, and on iOS Safari and the Home Screen app do not share it. So it only runs
// installed; a browser tab gets an install screen and never opens the database. localhost stays open for development.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

export function canRun(win) {
  const standalone = win.navigator.standalone === true || (!!win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  return standalone || LOCAL.includes(win.location.hostname) || win.location.protocol === 'file:';
}

// The install screen shows before anything is loaded, so its few sentences live here in both languages instead of in js/tr.js
// (which loads asynchronously and not for English) and are chosen at once. The language mirror in localStorage (see js/i18n.js) decides;
// without one the screen is English: the app never guesses a language from the phone.
const TEXT = {
  en: {
    title: 'Add Pickle to your Home Screen',
    intro: 'Pickle keeps your log on this device, and a browser tab and the Home Screen app do not share it. Open it from the Home Screen so everything stays in one place.',
    steps: ['Open this page in Safari on your iPhone.', 'Tap Share, then "Add to Home Screen".', 'Open Pickle from the Home Screen.'],
  },
  tr: {
    title: 'Pickle’ı Ana Ekran’a ekle',
    intro: 'Pickle kaydını bu cihazda tutar; tarayıcı sekmesi ile Ana Ekran uygulaması bu kaydı paylaşmaz. Her şey tek yerde kalsın diye Pickle’ı Ana Ekran’dan aç.',
    steps: ['Bu sayfayı iPhone’unda Safari’de aç.', 'Paylaş’a dokun, sonra “Ana Ekrana Ekle”yi seç.', 'Pickle’ı Ana Ekran’dan aç.'],
  },
};
export function installLang() {
  try { const v = localStorage.getItem('lang'); if (v === 'en' || v === 'tr') return v; } catch { /* no storage */ }
  return 'en';
}

export function installHtml(lang = installLang()) {
  const x = TEXT[lang] || TEXT.en;
  return `<div class="empty install"${lang === 'tr' ? ' lang="tr"' : ''}>
  <h1>${x.title}</h1>
  <p>${x.intro}</p>
  <ol>
${x.steps.map((s) => `    <li>${s}</li>`).join('\n')}
  </ol>
</div>`;
}
