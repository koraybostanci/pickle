# Kantar

A nutrition plan and daily tracker for going from 86 kg to 78 kg (5 October to 31 December 2026).
It is a single-user web app (PWA) that installs with "Add to Home Screen".
Entries, photos and the API key stay on the phone.

"Kantar" is Turkish for a weighing scale.

## Setup

1. Push the files in this folder to a GitHub repository. There are no secrets in the code, so the
   repository can be public.
2. Repository → Settings → Pages → "Deploy from a branch", `main` / `(root)`. A few minutes later the
   app is live at `https://<user>.github.io/<repo>/`. Cloudflare Pages works too; HTTPS is required.
3. On the iPhone, open the address in Safari or Chrome → Share → Add to Home Screen.
4. In the app, tap the settings button at the top right → "Photo and text analysis" and choose a provider:
   - **OpenAI-compatible** (Gemini free tier, OpenCode Zen/Go, OpenRouter): pick the preset, enter the
     key, then "Save and test". If the model cannot read photos, use "find a model that reads photos".
   - **Claude:** create a key at https://platform.claude.com → API Keys; it needs prepaid credit.

   Plan meals, weight, steps and water work without any provider.
5. Optional: Settings → Location. Tap "I am here: Home" at home and "I am here: Office" at the office.

## Using it

- **Today:** tap "Log this meal" in the next-meal card (uses no tokens). Tap the weigh-in or steps row
  to enter a number.
- **Log:** take a photo, choose several from the library, or type. Examples:
  `85.4` (weight), `8200 steps`, `water 2 glasses`, `workout`, `2 slices of pizza and a beer`.
- Each entry is one line: time, name, calories and, for photos, a small thumbnail. Tap it to see the
  photo and to correct the portion (½ / 1 / 1½ / 2), calories, meal or time, or to delete it.
- A photo chosen from the library keeps its capture time; photos taken within 3 minutes of each other
  count as one meal.
- "Add to favourites" on an entry makes it a one-tap chip on the Log tab.
- **Backup:** Settings → Backup → "Save backup" → Files. Do it once a week.

## Updating

After changing files, bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js` together. The app
finds the new version when it opens or comes to the front, and reloads. The running version is shown
under Settings → "Version and updates", next to buttons for checking manually and clearing the cache.

Data written by version 5 and earlier (Turkish field values) is converted on first launch, and older
backup files are converted on import.

## Files

- `js/plan.js`: food table, meal templates, targets, rules
- `js/ai.js`: model calls (Claude and OpenAI-compatible), prompt and output schema
- `js/exif.js`: reads capture time and location from a photo
- `js/app.js`, `js/views.js`: state, calculations and screens
- `js/db.js`: IndexedDB
- `sw.js`: offline cache and updates
