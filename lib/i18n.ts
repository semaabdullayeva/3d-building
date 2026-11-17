export const t = {
  block: (id: string) => `Blok ${id}`,
  sub: (n: number) => `${n} mərtəbə · yaşayış mərtəbələri 3–${n}`,
  overview: "Ümumi görünüş",
  all: "Hamısı",
  rooms: (n: number) => `${n} otaqlı`,
  floors: "Mərtəbə",
  hint: "Fırlatmaq üçün sürüşdürün · yaxınlaşdırmaq üçün diyircəyi çevirin · mənzilə klikləyin",
  apartment: "Mənzil",
  floor: "Mərtəbə",
  type: "Tip",
  roomsLabel: "Otaq sayı",
  areaTotal: "Ümumi sahə",
  areaLiving: "Yaşayış sahəsi",
  level: "Mərtəbə səviyyəsi",
  viewPlan: "Mərtəbə planı",
  viewApartmentPlan: "Mənzil planı",
  close: "Bağla",
  floorPlan: (block: string, floor: number) => `Blok ${block} · ${floor}-cü mərtəbənin planı`,
  apartmentPlan: (id: string) => `Mənzil ${id} planı`,
  planFoot: "Seçmək üçün plandakı mənzilə klikləyin.",
  m2: "m²",
  statusLabel: "Status",
  status: { available: "Boş", reserved: "Bron", sold: "Satılıb" },
  nonResidential: "Qeyri-yaşayış mərtəbəsi",
  pendingFloor: "Bu mərtəbənin mənzil məlumatları hələ çertyojlarda yoxdur",
  loading: "3D səhnə yüklənir…",
  loadError: "Layihə məlumatlarını yükləmək mümkün olmadı.",
};

/** 44.5 -> "44.5", 44 -> "44", null -> "—" */
export const formatArea = (v: number | null | undefined) =>
  v == null ? "—" : v.toFixed(v % 1 ? 1 : 0).replace(/\.0$/, "");
