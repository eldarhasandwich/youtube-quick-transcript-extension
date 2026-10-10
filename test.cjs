const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
async function test(mode) {
  const payload = {actions: [{transcriptSegmentViewModel: {text: {content: 'Hello'}}}]};
  const metadata = 'var ytInitialData = ' + JSON.stringify({
    getTranscriptEndpoint: {params: 'target'},
    chapterRenderer: {timeRangeStartMillis: 65000, title: {simpleText: 'The point'}},
    commentsEntryPointHeaderRenderer: {commentCount: {simpleText: '123 comments'}}
  }) + ';' +
    'var ytInitialPlayerResponse = ' + JSON.stringify({videoDetails: {videoId: 'abcdefghijk', title: 'Test title', author: 'Test channel', viewCount: '0', keywords: 42}, microformat: {playerMicroformatRenderer: {publishDate: '2026-09-05'}}}) + ';';
  const events = new EventTarget();
  class XHR {open() {} send() {}}
  let context, timer;
  const fetcher = async (url, options) => {
    if (url.includes('/watch?')) return new Response(metadata);
    assert.equal(JSON.parse(options.body).params, 'target');
    return new Response(JSON.stringify(mode === '400' ? {error: {message: 'Invalid request context'}} : payload), {status: mode === '400' ? 400 : mode === '403' ? 403 : 200});
  };
  const app = mode === 'missing' ? {} : {resolveCommand(command) {
    assert.equal(command.getTranscriptEndpoint.params, 'target');
    assert.equal(command.getTranscriptEndpoint.externalVideoId, 'abcdefghijk');
    if (mode === 'timeout') return;
    return context.fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST', body: JSON.stringify(command.getTranscriptEndpoint)
    });
  }};
  context = vm.createContext({
    document: {querySelector: () => app}, location: {href: 'https://www.youtube.com/'},
    fetch: fetcher, XMLHttpRequest: XHR, URL, Request, Response, Blob, DecompressionStream,
    AbortSignal, setTimeout(fn) {timer = setTimeout(fn, 50); return timer;}, clearTimeout,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events)
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(__dirname + '/native.js', 'utf8'), context);
  const originalOpen = XHR.prototype.open, originalSend = XHR.prototype.send;
  const result = await context.nativeTranscript('abcdefghijk');
  assert.equal(context.fetch, fetcher);
  assert.equal(XHR.prototype.open, originalOpen);
  assert.equal(XHR.prototype.send, originalSend);
  assert.equal(context.__transcriptCopierNativeBusy, undefined);
  if (mode === 'success') {
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(result.payload), JSON.stringify(payload));
    assert.equal(result.metadata.title, 'Test title');
    assert.equal(result.metadata.channel, 'Test channel');
    assert.equal(result.metadata.views, '0');
    assert.equal(result.metadata.published, '2026-09-05');
    assert.equal(result.metadata.tags, undefined);
    assert.equal(result.metadata.chapters, '1:05 The point');
    assert.equal(result.metadata.comments, '123 comments');
  } else {
    assert.equal(result.ok, false);
    assert.match(result.error, mode === '400' ? /HTTP 400.*Invalid request context.*videoId=correct/ : mode === '403' ? /HTTP 403/ : mode === 'missing' ? /unavailable/ : /timed out/);
  }
  console.log('PASS native', mode, 'and cleanup');
}
(async () => {
  for (const mode of ['success', '400', '403', 'missing', 'timeout']) await test(mode);
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(__dirname + '/parser.js', 'utf8'), ctx);
  const data = [{transcriptSegmentRenderer: {snippet: {runs: [{text: 'Again'}]}}}, {transcriptSegmentViewModel: {text: {content: 'Again'}}}];
  assert.equal(ctx.transcriptLines(data).join('\n'), 'Again\nAgain');
  console.log('PASS both payload layouts and repeated speech');
  console.log('6 mocked checks passed. Live YouTube command dispatch is unverified.');
})().catch(error => {console.error(error); process.exitCode = 1;});
