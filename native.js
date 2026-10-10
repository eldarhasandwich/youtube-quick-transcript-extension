// Serialized by executeScript: this function must not depend on outer bindings.
async function nativeTranscript(videoId) {
  const LOCK = '__transcriptCopierNativeBusy';
  if (window[LOCK]) return {ok: false, error: 'Another transcript is loading in this tab. Retry when it finishes.'};
  window[LOCK] = true;
  let cleanup = () => {};
  try {
    const startUrl = location.href;
    const app = document.querySelector('ytd-app');
    const controller = typeof app?.resolveCommand === 'function' ? app :
      typeof app?.polymerController?.resolveCommand === 'function' ? app.polymerController : null;
    if (!controller) throw new Error('Native: YouTube resolveCommand is unavailable on this page.');

    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'include', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Metadata: HTTP ${response.status}`);
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
    // Metadata is optional. Each field is isolated so a malformed field cannot fail the pull.
    const metadata = {videoId, url: `https://www.youtube.com/watch?v=${videoId}`, retrievedAt: new Date().toISOString()};
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
    if (!endpoint) throw new Error('Native: transcript command missing from watch metadata.');
    if (location.href !== startUrl) throw new Error('Page changed while loading. Retry.');
    // Preserve only the transcript command and its routing metadata, never a navigation command.
    const command = {getTranscriptEndpoint: {...endpoint.getTranscriptEndpoint, externalVideoId: videoId}};
    if (endpoint.commandMetadata) command.commandMetadata = endpoint.commandMetadata;
    if (endpoint.clickTrackingParams) command.clickTrackingParams = endpoint.clickTrackingParams;
    const params = command.getTranscriptEndpoint.params;

    return await new Promise(resolve => {
      let finished = false;
      const originalFetch = window.fetch;
      const proto = XMLHttpRequest.prototype;
      const originalOpen = proto.open, originalSend = proto.send;
      const urls = new WeakMap();
      const removers = new Set();
      let requestSummary = '';
      let timer;
      function finish(result) {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(result);
      }
      function isTranscript(url) {
        try {
          const parsed = new URL(url, location.href);
          return parsed.origin === 'https://www.youtube.com' && parsed.pathname === '/youtubei/v1/get_transcript';
        } catch { return false; }
      }
      async function matches(body) {
        try {
          let raw;
          if (typeof body === 'string') raw = body;
          else if (body != null) {
            const blob = new Blob([body]);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            raw = bytes[0] === 31 && bytes[1] === 139
              ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
              : await blob.text();
          }
          const request = JSON.parse(raw);
          if (request.params !== params) return false;
          requestSummary = `videoId=${request.externalVideoId === videoId ? 'correct' : request.externalVideoId ? 'different' : 'missing'}, languageCode=${request.languageCode ? 'present' : 'missing'}`;
          return true;
        } catch { return false; }
      }
      function accept(status, payload) {
        if (status < 200 || status >= 300) {
          const message = typeof payload?.error?.message === 'string' ? payload.error.message.replace(/\s+/g, ' ').slice(0, 240) : '';
          finish({ok: false, error: `Native get_transcript: HTTP ${status}${message ? ' — ' + message : ''}${requestSummary ? ' (' + requestSummary + ')' : ''}`});
        }
        else if (payload?.error) finish({ok: false, error: 'Native API returned an error'});
        else finish({ok: true, payload, metadata});
      }
      function wrappedFetch(input, options) {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
        let matching;
        if (isTranscript(url)) {
          matching = options?.body !== undefined ? matches(options.body) :
            input instanceof Request ? input.clone().blob().then(matches) : Promise.resolve(false);
        }
        const promise = originalFetch.apply(this, arguments);
        if (matching) promise.then(async response => {
          const clone = response.clone();
          if (!(await matching) || finished) return;
          if (!response.ok) {
            let errorPayload;
            try { errorPayload = await clone.json(); } catch {}
            accept(response.status, errorPayload); return;
          }
          try { accept(response.status, await clone.json()); }
          catch { finish({ok: false, error: 'Native: response is not JSON'}); }
        }, () => {}).catch(() => {});
        return promise;
      }
      function wrappedOpen(method, url) {
        urls.set(this, String(url));
        return originalOpen.apply(this, arguments);
      }
      function wrappedSend(body) {
        if (isTranscript(urls.get(this))) {
          const xhr = this;
          const matching = matches(body);
          const onLoad = async () => {
            if (!(await matching) || finished) return;
            if (xhr.status < 200 || xhr.status >= 300) {
              let errorPayload;
              try { errorPayload = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText); } catch {}
              accept(xhr.status, errorPayload); return;
            }
            try { accept(xhr.status, xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText)); }
            catch { finish({ok: false, error: 'Native: XHR response is not JSON'}); }
          };
          xhr.addEventListener('loadend', onLoad, {once: true});
          removers.add(() => xhr.removeEventListener('loadend', onLoad));
        }
        return originalSend.apply(this, arguments);
      }
      const navigated = () => finish({ok: false, error: 'Page changed during transcript request. Retry.'});
      cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('yt-navigate-start', navigated);
        if (window.fetch === wrappedFetch) window.fetch = originalFetch;
        if (proto.open === wrappedOpen) proto.open = originalOpen;
        if (proto.send === wrappedSend) proto.send = originalSend;
        for (const remove of removers) remove();
      };
      window.fetch = wrappedFetch;
      proto.open = wrappedOpen;
      proto.send = wrappedSend;
      window.addEventListener('yt-navigate-start', navigated);
      timer = setTimeout(() => finish({ok: false, error: 'Native command timed out: no matching transcript response observed.'}), 20000);
      try {
        // YouTube itself supplies its normal auth/client/attestation context.
        const result = controller.resolveCommand(command);
        if (result?.catch) result.catch(() => finish({ok: false, error: 'YouTube rejected the native command'}));
      } catch { finish({ok: false, error: 'Native: resolveCommand threw an error'}); }
    });
  } catch (error) {
    return {ok: false, error: error.message || 'Native transcript failed'};
  } finally {
    cleanup();
    delete window[LOCK];
  }
}
