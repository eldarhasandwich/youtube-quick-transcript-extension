const CACHE_LIMIT = 5 * 1024 * 1024;
const CACHE_INDEX = 'transcript-fifo-v1';
const CACHE_PREFIX = 'direct-v3:';
let cacheQueue = Promise.resolve();
function cacheBytes(key, value) {
  return new TextEncoder().encode(key).length + new TextEncoder().encode(JSON.stringify(value)).length;
}
function serializeCache(task) {
  const job = cacheQueue.then(task);
  cacheQueue = job.catch(() => {});
  return job;
}
async function maintainCache(id, text) {
  const storage = chrome.storage.local;
  const all = await storage.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(CACHE_PREFIX));
  const previous = Array.isArray(all[CACHE_INDEX]) ? all[CACHE_INDEX] : [];
  // Old versions did not record insertion time: migrate those entries in key order.
  const order = [...new Set(previous.filter(key => keys.includes(key))
    .concat(keys.filter(key => !previous.includes(key)).sort()))];
  const remove = Object.keys(all).filter(key => key.startsWith('transcript:'));
  for (const key of [...order]) {
    const raw = typeof all[key] === 'string' ? all[key] : all[key]?.text;
    if (typeof raw !== 'string' || !raw.trim()) {
      order.splice(order.indexOf(key), 1); remove.push(key);
    }
  }
  const newKey = id ? CACHE_PREFIX + id : null;
  // Check before evicting: a giant item must not flush the existing cache.
  if (newKey && cacheBytes(newKey, text) + cacheBytes(CACHE_INDEX, [newKey]) > CACHE_LIMIT) {
    return {cached: false, note: 'Too large for the 5 MiB cache; copy now. Not saved after refresh.'};
  }
  if (newKey) {
    if (!order.includes(newKey)) order.push(newKey);
    all[newKey] = text;
  }
  // Preserve unrelated extension data and account for its measured quota usage.
  const owned = keys.concat(CACHE_INDEX, remove);
  const unrelated = Object.keys(all).filter(key => !owned.includes(key) && key !== newKey);
  const otherBytes = unrelated.length ? await storage.getBytesInUse(unrelated) : 0;
  const budget = Math.min(CACHE_LIMIT, Math.max(0, (storage.QUOTA_BYTES || 10485760) - otherBytes - 65536));
  if (newKey && cacheBytes(newKey, text) + cacheBytes(CACHE_INDEX, [newKey]) > budget) {
    return {cached: false, note: 'Cache has insufficient space; transcript available to copy for this page session.'};
  }
  let size = order.reduce((sum, key) => sum + cacheBytes(key, all[key]), 0);
  while (order.length && size + cacheBytes(CACHE_INDEX, order) > budget) {
    const key = order.shift();
    size -= cacheBytes(key, all[key]);
    remove.push(key);
  }
  if (remove.length) await storage.remove([...new Set(remove)]);
  const values = {[CACHE_INDEX]: order};
  if (newKey && order.includes(newKey)) values[newKey] = text;
  await storage.set(values);
  return {cached: !!newKey && order.includes(newKey), note: ''};
}
function saveTranscript(id, text) {
  return serializeCache(() => maintainCache(id, text)).catch(() => ({
    cached: false, note: 'Could not save cache; transcript is still available to copy for this page session.'
  }));
}
// Runs on worker startup, including upgrades. Reconciles interrupted index writes.
serializeCache(() => maintainCache()).catch(() => {});
