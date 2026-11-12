# Ürün Aktarıcı

Bir ürün linki verildiğinde sayfadan ürün adı, stok kodu, barkod, marka, fiyat, kategori, kısa açıklama, açıklama (HTML + düz metin), özellik tablosu ve görselleri çıkaran yerel bir araç. Sonuçlar ekranda düzenlenebilir, kopyalanabilir ya da JSON/CSV olarak indirilebilir.

## Çalıştırma

```
npm install
npx playwright install chromium
npm start
```

Ardından http://localhost:4000 adresini aç. Windows'ta `baslat.bat` dosyasına çift tıklamak da yeterli.

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

- `server.js` — Express sunucu, `POST /api/extract`, `POST /api/translate`
- `extract.js` — sayfayı indirme, ürün bilgilerini çıkarma, dil kaynaklarını seçme
- `render.js` — sayfayı tarayıcıda açma, sekmeleri gezme
- `format.js` — açıklamayı standart düzene sokma
- `translate.js` — Google / Claude çevirisi
- `public/` — arayüz
