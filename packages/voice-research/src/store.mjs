const searchLifetime = 5 * 60 * 1000;
const cacheLifetime = 24 * 60 * 60 * 1000;
const jobKey = id => `research:job:${id}`;
const accessKey = (id, owner) => `research:access:${id}:${owner}`;
const pending = job => job.status === "starting" || job.status === "researching";

// Uses the asynchronous transaction/KV methods of Durable Object storage.
export function createResearchStore(storage, now = Date.now) {
  return {
    claim({ owner, segmentId, publicName }) {
      const index = `research:segment:${JSON.stringify([segmentId, publicName])}`;
      return storage.transaction(async tx => {
        const currentId = await tx.get(index);
        const current = currentId && await tx.get(jobKey(currentId));
        if (current && current.status !== "failed" && current.expiresAt > now()) {
          await tx.put(accessKey(current.id, owner), true);
          return { job: current, created: false, cached: !pending(current) };
        }

        const id = crypto.randomUUID();
        const job = { id, segmentId, status: "starting", expiresAt: now() + searchLifetime };
        await tx.put(jobKey(id), job);
        await tx.put(index, id);
        await tx.put(accessKey(id, owner), true);
        return { job, created: true, cached: false };
      });
    },

    async get(owner, id) {
      if (!await storage.get(accessKey(id, owner))) return null;
      const job = await storage.get(jobKey(id));
      if (!job) return null;
      return pending(job) && job.expiresAt <= now() ? { ...job, status: "failed" } : job;
    },

    start(id, providerId) {
      return storage.transaction(async tx => {
        const job = await tx.get(jobKey(id));
        if (job?.status === "starting" && job.expiresAt > now()) {
          await tx.put(jobKey(id), { ...job, status: "researching", providerId });
        }
      });
    },

    finish(id, sources) {
      return storage.transaction(async tx => {
        const job = await tx.get(jobKey(id));
        if (!job || !pending(job)) return job;
        const completedAt = now();
        if (!sources || job.expiresAt <= completedAt || job.status !== "researching") {
          const failed = { ...job, status: "failed" };
          await tx.put(jobKey(id), failed);
          return failed;
        }

        if (sources.length) {
          await tx.put(`research:review:${id}`, {
            id, segmentId: job.segmentId, kind: "web_research", status: "pending_review", sources, createdAt: completedAt,
          });
        }
        const result = { id, segmentId: job.segmentId, status: sources.length ? "pending_review" : "no_sources",
          sourceCount: sources.length, completedAt, expiresAt: completedAt + cacheLifetime };
        await tx.put(jobKey(id), result);
        return result;
      });
    },
  };
}
