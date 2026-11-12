# Ürün Aktarıcı — Proje Raporu

12.11.2026 · Projeyi hiç bilmeyen bir geliştirici için hazırlanmıştır. Kullanım ayrıntıları için `README.md` dosyasına da bakın.

## İçindekiler

1. [Proje ne işe yarıyor?](#1-proje-ne-işe-yarıyor)
2. [Teknoloji yığını](#2-teknoloji-yığını)
3. [Klasör yapısı ve dosyaların görevi](#3-klasör-yapısı-ve-dosyaların-görevi)
4. [Bir ürün linkinin yolculuğu](#4-bir-ürün-linkinin-yolculuğu)
5. [Ekranlar ve özellikler](#5-ekranlar-ve-özellikler)
6. [API uç noktaları](#6-api-uç-noktaları)
7. [Veri modeli](#7-veri-modeli)
8. [Kurulum, çalıştırma ve geliştirme](#8-kurulum-çalıştırma-ve-geliştirme)
9. [Bilinen sınırlamalar ve dikkat edilecekler](#9-bilinen-sınırlamalar-ve-dikkat-edilecekler)
10. [Sitelerle entegrasyon ve sonraki adımlar](#10-sitelerle-entegrasyon-ve-sonraki-adımlar)
11. [Terimler sözlüğü](#11-terimler-sözlüğü)

---

## 1. Proje ne işe yarıyor?

Ürün Aktarıcı, bir ürün sayfasının linkini alıp o üründen e-ticaret sitesine girilecek tüm bilgileri otomatik çıkaran, yerelde çalışan bir web uygulamasıdır. Elle kopyala-yapıştır ile saatler süren ürün girişini birkaç dakikaya indirir.

**Çözdüğü problem:** Ekip; Türkçe, İngilizce ve Hollandaca olmak üzere üç ayrı e-ticaret sitesi işletiyor. Her yeni ürün için üretici sitesinden ad, açıklama, özellik tablosu, stok kodu ve görselleri alıp üç dile çevirmek ve her siteye ayrı ayrı girmek gerekiyor. Bu uygulama bu işin büyük kısmını yapar.

**Kim kullanır:** Ürün girişi yapan ekip. Şu an tek bilgisayarda çalışan bir araç; ileride üç sitenin yönetim paneline entegre edilmesi planlanıyor (bkz. bölüm 10).

**Bir linkten neler çıkarır:**

- Ürün adı, stok kodu (SKU), barkod, marka, fiyat, kategori
- Kısa açıklama (1-2 okunur cümle) ve standart düzende uzun açıklama
- Özellik tablosu ("Ağırlık: 1,8 kg" gibi satırlar)
- Varyantlar (renk, beden ve her birinin stok kodu ile fiyatı)
- Görseller (en yüksek çözünürlükte bulunup 800×800 WebP'ye çevrilir)
- Belgeler (datasheet, kullanım kılavuzu, çizimler)
- Bunların hepsi Türkçe, İngilizce ve Hollandaca olarak

**Çıktı olarak verdikleri:** WooCommerce ve Shopify'ın doğrudan içe aktarabildiği CSV dosyaları, Excel'de açılan genel CSV, JSON, özellik tablosu HTML dosyası ve görsellerin ZIP'i.

**Önemli kısıt:** Uygulama tamamen ücretsiz çalışacak şekilde tasarlandı; ücretli bir yapay zekâ ya da çeviri servisi kullanılmıyor. Kodda pasif bir Claude seçeneği var ama kullanıcı tercihiyle kapalı.

## 2. Teknoloji yığını

Proje baştan sona **JavaScript** ile yazıldı: sunucu Node.js üzerinde, arayüz çerçevesiz düz HTML/CSS/JS. Veritabanı yok; kayıtlar JSON dosyalarında.

| Teknoloji | Sürüm | Ne için kullanılıyor | Neden bu seçildi |
| --- | --- | --- | --- |
| Node.js | 24 | Sunucunun çalıştığı ortam | Tarayıcı otomasyonu ve görsel işleme için en olgun kütüphaneler Node'da |
| Express | 4 | HTTP sunucusu ve API uç noktaları | En yaygın, en basit Node web sunucusu |
| Playwright + Chromium | 1.x | Görünmez (headless) Chrome: sayfayı açar, sekmelere tıklar, kaydırır, ekran görüntüsü alır | JavaScript ile sonradan yüklenen içerik düz HTTP isteğiyle gelmez |
| Cheerio | 1 | İndirilen HTML'i jQuery benzeri seçicilerle okur | Tarayıcı açmadan hızlı HTML ayrıştırma |
| Sharp | 0.35 | Görselleri ölçer, 800×800 WebP'ye çevirir | En hızlı Node görsel kütüphanesi (libvips) |
| JSZip | 3 | Görselleri ZIP olarak paketler | Bağımlılığı az, güvenlik uyarısı yok |
| Google Çeviri (anahtarsız uç nokta) | — | TR / EN / NL çeviri | Ücretsiz; resmi API değil (bkz. bölüm 9) |
| @anthropic-ai/sdk + zod | — | Pasif Claude çeviri yolu | Sadece `ANTHROPIC_API_KEY` tanımlıysa devreye girer; şu an kullanılmıyor |

Tüm paketler `package.json` dosyasında listelidir ve `npm install` ile kurulur. Chromium tarayıcısı proje klasörüne değil `AppData\Local\ms-playwright` altına iner (yaklaşık 740 MB).

## 3. Klasör yapısı ve dosyaların görevi

Projenin tamamı tek klasörde: `Desktop\Proje Klasörü\urun-aktarici`. Her dosyanın tek bir sorumluluğu var; bir özelliği değiştirmek için genelde tek dosyaya dokunmak yeter.

```
urun-aktarici/
├── server.js        sunucu ve API uç noktaları
├── extract.js       sayfadan bilgi çıkarma (projenin kalbi)
├── render.js        sayfayı tarayıcıda açma, ekran görüntüsü
├── format.js        açıklama ve kısa açıklama düzeni
├── translate.js     çeviri
├── postprocess.js   terim sözlüğü, sabit metinler
├── images.js        görselleri ölçme, 800×800 WebP, ZIP
├── export.js        WooCommerce / Shopify / Excel / JSON dışa aktarma
├── storage.js       kayıtlar ve ayarlar (data/)
├── bulk.js          toplu işlem sırası
├── public/          arayüz
│   ├── index.html
│   ├── app.js       Ürün ekranı
│   ├── views.js     Toplu / Kaydedilenler / Ayarlar ekranları
│   └── style.css
├── data/            kayıtlı ürünler ve ayarlar (git'e girmez)
├── node_modules/    indirilen kütüphaneler (git'e girmez)
├── package.json
├── baslat.bat
├── README.md
└── PROJE_RAPORU.md  bu dosya
```

| Dosya | Katman | Ne yapar | Ne zaman açılır |
| --- | --- | --- | --- |
| `server.js` | Sunucu | Express sunucusunu başlatır, tüm API uç noktalarını tanımlar, arayüz dosyalarını sunar | Yeni bir uç nokta eklerken |
| `extract.js` | Çekme | Projenin kalbi. Sayfayı indirir; JSON-LD, microdata, Shopify verisi ve sayfa içeriğinden ad, SKU, açıklama, özellik tablosu, görsel adayları, belgeler ve varyantları çıkarır; tüm sayfayı bölümlere ayırır; dillere dağıtır | Bir sitede bilgi eksik geliyorsa |
| `render.js` | Çekme | Playwright ile sayfayı görünmez Chrome'da açar, çerezi kabul eder, kaydırır, sekme ve akordeonlara tıklar; orijinal sayfanın ekran görüntüsünü alır | Sekme içeriği gelmiyorsa |
| `format.js` | İçerik | Açıklamayı standart düzene sokar (giriş + Öne Çıkan Özellikler + Kutu İçeriği); kısa açıklamayı okunur cümlelerden seçer | Açıklama düzeni değişecekse |
| `translate.js` | İçerik | Metni parçalara bölüp Google Çeviri'ye gönderir, HTML yapısını koruyarak geri birleştirir; 429 hatasında bekleyip yeniden dener | Çeviri sağlayıcısı değişecekse |
| `postprocess.js` | İçerik | Terim sözlüğünü ve sabit metinleri (garanti, kargo) uygular | Sözlük davranışı değişecekse |
| `images.js` | Görsel | Görsel adaylarını indirip boyutunu ölçer, yer tutucu/kopya/küçük resimleri atar; 800×800 WebP'ye çevirir; ZIP yapar | Görsel kalitesi ya da boyutu değişecekse |
| `export.js` | Çıktı | WooCommerce, Shopify, genel CSV ve JSON dosyalarını üretir; fiyatları normalize eder | Platform formatı değişecekse |
| `storage.js` | Veri | Ürün kayıtlarını ve ayarları `data/` altında JSON olarak okur/yazar | Veritabanına geçilecekse |
| `bulk.js` | İş sırası | Toplu işlem: linkleri tek tek sırayla işler ve kaydeder | Toplu işlem davranışı değişecekse |
| `public/index.html` | Arayüz | Sayfa iskeleti; dört ekranın HTML'i | Ekrana alan eklerken |
| `public/app.js` | Arayüz | Ürün ekranının tüm mantığı: istek, dil sekmeleri, düzenleme, kaydetme, dışa aktarma, görseller | Ürün ekranı değişecekse |
| `public/views.js` | Arayüz | Toplu, Kaydedilenler ve Ayarlar ekranları + sayfa geçişleri | Bu üç ekran değişecekse |
| `public/style.css` | Arayüz | Tüm stiller; açık/koyu tema renk değişkenleri | Görünüm değişecekse |
| `data/` | Veri | Kayıtlı ürünler (`products/*.json`) ve `settings.json`; git'e girmez | Yedek alırken |
| `baslat.bat` | Araç | Çift tıklayınca gerekirse kurulum yapar, sunucuyu başlatır, tarayıcıyı açar | — |
| `README.md` | Belge | Kullanım ve davranış açıklamaları | İlk okunacak dosya |

`node_modules/` (yaklaşık 97 MB) indirilen kütüphanelerdir; elle düzenlenmez, `npm install` ile yeniden oluşturulur.

## 4. Bir ürün linkinin yolculuğu

Bir ürün linki yedi adımda düzenlenmiş, üç dilli bir ürüne dönüşür:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1 · Link gelir                                                               │
│     Ürün ekranı, Toplu ekran ya da ileride sitelerin paneli                  │
│     → POST /api/extract (server.js)                                          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2 · Sayfa okunur — render.js                                                 │
│     Varsayılan: görünmez Chrome açılır; çerez kabul edilir, sayfa kaydırılır,│
│     sekme ve akordeonlara tıklanır.                                          │
│     Hızlı mod: düz HTTP isteği (extract.js → fetchPage).                     │
│     Yapıştırılan HTML: hiçbir şey indirilmez.                                │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 3 · Bilgiler ayıklanır — extract.js (projenin kalbi)                         ┃
┃     Kaynak sırası: JSON-LD → Shopify → microdata → sayfa içeriği → meta      ┃
┃     Sayfa bölümlere ayrılır; ad, SKU, özellikler, varyantlar, belgeler ve    ┃
┃     görsel adayları çıkar                                                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4 · Metin düzenlenir — format.js                                             │
│     Açıklama: giriş + Öne Çıkan Özellikler + Kutu İçeriği                    │
│     Kısa açıklama: okunur 1-2 cümle                                          │
└───────────────────┬───────────────────────────────────────┬──────────────────┘
                    ▼               aynı anda               ▼
┌─────────────────────────────────────┐ ┌──────────────────────────────────────┐
│ 5a · Diller — translate.js          │ │ 5b · Görseller — images.js           │
│     Her dil: sayfanın kendi dili,   │ │     Adaylar indirilip boyutları      │
│     yoksa sitenin hreflang sayfası, │ │     ölçülür; yer tutucu, küçük resim │
│     yoksa Google çeviri             │ │     ve kopyalar atılır               │
└───────────────────┬─────────────────┘ └─────────────────────┬────────────────┘
                    ▼                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 6 · Ayarlar uygulanır — postprocess.js                                       │
│     Terim sözlüğü düzeltmeleri + her dile sabit metin (garanti, kargo)       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 7 · Sonuç ekrana döner                                                       │
│     storage.js ürünü otomatik kaydeder (data/products).                      │
│     export.js istenince WooCommerce / Shopify / Excel dosyası,               │
│     images.js 800×800 WebP üretir.                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Bir ürünü tarayıcı modunda çekmek 20-60 saniye sürer; en uzun adımlar sayfanın açılması (2) ve çeviridir (5a).

Kodda karşılığı: `server.js /api/extract` → `extract.js extractProduct()` → `render.js renderPage()` → `parseProduct()` → `addTranslations()` (format, çeviri, görsel ölçümü ve ayarlar burada). Bir hatayı izlerken bu sırayla ilerlemek en hızlı yoldur.

## 5. Ekranlar ve özellikler

Uygulama `http://localhost:4000` adresinde açılır; üst menüde dört ekran vardır. Ekranlar arası geçiş adres çubuğundaki `#urun`, `#toplu`, `#kayitlar`, `#ayarlar` ile yapılır (`views.js` → `showView`).

### Ürün ekranı (`app.js`)

1. Link girilir, **Bilgileri Getir**'e basılır. Varsayılan olarak sayfa tarayıcıda açılır (20-60 sn). **Hızlı mod** kutusu tarayıcı açmadan okur (birkaç saniye, ama sonradan yüklenen içerik gelmeyebilir).
2. Site botları engelliyorsa **Sayfa kaynağını yapıştır** alanına tarayıcıdan kopyalanan HTML yapıştırılır.
3. Sonuç gelince ürün otomatik kaydedilir. Ekrandaki bölümler:

| Bölüm | Ne gösterir | Kullanıcı ne yapabilir |
| --- | --- | --- |
| Araç çubuğu | Verinin kaynağı (JSON-LD, Shopify…) ve modu | **Kaydet**; biçim (WooCommerce / Shopify / Excel / JSON) ve dil seçip **Dışa aktar** |
| Orijinal sayfa | Kaynak site | Yeni sekmede aç; tam sayfa ekran görüntüsünü uygulamanın içinde gör |
| Ortak alanlar | Stok kodu, barkod, marka, fiyat, para birimi | Düzenle (üç dil için tek değer) |
| TR / EN / NL sekmeleri | Her dilin kaynağı: orijinal, sitenin kendi sayfası, Google çeviri | Dil değiştir; düzenlemeler dil başına saklanır |
| Ürün adı, kategori, kısa açıklama | Seçili dilin metinleri | Düzenle, kopyala |
| Açıklama | Önizleme / HTML / Düz metin / Sitedeki metin sekmeleri | Önizlemede doğrudan yaz; HTML'i elle düzenle; orijinali karşılaştır |
| Özellik tablosu | Anahtar–değer satırları | Satır ekle/sil; HTML indir; HTML ya da metin kopyala |
| Varyantlar | Renk, beden vb. (varsa) | Stok kodu, fiyat, barkod, stok durumu düzenle |
| Sayfadaki tüm bölümler | Sayfada bulunan her içerik bloğu | Otomatik yerleşmeyen bir bölümü özelliklere ya da açıklamaya ekle (üç dile çevrilerek) |
| Görseller | 800×800 WebP önizlemeler + kaynak boyutu (800'den küçükse ⚠) | × ile kaldır; tek tek ya da ZIP indir |
| Belgeler | Datasheet, kılavuz, çizim linkleri | Linkleri kopyala |

### Toplu ekranı (`views.js` + `bulk.js`)

Her satıra bir link yapıştırılır, **Başlat**'a basılır. Linkler sırayla, aynı anda tek ürün olacak şekilde işlenir ve her biri bitince kaydedilir. Ekran 2 saniyede bir sunucuya durumu sorar. **Durdur** mevcut ürün bitince durdurur. Link olmayan satırlar atlanır ve sayısı yazılır.

### Kaydedilenler ekranı (`views.js`)

Tüm kayıtlı ürünler küçük resim, ad, stok kodu, site ve tarihle listelenir. Ad, stok kodu ya da siteye göre aranır. Bir ürün açılınca Ürün ekranına kaldığı yerden gelir. Seçilen ürünler tek dosyada dışa aktarılabilir ya da silinebilir.

### Ayarlar ekranı (`views.js` + `postprocess.js`)

- **Terim sözlüğü:** dil + aranan + yerine. Çeviri hatalarını düzeltir (ör. TR: "Gofret" → "Wafer"). Tam kelime eşleşir, büyük/küçük harf fark etmez.
- **Sabit metinler:** her dilde açıklamanın sonuna eklenen metin (garanti, kargo).

Ayarlar sadece bundan sonra çekilen ürünlere uygulanır; geçmiş kayıtları değiştirmez.

## 6. API uç noktaları

Arayüz sunucuyla sadece bu uç noktalar üzerinden konuşur; hepsi `server.js` içinde tanımlı. İleride sitelerin yönetim paneli de aynı uç noktaları kullanacak. Gövdeler JSON'dur.

| Yöntem | Yol | Girdi | Çıktı |
| --- | --- | --- | --- |
| POST | `/api/extract` | `{ url, html?, fast? }` — `html` verilirse sayfa indirilmez, `fast` tarayıcı açmaz | Tüm ürün verisi + `translations` (TR/EN/NL) + `sections` + `images` |
| POST | `/api/translate` | `{ fields, from, to }` | Çevrilmiş alanlar (sözlük uygulanmış) |
| GET | `/api/image?url=&ref=&name=&download=` | Görsel adresi, kaynak sayfa | 800×800 WebP görsel |
| POST | `/api/images.zip` | `{ urls, name, ref }` | WebP görsellerin ZIP'i (hatalılar `hatalar.txt` içinde) |
| GET | `/api/snapshot?url=` | Sayfa adresi | Tam sayfa ekran görüntüsü (JPEG, en fazla 12.000 px yükseklik) |
| GET | `/api/products` | — | Kayıtlı ürünlerin özet listesi |
| GET | `/api/products/:id` | — | Tek kayıt: `{ id, createdAt, savedAt, record, state }` |
| POST | `/api/products` | `{ id?, record, state }` — `id` varsa günceller | Kayıt özeti |
| DELETE | `/api/products/:id` | — | `{ ok: true }` |
| POST | `/api/export` | `{ format, lang, ids? \| records? }` — format: `woocommerce`, `shopify`, `csv`, `json` | İndirilecek dosya |
| GET | `/api/settings` | — | `{ glossary, footers }` |
| PUT | `/api/settings` | `{ glossary, footers }` | Kaydedilen ayarlar |
| POST | `/api/bulk` | `{ urls, fast? }` | Toplu iş durumu (zaten çalışıyorsa 409) |
| GET | `/api/bulk` | — | Güncel toplu iş durumu ya da `null` |
| POST | `/api/bulk/stop` | — | Durdurma isteği alınmış iş durumu |

Hatalar `{ error: "Türkçe açıklama" }` olarak döner. Şu an kimlik doğrulama yok; uygulama sadece yerel makinede çalıştığı için kabul edilebilir, ama sitelere bağlanmadan önce eklenmeli (bölüm 10).

## 7. Veri modeli

Kaydedilen her ürün `data/products/<id>.json` dosyasıdır ve iki parça taşır: dışa aktarmaya giden temiz **record** ve ürünü ekranda kaldığı yerden açmak için tam **state**. `id`, stok kodundan ya da ürün adından türetilir (ör. `d137-mwdjcgkj`).

```json
{
  "id": "d137-mwdjcgkj",
  "createdAt": "2026-11-12T12:39:59Z",
  "savedAt": "2026-11-12T12:39:59Z",
  "record": {
    "url": "https://…/product-detail/D137",
    "sku": "D137", "barcode": "", "brand": "", "price": "", "currency": "",
    "images": ["https://…/1.jpeg"],
    "documents": [{ "title": "D137 User Manual", "group": "User Manual", "file": "…pdf", "url": "https://…" }],
    "variants": [{ "title": "8", "sku": "TR3MJBW080", "barcode": "…", "price": "70.00", "available": true, "options": { "Size": "8" } }],
    "languages": {
      "tr": {
        "name": "…", "category": "…", "shortDescription": "…",
        "descriptionHtml": "<p>…</p><h3>Öne Çıkan Özellikler</h3>…",
        "descriptionText": "…",
        "specs": [{ "title": "Specifications", "rows": [{ "key": "Model", "value": "D137" }] }]
      },
      "en": { "…": "…" },
      "nl": { "…": "…" }
    }
  },
  "state": { "…": "/api/extract çıktısı + ekrandaki düzenlemeler" }
}
```

**Dilden bağımsız alanlar** (`sku`, `barcode`, `brand`, `price`, `images`, `documents`, `variants`) record'un üst seviyesinde, **dile bağlı alanlar** `languages.<dil>` altında durur. Özellik tablosu HTML değil `key` / `value` satırları olarak tutulur; HTML'e sadece dışa aktarırken çevrilir.

`state` ek olarak ekran için gerekenleri taşır: her dilin kaynağı (`source`: original / site / google / error), sitedeki düzenlenmemiş açıklama, sayfanın tüm bölümleri (`sections`), görsellerin ölçülen boyutları ve kaldırılanlar.

**Ayarlar** `data/settings.json` dosyasında:

```json
{ "glossary": [{ "lang": "tr", "find": "Gofret", "replace": "Wafer" }], "footers": { "tr": "…", "en": "", "nl": "" } }
```

Dosyalar önce `.tmp` olarak yazılıp sonra yeniden adlandırılır; yazma sırasında kesinti olursa yarım dosya kalmaz.

## 8. Kurulum, çalıştırma ve geliştirme

Gereken tek şey Node.js (sürüm 20 ve üzeri; projede 24 kullanılıyor). İlk kurulum yaklaşık 1 GB indirir (kütüphaneler + Chromium).

**İlk kurulum ve çalıştırma**

1. Klasörde bir terminal aç: `cd "Desktop\Proje Klasörü\urun-aktarici"`
2. Kütüphaneleri kur: `npm install`
3. Tarayıcıyı kur: `npx playwright install chromium`
4. Sunucuyu başlat: `npm start` → konsolda "Ürün Aktarıcı çalışıyor: http://localhost:4000"
5. Tarayıcıda `http://localhost:4000` adresini aç.

Kolay yol: `baslat.bat` dosyasına çift tıklamak 2-5. adımları kendisi yapar.

**Geliştirirken**

- `npm run dev` sunucuyu `node --watch` ile çalıştırır; bir `.js` dosyası kaydedilince sunucu kendini yeniden başlatır.
- `public/` altındaki dosyalar (arayüz) için sunucuyu yeniden başlatmak gerekmez; tarayıcıda F5 yeter.
- Port değiştirmek için: PowerShell'de `$env:PORT=5000; npm start`.
- Bir sitede bir alan eksik geliyorsa en hızlı yol: sayfanın HTML'ini kaydedip `extract.js` içindeki `parseProduct(html, url)` fonksiyonunu doğrudan Node'dan çağırmak. Tarayıcı ve çeviri devreye girmez, saniyede sonuç alınır.

**Test etme**

Projede otomatik test paketi yok; şimdiye kadar elle ve Playwright betikleriyle test edildi. Her değişiklikten sonra en az şu linklerle denenmeli (hepsi farklı bir yapıyı temsil eder):

| Link | Neyi test eder |
| --- | --- |
| `professional.avermedia.com/product-detail/D137` | Başlıkla işaretlenmiş özellik tablosu, Download sekmesindeki belgeler, sayfa içi görseller |
| `allbirds.com/products/mens-tree-runners` | Shopify verisi, 7 beden varyantı, gizli teknik detay paneli, 1600 px görseller |
| `books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html` | Yapısal verisi olmayan basit HTML |
| `decathlon.com.tr/…` | Bot engeli (403): hata mesajı ve "kaynak yapıştır" yolu |

İlk iş olarak `parseProduct` için bu sayfaların kaydedilmiş HTML'leriyle birkaç otomatik test yazmak iyi bir başlangıç görevidir.

**Kod değişiklikleri** git ile takip edilir (`git log` ile geçmiş görülür). Uzak sunucu (GitHub vb.) tanımlı değil; kod şu an sadece bu bilgisayarda.

## 9. Bilinen sınırlamalar ve dikkat edilecekler

Araç çoğu sitede iş görür ama her siteyi kusursuz okumaz; çıktı her zaman bir insan tarafından kontrol edilmek için tasarlandı.

| Konu | Ne oluyor | Ne yapılır |
| --- | --- | --- |
| Bellek | Tarayıcı modu her üründe görünmez bir Chrome açar. Bu bilgisayarda bellek azalınca sunucu iki kez sistem tarafından kapatıldı. | Hızlı modu kullan; toplu işlem zaten aynı anda tek ürün işler. Sunucuda en az 1-2 GB bellek ayır. |
| Bot engelleri | Bazı siteler (ör. Decathlon) otomatik isteği gerçek tarayıcı dahil 403 ile reddeder. | "Sayfa kaynağını yapıştır" alanı. |
| Ücretsiz çeviri | Kullanılan Google uç noktası resmi değil; sık istekte 429 verir, teknik terimleri bozabilir ("Wafer" → "Gofret"). | Kod bekleyip yeniden dener; terim sözlüğü düzeltir. Canlı sistemde resmi bir çeviri API'sine geçilmeli. |
| Sezgisel ayıklama | Özellik tablosu, açıklama ve görseller site yapısına bakılarak kurallarla bulunur; yeni bir site yapısı bir şeyi kaçırabilir. | "Sayfadaki tüm bölümler" listesinden elle ekle; gerekirse `extract.js`'e kural ekle. |
| Açıklama metni | Yeniden yazılmaz; üreticinin cümleleri seçilip kısaltılır. Arama motorları kopya içerik sayabilir. | Yayınlamadan önce düzenle. |
| Küçük görseller | Site 800 px'den küçük görsel yayınlıyorsa büyütülen WebP net olmaz. | Ekranda ⚠ ile işaretlenir; kaldırılabilir. |
| Tekrarlanan kayıtlar | Aynı link her çekildiğinde yeni kayıt oluşur. | Planlanan iyileştirme: aynı linkte eski kaydı güncellemek. |
| Ayarlar geriye dönük değil | Sözlük ve sabit metinler sadece yeni çekilen ürünlere uygulanır. | — |
| Platform dosyaları | WooCommerce/Shopify CSV'leri resmi sütun düzenine göre üretildi ama gerçek bir mağazaya yüklenip denenmedi. | İlk yüklemeyi birkaç ürünle yap. |
| Kimlik doğrulama | API'de hiç yok. | Sadece yerelde çalıştığı sürece sorun değil; dışarı açılmadan önce eklenmeli. |
| Telif | Başka sitelerin metin ve görselleri kullanılıyor. | Üretici sayfaları genelde sorun olmaz; diğer satıcı sitelerinden alma konusunu netleştir. |

## 10. Sitelerle entegrasyon ve sonraki adımlar

Plan: WooCommerce'in yerine ekibin kendi yazdığı üç e-ticaret sitesi (TR, EN, NL) gelecek ve bu modül her sitenin yönetim panelindeki "Ürün ekle" sayfasına bağlanacak. Henüz yapılmadı; aşağıdaki adımlar önerilen yol.

**Önerilen yapı:** Modül ayrı bir servis olarak çalışır. Her site, kendi dilini belirterek HTTP üzerinden çağırır (ör. `/api/extract?lang=nl`) ve sadece o dildeki içeriği alır. Gelen veri ürün formuna dolar; yönetici kontrol edip sitenin kendi veritabanına kaydeder. Siteler hangi dille yazılırsa yazılsın (Python/Django, PHP, Node) modülü kullanabilir.

```
TR sitesi paneli ──▶ /api/extract?lang=tr ──┐
EN sitesi paneli ──▶ /api/extract?lang=en ──┼──▶ Ürün Aktarıcı servisi ──▶ önbellek (sayfa bir kez açılır)
NL sitesi paneli ──▶ /api/extract?lang=nl ──┘
```

**Modülde yapılacaklar (öncelik sırasıyla)**

1. Dil seçerek çağırma (`lang=tr|en|nl`): istek başına tek dile çeviri.
2. Önbellek: aynı link ikinci ve üçüncü siteden istenince sayfa yeniden açılmaz, sadece çeviri yapılır; görseller bir kez dönüştürülür.
3. Erişim anahtarı: API'yi sadece sitelerin sunucusu çağırabilsin.
4. Kayıt yerine veri döndürme: entegre modda `data/` klasörüne yazmak yerine veriyi döndürmek; WebP görselleri sitenin depolama alanına yüklemek.
5. Docker ile kurulum (Playwright'ın hazır imajı), en az 1-2 GB bellek.
6. Çoklu kullanıcı için iş kuyruğu.
7. Resmi bir çeviri API'sine geçiş (Google Cloud Translation, DeepL ya da ileride Claude); terim sözlüğü korunur.

**Sitelerin veritabanı için öneriler**

- Stok kodu üç sitede ortak anahtar olsun: fiyat/stok güncellemeleri eşleşir ve sayfalara `hreflang` etiketleri eklenebilir (Google üç siteyi aynı ürünün üç dili olarak tanır).
- Özellik tablosu HTML değil `ad – değer` satırları olarak saklansın; sitede filtreleme yapılabilir.
- Varyantlar ayrı tabloda tutulsun (seçenekler, stok kodu, fiyat, barkod, stok durumu).

**Junior için iyi ilk görevler**

- [ ] Kaydedilmiş HTML'lerle `parseProduct` için otomatik testler (bölüm 8)
- [ ] Aynı link tekrar çekilince eski kaydı güncelleme
- [ ] `/api/extract`'a `lang` parametresi

## 11. Terimler sözlüğü

| Terim | Anlamı | Projede nerede |
| --- | --- | --- |
| API / uç nokta | Bir programın başka bir programa sunduğu adres (ör. `POST /api/extract`) | `server.js`, bölüm 6 |
| Headless tarayıcı | Ekranı olmayan, kodla yönetilen gerçek bir tarayıcı | `render.js` (Playwright + Chromium) |
| HTML ayrıştırma (parsing) | Sayfanın HTML kodunu okuyup içinden parça seçmek | `extract.js` (Cheerio) |
| JSON-LD | Sitelerin arama motorları için sayfaya gömdüğü yapısal veri (`<script type="application/ld+json">`); ürün adı, SKU, fiyat, görsel içerir | En güvenilir kaynak; `extract.js` ilk buna bakar |
| Microdata | JSON-LD'nin eski biçimi: HTML etiketlerine `itemprop` öznitelikleri | `extract.js` → `microdata()` |
| og:image / og:description | Sosyal medya paylaşımları için meta etiketleri | Yedek kaynak |
| hreflang | Bir sayfanın başka dildeki karşılığını gösteren etiket | Sitenin kendi çevirisi varsa makine çevirisi yerine o alınır |
| srcset | Aynı görselin farklı boyutlarını listeleyen öznitelik | En büyük boyut seçilir (`largestInSrcset`) |
| SKU / stok kodu | Ürünün benzersiz kodu | Siteler arası ortak anahtar |
| Varyant | Aynı ürünün renk, beden gibi seçenekleri | `extractVariants()` |
| WebP | Google'ın JPEG'den küçük görsel biçimi | Tüm görseller 800×800 WebP'ye çevrilir |
| CSV | Virgül ya da noktalı virgülle ayrılmış tablo dosyası | WooCommerce, Shopify ve Excel dışa aktarmaları |
| HTTP 403 / 404 / 429 | Erişim engellendi / sayfa yok / çok fazla istek | 403 bot engeli, 429 çeviri hız sınırı |
| Bot engeli | Sitelerin otomatik istekleri tanıyıp reddetmesi | "Kaynak yapıştır" yolu |
| Kuyruk (queue) | İşlerin sırayla tek tek yürütülmesi | `bulk.js` |
| Docker | Uygulamayı bağımlılıklarıyla paketleyip her sunucuda aynı çalıştırma aracı | Entegrasyonda kullanılacak |
