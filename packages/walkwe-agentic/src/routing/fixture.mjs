export const version = "siam-sandbox-1";
export const referenceDate = "2026-11-21";
export const places = [
  { id: "siam", name: "BTS สยาม", en: "BTS Siam", aliases: ["สยาม", "สถานีสยาม", "siam", "siam bts"], x: 15, y: 62 },
  { id: "paragon", name: "สยามพารากอน", en: "Siam Paragon", aliases: ["พารากอน", "paragon"], x: 28, y: 38 },
  { id: "central", name: "เซ็นทรัลเวิลด์", en: "CentralWorld", aliases: ["เซ็นทรัล เวิลด์", "เซ็นทรัลเวิล", "central world"], x: 79, y: 36 },
  { id: "chitlom", name: "BTS ชิดลม", en: "BTS Chit Lom", aliases: ["ชิดลม", "chitlom", "chit lom"], x: 91, y: 61 },
];
export const outsidePilotNames = ["เซ็นทรัลชิดลม", "central chidlom", "central chitlom", "สยามสแควร์", "siam square", "ทะนิยะ", "thaniya"];

export const junctions = Object.fromEntries([
  ...places.map(p => [p.id, [p.x, p.y]]),
  ["crossing", [34, 57]], ["lane", [58, 56]], ["entrance", [78, 55]],
  ["covered1", [25, 77]], ["covered2", [47, 73]], ["covered3", [66, 69]],
  ["north", [55, 28]],
]);

// The topology, timings and observations are scenario inputs, not navigation data.
export const edges = [
  { id: "direct-west", from: "siam", to: "crossing", title: "ทางเท้าช่วงสยาม", length: 180, light: "lit", cover: 0.10, wallHeight: 24, wallBearing: 250 },
  { id: "lane-gap", from: "crossing", to: "lane", title: "ทางเชื่อมช่วงกลาง", length: 180, light: "unknown", cover: 0.05, wallHeight: 34, wallBearing: 245 },
  { id: "direct-east", from: "lane", to: "entrance", title: "ช่วงก่อนถึงแยกราชประสงค์", length: 185, light: "lit", cover: 0.08, wallHeight: 27, wallBearing: 225 },
  { id: "plaza", from: "entrance", to: "central", title: "ทางเข้าลานด้านหน้า", length: 95, light: "lit", cover: 0.03, wallHeight: 22, wallBearing: 235 },
  { id: "cover-west", from: "siam", to: "covered1", title: "ทางขึ้นสกายวอล์ก", length: 140, light: "lit", cover: 0.52, wallHeight: 20, wallBearing: 220, stairs: true },
  { id: "ramp-west", from: "siam", to: "covered1", title: "ทางลาดเข้าสกายวอล์ก", length: 172, light: "lit", cover: 0.40, wallHeight: 22, wallBearing: 220 },
  { id: "cover-middle", from: "covered1", to: "covered2", title: "ทางเดินมีหลังคาช่วงแรก", length: 210, light: "lit", cover: 0.88, wallHeight: 20, wallBearing: 230 },
  { id: "cover-east", from: "covered2", to: "covered3", title: "ทางเดินมีหลังคาช่วงราชประสงค์", length: 205, light: "lit", cover: 0.92, wallHeight: 22, wallBearing: 240 },
  { id: "cover-exit", from: "covered3", to: "entrance", title: "ทางลงฝั่งราชประสงค์", length: 116, light: "lit", cover: 0.33, wallHeight: 18, wallBearing: 230 },
  { id: "mall-link", from: "paragon", to: "north", title: "ทางเชื่อมในอาคาร", length: 260, light: "lit", cover: 1, hours: [10, 20], wallHeight: 0, wallBearing: 0 },
  { id: "north-path", from: "north", to: "central", title: "ทางเท้าฝั่งเหนือ", length: 260, light: "dark", cover: 0.20, wallHeight: 25, wallBearing: 270 },
  { id: "paragon-front", from: "paragon", to: "crossing", title: "ทางเท้าหน้าสยามพารากอน", length: 165, light: "lit", cover: 0.24, wallHeight: 29, wallBearing: 235 },
  { id: "chitlom-east", from: "entrance", to: "chitlom", title: "ทางเท้าไปชิดลม", length: 266, light: "unknown", cover: 0.25, wallHeight: 26, wallBearing: 230 },
];
