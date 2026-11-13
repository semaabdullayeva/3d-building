# Apartment Viewer (Next.js)

Yeni Gəncə konut kompleksi için interaktif 3D daire görüntüleyici — tek dosyalık `index.html`
sürümünün Next.js (App Router) + TypeScript + three.js ile yeniden yazılmış hali.

## Çalıştırma

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

`?fx=0` sorgu parametresi gökyüzü, cam yansıması ve ambient occlusion efektlerini kapatır (zayıf cihazlar için: `/?fx=0`).

## Yapı

```
app/                  layout, sayfa, global CSS (orijinal stiller)
components/
  ViewerLoader.tsx    3D bileşeni yalnızca istemcide yükler (ssr: false)
  ApartmentViewerApp  veri yükleme, motor yaşam döngüsü, UI durumu
  TopBar / FloorNav / UnitPanel / PlanModal / Tooltip / FloorPlanSvg
lib/
  types.ts            site.json veri modeli
  i18n.ts             arayüz metinleri
  viewer/
    engine.ts         ApartmentViewer: renderer, kamera, kontroller, seçim/vurgulama, store
    effects.ts        gökyüzü (Sky), PMREM ortam haritası, ambient occlusion (GTAO) hattı
    surfaces.ts       beton / cephe kaplaması dokuları ve fiziksel cam malzemesi
    ground.ts         çim zemin malzemesi (doku + shader ile yamalı görünüm)
    buildings.ts      kuleler, kat/daire mesh'leri, podyumlar, çatı bahçeleri
    windows.ts        çizimdeki pencere işaretlerini cephelere yerleştirme (cam ve doğramalar InstancedMesh)
    landscape.ts      arazi, yollar, asfalt avlu, çim alanlar, oyun alanı, ağaçlar
    vegetation.ts     ez-tree ağaçları (instanced)
    geometry.ts       poligon / ekstrüzyon yardımcıları
public/
  data/site.json      eski window.__SITE__ verisi
  plans/*.jpg         eski window.__PLANS__ kat planı görselleri
  textures/*.jpg      çim, beton ve cephe kaplaması dokuları
```

React arayüzü motorun durumuna `useSyncExternalStore` ile abone olur; motor eylemleri
(`setBlock`, `setFloor`, `select`, `openPlan`, `overview`) çağrılır. Hata ayıklama için
motor örneği `window.__viewer` üzerinden erişilebilir.
