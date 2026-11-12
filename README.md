# Ürün Aktarıcı

Bir ürün linki verildiğinde sayfadan ürün adı, stok kodu, barkod, marka, fiyat, kategori, kısa açıklama, açıklama (HTML + düz metin), özellik tablosu ve görselleri çıkaran yerel bir araç. Sonuçlar ekranda düzenlenebilir, kopyalanabilir ya da JSON/CSV olarak indirilebilir.

## Çalıştırma

```
npm install
npx playwright install chromium
npm start
```

Ardından http://localhost:4000 adresini aç. Windows'ta `baslat.bat` dosyasına çift tıklamak da yeterli.

## Ekranlar

- **Ürün** — tek link: bilgileri çek, düzenle, kaydet, dışa aktar.
- **Toplu** — her satıra bir link; sırayla işlenir (aynı anda tek ürün, bellek dostu), her biri bitince otomatik kaydedilir. Sayfadan ayrılınca da arka planda devam eder; "Durdur" mevcut ürün bitince durdurur.
- **Kaydedilenler** — çekilen tüm ürünler (düzenlemeleriyle birlikte). Ara, aç, sil; seçilenleri tek dosyada dışa aktar.
- **Ayarlar** — terim sözlüğü ve sabit metinler.

Çekilen her ürün otomatik kaydedilir; ekranda yapılan değişiklikler "Kaydet" ile (ya da dışa aktarırken otomatik) saklanır. Kayıtlar `data/` klasöründe JSON dosyaları olarak durur (git'e girmez).

## Dışa aktarma

| Biçim | İçerik |
|---|---|
| **WooCommerce CSV** | WooCommerce › Ürünler › İçe aktar ile yüklenir. Özellik tablosu ürün nitelikleri olur ("Ek bilgiler" sekmesi). Varyantlı ürünler `variable` + `variation` satırları olarak gelir; ana ürünün stok kodu bir varyantınkiyle çakışırsa sonuna `-ANA` eklenir. Ürünler **taslak** olarak gelir. |
| **Shopify CSV** | Shopify › Products › Import ile yüklenir. Özellik tablosu açıklamanın altına eklenir (Shopify'da nitelik alanı yok). Varyantlar ve görseller ayrı satırlarda. Ürünler **draft** olarak gelir. |
| **Excel / genel CSV** | Üç dil yan yana, Excel'de Türkçe karakterlerle açılır (`;` ayraçlı). |
| **JSON** | Tüm veriler. |

WooCommerce ve Shopify dosyaları tek dil içerir (dil seçilir). Görseller dosyada sitedeki orijinal adresleriyle yer alır; platform içe aktarırken kendisi indirir. Fiyatlar platformların beklediği biçime çevrilir ("2.499,90" → 2499.90). Sık kullanılan seçenek adları dile göre yazılır (Size → Beden / Size / Maat).

## Ayarlar

- **Terim sözlüğü:** çevirinin yanlış yaptığı ya da sitende farklı kullandığın kelimeler (ör. TR: "Gofret" → "Wafer"). Tam kelime eşleşir, büyük/küçük harf fark etmez, baş harf büyüklüğü korunur. Ürün adı, kısa açıklama, açıklama, kategori ve özellik tablosuna uygulanır.
- **Sabit metinler:** her dilde açıklamanın sonuna eklenecek metin (garanti, kargo vb.).

Ayarlar bundan sonra çekilen ürünlere uygulanır.

## Varyantlar

Renk, beden gibi seçenekler Shopify ürün verisinden ya da yapısal veriden (JSON-LD `ProductGroup` / çoklu teklif) okunur. Ekranda her varyantın stok kodu, fiyatı, barkodu ve stok durumu düzenlenebilir.

## Nasıl çalışır

Uygulama sayfayı varsayılan olarak görünmez bir Chrome'da (Playwright) açar: JavaScript'in yüklenmesini bekler, aşağı kaydırır, sekmelere ve "daha fazla göster" düğmelerine tıklar, akordeonları açar. Sayfadan çıkaran linklere tıklanmaz. Böylece sekmelerde ya da sonradan yüklenen içerik de okunur. "Hızlı mod" seçilirse ya da tarayıcı açılamazsa sayfa doğrudan indirilir (daha hızlı, ama JavaScript ile gelen içerik eksik kalabilir). Hiçbir yere veri gönderilmez.

Bilgiler şu sırayla aranır:

1. Sayfadaki yapısal veri (JSON-LD `Product`, microdata)
2. Shopify mağazalarında ürünün `.json` karşılığı
3. Sayfa içeriği: açıklama/özellik kutuları, `table` / `dl` özellik tabloları, "Stok Kodu: …" gibi etiketler
4. Meta etiketler (`og:title`, `og:description`, `og:image`)
5. **Tüm sayfa taraması:** sayfadaki her içerik bloğu (tablo, tanım listesi, madde listesi, `div` ızgaraları, "Ad: Değer" satırları, paragraflar) bulunur, başlığına ya da sekme adına göre bölümlere ayrılır ve sınıflandırılır. Yukarıdakilerin kaçırdığı özellik listeleri ve metinler buradan tamamlanır.

### Açıklama formatı

Siteden alınan açıklama birebir kopyalanmaz; her üründe aynı düzene sokulur:

1. **Giriş paragrafı** — sayfadaki ilk dolu paragraf
2. **Öne Çıkan Özellikler** — sayfadaki her "başlık + paragraf" bloğu bir maddeye dönüşür: kalın başlık – 1-2 cümlelik özet. Böyle bloklar yoksa açıklamadaki ya da sayfadaki bir özellik listesi kullanılır.
3. **Kutu İçeriği** — özelliklerde "Package / Kutu İçeriği / In the box" satırı varsa

Tablolar, görseller, "[NEW]" etiketleri, boş satırlar ve tekrarlar atılır. Bölüm başlıkları her dilde sabittir (çeviriye bırakılmaz). Düzenlenmemiş metin "Sitedeki metin" sekmesinde karşılaştırma için görünür. Kod: `format.js`.

### Kısa açıklama

1-2 cümlelik, ürünün ne olduğunu söyleyen bir metin (en fazla ~280 karakter, cümle ortasında kesilmez). Sırayla denenir: sitenin kendi kısa açıklama alanı, meta açıklama, açıklamanın giriş paragrafı. Meta açıklamalar çoğu zaman birbirine yapışmış özellik listesidir ("Wafer1 x Micro HDMI…"); okunabilir cümle içermeyen adaylar atlanır. Uzun metinlerde ürün adını ya da stok kodunu içeren cümleden başlanır, öncesindeki slogan cümleleri alınmaz.

### Görseller

Görsellerin her zaman en büyük hâli aranır (srcset'teki en büyük boyut, zoom görselleri, Shopify/WooCommerce küçük resim adreslerinin tam boyutlusu). Adaylar indirilip gerçek boyutları ölçülür: 1×1 yer tutucular, ikonlar, 300 px'den küçük küçük resimler ve birebir aynı dosyalar atılır. Adaylar güvenilirlik sırasıyla denenir (mağaza ürün verisi → yapısal veri → ürün galerisi → paylaşım görseli → sayfa içi görseller); üst sıradan en az 2 iyi görsel çıkarsa alttakilere bakılmaz, böylece afişler ve başka renk seçenekleri karışmaz.

Görseller sunucuda **800×800 WebP**'ye çevrilir (kalite 92, tam renk çözünürlüğü). Ürün kırpılmaz: görsel kareye sığdırılır, boşluklar beyazla doldurulur; şeffaf arka planlar da beyaz olur. Ekrandaki önizlemeler dönüştürülmüş hâlidir; her görselin altında kaynak boyutu yazar, 800 px'den küçük kaynaklar ⚠ ile işaretlenir (büyütüldükleri için net olmayabilirler). İstenmeyen görsel × ile kaldırılır; kaldırılanlar ZIP'e ve dışa aktarmaya girmez. Her görsel tek tek ("WebP indir") ya da hepsi birlikte ZIP olarak indirilebilir (`<stok kodu>_1.webp`, `_2.webp`…). Dönüştürülemeyen görseller ZIP'teki `hatalar.txt` dosyasında listelenir. Kod: `images.js`.

### Sayfadaki tüm bölümler

Ekranda sayfada bulunan her bölüm listelenir; hangisinin özelliklere ya da açıklamaya yerleştiği işaretlidir. Otomatik yerleşmeyen bir bölüm "Özelliklere ekle" / "Açıklamaya ekle" ile eklenebilir; üç dile çevrilerek eklenir. Menü, footer, çerez uyarısı, benzer ürünler ve yorumlar bu listeye alınmaz.

## Üç dil: Türkçe, İngilizce, Hollandaca

Ürün adı, kategori, kısa açıklama, açıklama ve özellik tablosu her dil için ayrı sekmede gelir. Stok kodu, barkod, marka, fiyat ve görseller ortaktır. Her dil şu sırayla doldurulur:

1. **orijinal** — sayfanın kendi dili (`<html lang>`)
2. **sitenin kendi sayfası** — site o dilde bir sürüm yayınlıyorsa (`hreflang`), metin oradan alınır
3. **makine çevirisi** — hiçbiri yoksa çevrilir

Çeviri varsayılan olarak anahtarsız Google Çeviri ile yapılır. Daha iyi sonuç için Claude kullanmak istersen sunucuyu başlatmadan önce `ANTHROPIC_API_KEY` ortam değişkenini tanımla; uygulama otomatik olarak Claude'a (`claude-opus-5-5`) geçer. Sunucu açılırken hangi çevirmenin kullanıldığını konsola yazar.

Not: Google'ın anahtarsız uç noktası resmi bir API değildir; çok sık kullanımda geçici olarak engelleyebilir. Açıklamada paragraf/madde yapısı korunur ama paragraf içindeki kalın/italik gibi biçimlendirmeler çeviride düz metne döner.

## Site engelliyorsa

Bazı siteler (ör. HTTP 403) otomatik istekleri engeller. Bu durumda tarayıcıda ürün sayfasını aç, `Ctrl+U` ile kaynağı aç, tamamını kopyala ve uygulamadaki "Sayfa kaynağını yapıştır" alanına yapıştır.

Not: İçeriği tamamen JavaScript ile sonradan yüklenen sitelerde ham kaynakta bilgi bulunmayabilir; böyle bir durumda tarayıcı geliştirici araçlarında `Elements` sekmesinden `<html>` öğesini "Copy outerHTML" ile kopyalayıp yapıştırmak işe yarar.

## Dosyalar

- `server.js` — Express sunucu, `POST /api/extract`, `POST /api/translate`, `GET /api/image`, `POST /api/images.zip`
- `extract.js` — sayfayı indirme, ürün bilgilerini çıkarma, dil kaynaklarını seçme
- `render.js` — sayfayı tarayıcıda açma, sekmeleri gezme
- `format.js` — açıklamayı standart düzene sokma
- `images.js` — görselleri 800×800 WebP'ye çevirme, ZIP
- `storage.js` — kayıtlar ve ayarlar (`data/`)
- `export.js` — WooCommerce / Shopify / Excel / JSON dışa aktarma
- `bulk.js` — toplu işlem kuyruğu
- `postprocess.js` — terim sözlüğü ve sabit metinler
- `translate.js` — Google / Claude çevirisi
- `public/` — arayüz (`app.js` ürün ekranı, `views.js` toplu / kaydedilenler / ayarlar)
