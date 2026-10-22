importScripts('parser.js', 'native.js', 'cache.js');
const jobs = new Map();
async function loadTranscript(id, tabId) {
  const results = await chrome.scripting.executeScript({
    target: {tabId}, world: 'MAIN', func: nativeTranscript, args: [id]
  });
  let result = results?.[0]?.result;
  if (!result?.ok && /HTTP 400.*Precondition check failed/i.test(result?.error || '')) {
    const fetchedMetadata = result.metadata;
    const fallbackResults = await chrome.scripting.executeScript({
      target: {tabId}, world: 'MAIN', func: nativeTranscriptFromPanel, args: [id]
    });
    result = fallbackResults?.[0]?.result;
    if (result?.ok && fetchedMetadata) {
      result.metadata = {...result.metadata, ...fetchedMetadata};
    }
  }
  if (!result?.ok) throw new Error(result?.error || 'Native command returned no result');
  let continuation = false;
  walk(result.payload, node => { if (node.continuationItemRenderer || node.nextContinuationData) continuation = true; });
  if (continuation) throw new Error('Paginated transcript: completeness not supported yet.');
  const lines = transcriptLines(result.payload);
  if (!lines.length) throw new Error('Native response received, but no recognized transcript segments.');
  const text = lines.join('\n');
  const metadata = result.metadata || {videoId: id, url: `https://www.youtube.com/watch?v=${id}`};
  const cache = await saveTranscript(id, {text, metadata});
  return {text, metadata, ...cache};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'PULL_TRANSCRIPT') return;
  const id = message.videoId;
  if (!/^https:\/\/www\.youtube\.com\//.test(sender.url ?? '') || !/^[\w-]{11}$/.test(id ?? '') || !Number.isInteger(sender.tab?.id)) {
    respond({ok: false, error: 'Invalid request'}); return;
  }
  const key = `${sender.tab.id}:${id}`;
  if (!jobs.has(key)) jobs.set(key, loadTranscript(id, sender.tab.id).finally(() => jobs.delete(key)));
  jobs.get(key).then(result => respond({ok: true, ...result}), error => respond({ok: false, error: error.message || 'Request failed'}));
  return true;
});
