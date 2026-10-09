// Turkish words the typed-entry parser accepts next to the English ones, whatever the interface language is, so "2 bardak su" works in
// an English interface too. Kept apart from js/tr.js (the interface text, loaded only for Turkish) because the parser needs these always.
// Every word is stored folded (see foldKey in js/i18n.js: no capitals, no Turkish letters), and the typed text is folded the same way.
export const PARSE_TR = {
  steps: ['adim'], // "8200 adım"
  water: ['su'], // "2 bardak su", "su 500 ml"
  glass: ['bardak'],
  litre: ['litre', 'lt'],
  weight: ['kilo'], // "kilo 82,5"
  workout: ['antrenman', 'spor', 'idman'], // "antrenman yaptım"
  workoutEnd: ['yaptim', 'gunu'], // after the workout word: "done", "day"
  coffee: ['kahve'],
  beer: ['bira'],
  one: ['bir'], // "bir kahve"
};
