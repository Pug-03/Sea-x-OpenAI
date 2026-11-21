import type { Route, WalkMode } from '@walkwe/core';
import { speechParts, type ReplyLanguage } from '@walkwe/core/voice';

/** App-written explanation. Names, coordinates and alternate routes stay on the device. */
export function verifiedRouteSummary(language: ReplyLanguage, route: Route, mode: WalkMode, shortest?: Route) {
  const meters = Math.round(route.lengthM);
  const minutes = Math.max(1, Math.round(route.durationS / 60));
  return speechParts(language, (lang) => {
    const start = lang === 'th' ? `เส้นทางที่เลือกยาว ${meters} เมตร ใช้เวลาเดินประมาณ ${minutes} นาที` : `The selected route is ${meters} metres, about ${minutes} minutes of walking.`;
    if (mode === 'night') {
      const known = Math.round((route.litKnownShare ?? 0) * 100);
      return lang === 'th' ? `${start} มีข้อมูลไฟส่องสว่าง ${known}% ของทางเดิน ส่วนที่เหลือยังยืนยันไม่ได้`
        : `${start} Lighting data covers ${known}% of the walking path. The rest is unverified.`;
    }
    const shade = Math.round(route.shadeShare * 100);
    const baseline = shortest ? Math.round(shortest.shadeShare * 100) : shade;
    const comparison = shortest && route !== shortest && shade !== baseline;
    if (lang === 'th') return `${start} มีร่มเงาประมาณ ${shade}%${comparison ? ` เทียบกับทางสั้นที่สุดที่มีร่มเงาประมาณ ${baseline}%` : ''}`;
    return `${start} Estimated shade is ${shade}%${comparison ? `, compared with ${baseline}% on the shortest route` : ''}.`;
  });
}
