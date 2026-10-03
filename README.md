<p align="center"><img src="icons/icon.svg" width="112" height="112" alt="Kantar icon: a steelyard scale with food in the pan"></p>

# Kantar

Kantar is a personal weight-loss tracker that runs in the browser. You give it a start weight, a
target weight and a date; it draws the schedule between them and helps you stick to a meal plan
until you get there. You log food by photo, by typing, or with one tap on a planned meal.

It is a single-user web app (PWA) with no backend and no account. You host the files yourself,
add the page to your phone's Home Screen, and all data stays on that phone.

"Kantar" is Turkish for a steelyard, the scale with a sliding weight on a graduated beam. The icon
shows one: food in the pan, the weight on the beam, the two in balance.

## What it does

- **Today:** the week as seven day tokens with your streak; the day's calories as a budget that
  burns down over the day, with the plan's pace beside it and a forecast for the evening; weight
  against the schedule, protein, the meals of the day with a suggestion for the next one, steps,
  water and the week's treats. Five daily goals (weigh-in, calories, protein, steps, water) make a
  perfect day.
- **Log:** everything you sent, one line per entry. Take a photo, choose photos from the library, or
  type. A model estimates calories and macros and lists each item with its amount and calories,
  including what it had to assume ("falafel, assumed fried"). Tell it in a few words what the photo
  does not show and it revises the items; you can also correct the portion, the numbers or the time.
- **Progress:** one token for every kilo collected, streaks and perfect days, the weight chart with
  a 7-day average, projected arrival date, a consistency calendar and checkpoints.
- **Plan:** the meal options with ingredients and amounts, and the rules of the plan.

Things that never need a model, and so cost nothing: planned meals, favourites, weight, steps,
water and workout days. Typing `85.4`, `8200 steps`, `water 2 glasses` or `workout` is understood
on the device.

## Privacy and data

- Entries, photos and settings are stored in the browser's IndexedDB on your device. Nothing is
  sent to a server of this project, because there is none.
- Photo and free-text analysis goes straight from your phone to the model provider you choose,
  with your own API key. Photos are downscaled to 768 px first.
- The API key is stored only on the device and is never written to a backup file.
- Photo location is off by default. When on, it is read on the device and matched to places you
  saved; the model only receives a label such as "Home" or "out", never coordinates.
- There is no sync. Back up from Settings → "Backup and export"; the backup is a JSON file you can restore on
  the same or another device.

## Get your own copy

1. Fork this repository, or push the files to a repository of your own. There are no secrets in
   the code, so it can be public.
2. Serve it over HTTPS from any static host. With GitHub Pages: repository → Settings → Pages →
   "Deploy from a branch", `main` / `(root)`. The app is then at `https://<user>.github.io/<repo>/`.
3. Open that address on your phone and add it to the Home Screen (on iPhone: Share → Add to Home
   Screen). The app then opens full screen and works offline.
4. Open Settings (top right) → Targets and enter your own dates, weights and daily targets.

The app is built for and used on an iPhone. Other modern mobile browsers should work but have
had less testing.

## Photo and text analysis

Optional. In Settings → "Photo and text analysis", choose a provider and enter your key:

- **OpenAI-compatible endpoints:** presets for Google Gemini (has a free tier), OpenCode and
  OpenRouter, or any base address and model you type in. "Save and test" checks both text and
  photo input; "find a model that reads photos" tries the provider's models one by one.
- **Claude:** an Anthropic API key from https://platform.claude.com, which needs prepaid credit.

If the provider is busy, the app retries and, where a preset lists them, falls back to other
models. If that also fails, the entry waits and is analysed later; nothing you sent is lost.

Estimates from a photo are rough. Treat them as a starting point and correct the portion when
it is off.

## Make it your plan

The repository ships with one example plan: about 1,550 kcal on rest days and 1,750 kcal on
workout days, 135 g of protein, lunch at 12:00, two snacks, dinner at 18:00.

- **Targets** (dates, weights, calories, protein) are changed in the app under Settings → Targets.
- **Meals and rules** live in `js/plan.js`:
  - `FOODS`: nutrition per 100 g, as `[kcal, protein, carbs, fat, fibre]`.
  - `TEMPLATES`: the meal options. Each has an id, a slot and a list of `[food, grams, measure]`.
    Calories and macros are computed from the food table, never typed by hand.
  - `SLOTS`: the meals of the day and their times.
  - `FLEX`: one-tap treats that count against the weekly budget.
  - `RULES`: the text shown on the Plan tab.
  - `DEFAULTS`: targets used before anything is saved in Settings.

  The model receives a short digest of the plan with every request, so it follows your changes
  without further setup.

The app uses kilograms, kilocalories and English (`en-GB` number and date formats).

## Export to SQLite

Settings → "Backup and export" → "Export for SQLite" saves one `.sql` file. It is plain text that
creates the tables and fills them, so any SQLite tool can load it:

```sh
sqlite3 kantar.db < kantar-export-2026-10-12.sql
```

Loading a newer export into the same database replaces the `kantar_*` tables and leaves everything
else in that database alone.

| Table or view | One row per | Columns |
|---|---|---|
| `kantar_days` | day | `day`, `weight_kg`, `steps`, `water_ml`, `workout`, `target_kcal`, `target_weight_kg` |
| `kantar_meals` | logged meal | `id`, `day`, `logged_at`, `slot`, `title`, `source`, `plan_id`, `tier`, `status`, `portion`, `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fibre_g`, `confidence`, `place`, `note`, `photos`, `flags` |
| `kantar_meal_items` | ingredient of a meal | `meal_id`, `position`, `name`, `grams`, `kcal`, `protein_g` |
| `kantar_settings` | setting | `key`, `value` (dates, weights and daily targets) |
| `kantar_daily` (view) | day | the day's values, the 7-day weight average, and the meal totals |

Calories, macros and grams are already multiplied by the portion. Only meals with `status = 'ok'`
have numbers. Photos, API keys and saved places are not exported.

```sql
-- weight against the schedule
SELECT day, weight_kg, weight_avg7_kg, target_weight_kg FROM kantar_daily ORDER BY day;

-- days over the calorie target
SELECT day, kcal, target_kcal FROM kantar_daily WHERE kcal > target_kcal;

-- what was off plan, and how much it cost
SELECT day, title, kcal FROM kantar_meals WHERE tier = 'off' AND status = 'ok' ORDER BY kcal DESC;
```

The export is for analysis. To move or restore the app's data, use the JSON backup.

## Development

There is no build step and there are no dependencies: plain HTML, CSS and JavaScript modules.

```sh
python3 -m http.server 8770
# then open http://localhost:8770/
```

The service worker serves the app from a versioned cache, so after the first load your edits do
not show up until you either bump the version (see below), use Settings → "Version and updates" →
"Clear cache and reload", or bypass the service worker in the browser's developer tools.

On `localhost` the app exposes `window.__kantar` for debugging.

## Releasing an update

Bump `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js` together, then deploy. Installed copies
find the new version when the app opens or comes to the front, and reload on their own. Stored
data is kept. The running version is shown under Settings → "Version and updates".

## Project layout

- `index.html`, `styles.css`: shell and styles
- `js/app.js`: state, calculations, storage, event handling
- `js/views.js`: the screens
- `js/plan.js`: food table, meal templates, targets, rules
- `js/ai.js`: model calls (Claude and OpenAI-compatible), prompt and output schema
- `js/exif.js`: reads capture time and location from a photo
- `js/db.js`: IndexedDB
- `js/export.js`: the SQL export
- `sw.js`: offline cache and updates
- `icons/`: `icon.svg` is the source; the PNG files are rendered from it for the Home Screen and
  the web app manifest

## Limits

- One user, one device. No sync and no multi-device merge; moving devices means restoring a backup.
- Browsers can evict web data when storage runs low. Adding the app to the Home Screen makes that
  less likely, and a regular backup covers the rest.
- This is a tracking tool, not medical or dietary advice. The example plan was written for one
  person; check your own targets with a professional if you have a health condition.
