const route = "/agents/research";
const waiting = status => status === "starting" || status === "researching";
const failure = "ค้นข้อมูลเพิ่มเติมไม่สำเร็จ";

export const researchSegmentTool = {
  name: "research_segment",
  description: "ค้นข้อมูลสาธารณะเรื่องไฟถนนของช่วงทางที่แอปเลือก เมื่อผู้เดินขอให้ค้นเพิ่ม",
};

function statusText({ status, sourceCount }) {
  if (status === "pending_review" && Number.isInteger(sourceCount) && sourceCount >= 1 && sourceCount <= 3) {
    return `ได้ข้อมูลเพิ่ม ${sourceCount} แหล่ง รอผู้ตรวจ`;
  }
  if (status === "no_sources") return "ยังไม่พบแหล่งข้อมูลเพิ่มเติม";
  return failure;
}

function sleep(ms, signal) {
  return new Promise(resolve => {
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

export function createResearchClientTool({ getSelectedSegmentId, announce, signal, proxyFetch = fetch, pollMs = 3000 }) {
  const tracking = new Set();

  async function track(id) {
    const lifetime = AbortSignal.timeout(5 * 60 * 1000);
    const pollSignal = AbortSignal.any([lifetime, ...(signal ? [signal] : [])]);
    try {
      while (!pollSignal.aborted) {
        await sleep(pollMs, pollSignal);
        if (pollSignal.aborted) break;
        let text;
        try {
          const response = await proxyFetch(`${route}/${id}`, { signal: pollSignal, cache: "no-store" });
          if (response.status === 429 || response.status >= 500) continue;
          const job = response.ok ? await response.json() : { status: "failed" };
          if (waiting(job.status)) continue;
          text = statusText(job);
        } catch {
          continue;
        }
        if (!pollSignal.aborted) await announce(text);
        return;
      }
      if (!signal?.aborted) await announce("ยังค้นข้อมูลไม่เสร็จ");
    } finally {
      tracking.delete(id);
    }
  }

  return async function research_segment() {
    const segmentId = getSelectedSegmentId();
    const reply = (status, speak_text) => JSON.stringify({ status, speak_text });
    if (!segmentId) return reply("no_segment", "เลือกช่วงทางที่ต้องการค้นก่อน");
    try {
      const timeout = AbortSignal.timeout(5000);
      const response = await proxyFetch(route, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segmentId }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) return reply("failed", failure);
      const job = await response.json();
      if (!waiting(job.status)) return reply(job.status, statusText(job));
      if (typeof job.id !== "string" || !/^[a-f0-9-]{36}$/.test(job.id)) return reply("failed", failure);
      if (!tracking.has(job.id)) {
        tracking.add(job.id);
        void track(job.id).catch(() => {});
      }
      return reply("started", "เริ่มค้นแล้ว");
    } catch {
      return reply("failed", failure);
    }
  };
}
