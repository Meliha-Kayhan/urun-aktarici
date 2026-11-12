# Ürün Aktarıcı

Bir ürün linki verildiğinde sayfadan ürün adı, stok kodu, barkod, marka, fiyat, kategori, kısa açıklama, açıklama (HTML + düz metin), özellik tablosu ve görselleri çıkaran yerel bir araç. Sonuçlar ekranda düzenlenebilir, kopyalanabilir ya da JSON/CSV olarak indirilebilir.

## Çalıştırma

```
npm install
npm start
```

Ardından http://localhost:4000 adresini aç. Windows'ta `baslat.bat` dosyasına çift tıklamak da yeterli.

## Nasıl çalışır

Uygulama verilen linke tek bir GET isteği atar ve sayfayı okur; hiçbir yere veri göndermez. Bilgiler şu sırayla aranır:

1. Sayfadaki yapısal veri (JSON-LD `Product`, microdata)
2. Shopify mağazalarında ürünün `.json` karşılığı
3. Sayfa içeriği: açıklama/özellik kutuları, `table` / `dl` özellik tabloları, "Stok Kodu: …" gibi etiketler
4. Meta etiketler (`og:title`, `og:description`, `og:image`)

## Site engelliyorsa

Bazı siteler (ör. HTTP 403) otomatik istekleri engeller. Bu durumda tarayıcıda ürün sayfasını aç, `Ctrl+U` ile kaynağı aç, tamamını kopyala ve uygulamadaki "Sayfa kaynağını yapıştır" alanına yapıştır.

Not: İçeriği tamamen JavaScript ile sonradan yüklenen sitelerde ham kaynakta bilgi bulunmayabilir; böyle bir durumda tarayıcı geliştirici araçlarında `Elements` sekmesinden `<html>` öğesini "Copy outerHTML" ile kopyalayıp yapıştırmak işe yarar.

## Dosyalar

- `server.js` — Express sunucu, `POST /api/extract`
- `extract.js` — sayfayı indirme ve ürün bilgilerini çıkarma
- `public/` — arayüz
