# Kantar

86 kg'dan 78 kg'a (5 Ekim – 31 Aralık 2026) beslenme planı ve günlük takip.
Tek kullanıcılı, kurulumu "Ana Ekrana Ekle" olan bir web uygulaması (PWA).
Kayıtlar, fotoğraflar ve API anahtarı yalnızca telefonda durur.

## Kurulum

1. Bu klasördeki dosyaları bir GitHub reposuna yükle (kodda gizli bilgi yok, repo herkese açık olabilir).
2. Repo → Settings → Pages → "Deploy from a branch", `main` / `(root)`. Birkaç dakika sonra
   `https://<kullanıcı>.github.io/<repo>/` adresi açılır. Cloudflare Pages de olur; HTTPS şart.
3. iPhone'da adresi Chrome ya da Safari'de aç → Paylaş → Ana Ekrana Ekle.
4. Uygulamada sağ üstteki ayar düğmesi → Claude API anahtarı → "Kaydet ve dene".
   Anahtar: https://platform.claude.com → API Keys. Console'da düşük bir aylık harcama sınırı koy.
5. İstersen Ayarlar → Konum: evdeyken "Buradayım: Ev", ofisteyken "Buradayım: Ofis".

## Kullanım

- **Bugün:** plan öğününe dokun, kayıt düşer (token harcamaz). Tartı ve adım kutularına sayıyı yaz.
- **Akış:** fotoğraf çek, galeriden birkaç fotoğraf seç ya da yaz. Örnekler:
  `85,4` (tartı) · `8200 adım` · `su 2 bardak` · `antrenman` · `2 dilim pizza ve 1 bira`
- Galeriden seçilen fotoğrafın saati fotoğraftan okunur; 3 dakika içinde çekilmiş kareler tek öğün sayılır.
- Kartta porsiyonu ½ / 1 / 1½ / 2 ile düzelt; "Sık yenenlere ekle" ile bir dahaki sefere tek dokunuş.
- **Yedek:** Ayarlar → "Yedeği kaydet" → Dosyalar. Haftada bir yap.

## Güncelleme

Dosyaları değiştirdikten sonra `sw.js` içindeki `VERSION` değerini artır (ör. `kantar-v2`).
Uygulama bir sonraki açılışta "Yeni sürüm hazır" der.

## Dosyalar

- `js/plan.js` — besin tablosu, öğün şablonları, hedefler, kurallar
- `js/ai.js` — Claude API çağrısı, istem ve çıktı şeması
- `js/exif.js` — fotoğraftan saat ve konum okuma
- `js/app.js`, `js/views.js` — durum, hesaplar ve ekranlar
- `js/db.js` — IndexedDB
