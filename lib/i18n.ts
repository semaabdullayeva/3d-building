export const t = {
  block: (id: string) => `Blok ${id}`,
  sub: (n: number) => `${n} floors · residential floors 3–${n}`,
  overview: "Overview",
  all: "All",
  rooms: (n: number) => `${n}-room`,
  floors: "Floor",
  hint: "Drag to rotate · scroll to zoom · click an apartment",
  apartment: "Apartment",
  floor: "Floor",
  type: "Type",
  roomsLabel: "Rooms",
  areaTotal: "Total area",
  areaLiving: "Living area",
  level: "Floor level",
  viewPlan: "View floor plan",
  close: "Close",
  floorPlan: (block: string, floor: number) => `Blok ${block} · floor ${floor} plan`,
  planFoot: "Click an apartment on the plan to select it.",
  m2: "m²",
  nonResidential: "Non-residential floor",
  pendingFloor: "Apartment data for this floor is not in the drawings yet",
  loading: "Loading 3D scene…",
  loadError: "Could not load the site data.",
};

/** 44.5 -> "44.5", 44 -> "44", null -> "—" */
export const formatArea = (v: number | null | undefined) =>
  v == null ? "—" : v.toFixed(v % 1 ? 1 : 0).replace(/\.0$/, "");
