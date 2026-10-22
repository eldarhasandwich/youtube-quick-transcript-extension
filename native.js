// Serialized by executeScript: this function must not depend on outer bindings.
async function nativeTranscript(videoId) {
  const VERBOSE = false;
  const aliasLog = msg => {
    if (VERBOSE) console.log(`[Transcript Copier] ${msg}`);
  };
  const LOCK = '__transcriptCopierNativeBusy';
  if (window[LOCK]) {
    aliasLog('A transcript request is already running in this tab.');
    return {ok: false, error: 'Another transcript is loading in this tab. Retry when it finishes.'};
  }
  window[LOCK] = true;
  let metadata;
  try {
    const startUrl = location.href;
    aliasLog(`Started for ${location.pathname}; reading YouTube page context.`);

    aliasLog('Fetching watch-page metadata.');
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'include', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Metadata: HTTP ${response.status}`);
    aliasLog(`Watch-page metadata returned HTTP ${response.status}.`);
    const html = await response.text();
    function objectAt(start) {
      let depth = 0, quoted = false, escaped = false;
      for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
      }
      throw new Error('Incomplete metadata');
    }
    const pageConfig = {};
    for (const match of html.matchAll(/\bytcfg\.set\(\s*/g)) {
      const start = match.index + match[0].length;
      if (html[start] === '{') {
        try { Object.assign(pageConfig, objectAt(start)); } catch {}
      }
    }
    const configValue = name => {
      const fetchedPageValue = pageConfig[name];
      if (fetchedPageValue !== undefined && fetchedPageValue !== null) return fetchedPageValue;
      try {
        const value = window.ytcfg?.get?.(name);
        if (value !== undefined && value !== null) return value;
      } catch {}
      return undefined;
    };
    let data;
    for (const pattern of [/\bytInitialData\s*=\s*/g, /window\["ytInitialData"\]\s*=\s*/g]) {
      for (const match of html.matchAll(pattern)) {
        const start = match.index + match[0].length;
        if (html[start] === '{') { try { data = objectAt(start); break; } catch {} }
      }
      if (data) break;
    }
    let endpoint;
    function walk(value) {
      if (!value || typeof value !== 'object' || endpoint) return;
      if (typeof value.getTranscriptEndpoint?.params === 'string') { endpoint = value; return; }
      for (const child of Object.values(value)) walk(child);
    }
    walk(data);
    aliasLog(`Transcript endpoint found=${Boolean(endpoint)}.`);
    // Metadata is optional. Each field is isolated so a malformed field cannot fail the pull.
    metadata = {videoId, url: `https://www.youtube.com/watch?v=${videoId}`, retrievedAt: new Date().toISOString()};
    const field = (name, getter) => {
      try {
        const value = getter();
        if (value !== undefined && value !== null && value !== '') metadata[name] = value;
      } catch {}
    };
    const textOf = value => typeof value === 'string' ? value :
      value?.simpleText ?? value?.content ?? value?.runs?.map(run => run.text || '').join('');
    let player = {};
    try {
      const match = /\bytInitialPlayerResponse\s*=\s*/.exec(html);
      if (match) player = objectAt(match.index + match[0].length);
      if (player.videoDetails?.videoId && player.videoDetails.videoId !== videoId) player = {};
    } catch {}
    const details = player.videoDetails || {};
    const micro = player.microformat?.playerMicroformatRenderer || {};
    field('title', () => details.title || textOf(micro.title));
    field('channel', () => details.author || micro.ownerChannelName);
    field('channelId', () => details.channelId || micro.externalChannelId);
    field('channelUrl', () => micro.ownerProfileUrl || (metadata.channelId && `https://www.youtube.com/channel/${metadata.channelId}`));
    field('published', () => micro.publishDate);
    field('uploaded', () => micro.uploadDate);
    field('views', () => details.viewCount ?? micro.viewCount);
    field('durationSeconds', () => details.lengthSeconds ?? micro.lengthSeconds);
    field('description', () => details.shortDescription || textOf(micro.description));
    field('category', () => micro.category);
    field('tags', () => details.keywords?.filter(value => typeof value === 'string').join(', '));
    field('thumbnail', () => (details.thumbnail?.thumbnails || micro.thumbnail?.thumbnails)?.at(-1)?.url);
    field('isLive', () => details.isLive);
    field('isLiveContent', () => details.isLiveContent);
    field('liveStart', () => micro.liveBroadcastDetails?.startTimestamp);
    field('liveEnd', () => micro.liveBroadcastDetails?.endTimestamp);
    field('unlisted', () => micro.isUnlisted);
    field('availableCaptionTracks', () => player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map(track =>
      `${textOf(track.name) || track.languageCode}${track.kind === 'asr' ? ' (auto-generated)' : ''}`).join(', '));
    // Only read target-video UI renderers, not arbitrary text from recommendations.
    try {
      const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (value.videoPrimaryInfoRenderer) {
          const primary = value.videoPrimaryInfoRenderer;
          if (!metadata.title) field('title', () => textOf(primary.title));
          if (!metadata.published) field('publishedDisplay', () => textOf(primary.dateText));
          if (!metadata.views) field('views', () => textOf(primary.viewCount?.videoViewCountRenderer?.viewCount));
          field('likes', () => {
            const buttons = primary.videoActions?.menuRenderer?.topLevelButtons || [];
            for (const button of buttons) {
              const like = button.segmentedLikeDislikeButtonRenderer?.likeButton?.toggleButtonRenderer;
              const modern = button.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
              const label = textOf(like?.defaultText) || modern?.title;
              if (label && /\d/.test(label)) return label;
            }
          });
        }
        if (value.videoSecondaryInfoRenderer) {
          const secondary = value.videoSecondaryInfoRenderer;
          const owner = secondary.owner?.videoOwnerRenderer;
          if (!metadata.channel) field('channel', () => textOf(owner?.title));
          field('subscribers', () => textOf(owner?.subscriberCountText));
          if (!metadata.description) field('description', () => textOf(secondary.attributedDescription) || textOf(secondary.description));
        }
        for (const child of Object.values(value)) visit(child);
      };
      visit(data);
    } catch {}
    field('chapters', () => metadata.description?.split('\n').filter(line => /^\s*(?:\d+:)?\d{1,2}:\d{2}\s+\S/.test(line)).join('\n'));
    // Prefer YouTube's structured chapters when present; otherwise keep description timestamps.
    try {
      const structuredChapters = [];
      const visit = value => {
        if (!value || typeof value !== 'object') return;
        const chapter = value.chapterRenderer;
        if (chapter && Number.isFinite(Number(chapter.timeRangeStartMillis))) {
          const seconds = Math.floor(Number(chapter.timeRangeStartMillis) / 1000);
          const title = textOf(chapter.title);
          if (title) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const stamp = hours
              ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
              : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
            structuredChapters.push(`${stamp} ${title}`);
          }
        }
        if (!metadata.comments && value.commentsEntryPointHeaderRenderer) {
          field('comments', () => textOf(value.commentsEntryPointHeaderRenderer.commentCount));
        }
        for (const child of Object.values(value)) visit(child);
      };
      visit(data);
      if (structuredChapters.length) metadata.chapters = [...new Set(structuredChapters)].join('\n');
    } catch {}

    if (!endpoint) {
      throw new Error('No transcript available.');
    }

    if (location.href !== startUrl) throw new Error('Page changed while loading. Retry.');
    const context = configValue('INNERTUBE_CONTEXT');
    const apiKey = configValue('INNERTUBE_API_KEY');
    const clientName = configValue('INNERTUBE_CONTEXT_CLIENT_NAME') ?? '1';
    const clientVersion = configValue('INNERTUBE_CONTEXT_CLIENT_VERSION') ?? context?.client?.clientVersion;
    if (!context || typeof context !== 'object') throw new Error('Native: YouTube InnerTube context is unavailable.');
    if (typeof apiKey !== 'string' || !apiKey) throw new Error('Native: YouTube InnerTube API key is unavailable.');

    const url = new URL('/youtubei/v1/get_transcript', location.origin);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('prettyPrint', 'false');
    aliasLog(`Posting transcript params with ${context.client?.originalUrl || 'video page'} context to YouTube get_transcript.`);
    const transcriptResponse = await fetch(url.href, {
      method: 'POST', credentials: 'include', signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': String(clientName),
        ...(clientVersion ? {'X-Youtube-Client-Version': String(clientVersion)} : {})
      },
      body: JSON.stringify({context, params: endpoint.getTranscriptEndpoint.params, externalVideoId: videoId})
    });
    let payload;
    try { payload = await transcriptResponse.json(); }
    catch {
      throw new Error(`Native get_transcript: HTTP ${transcriptResponse.status}; response was not JSON.`);
    }
    if (!transcriptResponse.ok) {
      const message = typeof payload?.error?.message === 'string'
        ? payload.error.message.replace(/\s+/g, ' ').slice(0, 240) : '';
      throw new Error(`Native get_transcript: HTTP ${transcriptResponse.status}${message ? ` — ${message}` : ''}`);
    }
    if (location.href !== startUrl) throw new Error('Page changed during transcript request. Retry.');
    if (payload?.error) throw new Error('Native API returned an error.');
    aliasLog('YouTube returned a transcript response.');
    return {ok: true, payload, metadata};
  } catch (error) {
    aliasLog(`Failed: ${error.message || 'unknown error'}`);
    return {ok: false, error: error.message || 'Native transcript failed', metadata};
  } finally {
    delete window[LOCK];
  }
}

// Runs in a temporary YouTube watch tab when InnerTube get_transcript rejects the direct request.
async function nativeTranscriptFromPanel(videoId) {
  const VERBOSE = false;
  const log = msg => {
    if (VERBOSE) console.log(`[Transcript Copier] ${msg}`);
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = Date.now() + 90000;
  const getRows = () => [...document.querySelectorAll(
    'ytd-transcript-segment-renderer, transcript-segment-view-model, yt-transcript-segment-view-model'
  )];
  const readRows = () => getRows().map(row => {
    const timestampNode = row.querySelector('.segment-timestamp, [class*="segment-timestamp"]');
    const textNode = row.querySelector('.segment-text, [class*="segment-text"], [role="text"]');
    const raw = (textNode?.innerText || textNode?.textContent || row.innerText || row.textContent || '').trim();
    const timestamp = (timestampNode?.innerText || timestampNode?.textContent || '').trim();
    const text = (timestamp ? raw.replace(timestamp, '') : raw).replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/, '').replace(/\s+/g, ' ').trim();
    return {timestamp, text};
  }).filter(segment => segment.text);

  const currentVideoId = new URL(location.href).searchParams.get('v');
  if (location.pathname !== '/watch' || currentVideoId !== videoId) {
    return {ok: false, error: `YouTube rejected the direct request and the transcript panel needs the target video open (current page: ${location.pathname}, video match: ${currentVideoId === videoId}).`};
  }
  log('Direct endpoint was rejected; opening YouTube transcript panel.');

  let button;
  while (Date.now() < deadline && !button) {
    button = document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      [...document.querySelectorAll('button, [role="button"]')].find(node => /show transcript/i.test(node.getAttribute('aria-label') || node.innerText || node.textContent || ''));
    if (!button) await wait(250);
  }
  if (!button) return {ok: false, error: 'YouTube did not expose a Show transcript button for this video.'};

  try { document.querySelector('video')?.pause(); } catch {}
  button.click();
  log('Clicked YouTube Show transcript.');
  const seen = new Set();
  const segments = new Map();
  let quietPasses = 0;
  while (Date.now() < deadline && quietPasses < 6) {
    const before = seen.size;
    for (const segment of readRows()) {
      const key = `${segment.timestamp}\u0000${segment.text}`;
      seen.add(key);
      segments.set(key, segment.text);
    }
    if (seen.size === before) quietPasses++;
    else quietPasses = 0;

    const panel = document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"], [target-id="engagement-panel-searchable-transcript"]'
    );
    const scrollers = panel ? [panel, ...panel.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 20) : [];
    const scroller = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    await wait(350);
  }

  const lines = [...segments.values()];
  if (!lines.length) return {ok: false, error: 'YouTube opened the transcript panel, but no transcript segments rendered.'};
  log(`Collected ${lines.length} transcript segments from YouTube's panel.`);
  return {
    ok: true,
    payload: {transcriptSegments: lines.map(text => ({transcriptSegmentViewModel: {text: {content: text}}}))},
    metadata: {videoId, url: `https://www.youtube.com/watch?v=${videoId}`, retrievedAt: new Date().toISOString()}
  };
}
