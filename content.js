(() => {
  const states = new Map();
  const CARD = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model';
  let scheduled = false;
  function videoId(href) {
    try {
      const url = new URL(href, location.origin);
      const id = url.pathname === '/watch' ? url.searchParams.get('v') : null;
      return url.origin === location.origin && /^[\w-]{11}$/.test(id ?? '') ? id : null;
    } catch { return null; }
  }
  function state(id) {
    if (!states.has(id)) {
      const item = {text: '', busy: false, error: '', copied: false};
      states.set(id, item);
      chrome.storage.local.get(`direct-v3:${id}`).then(result => {
        const cached = result[`direct-v3:${id}`];
        if (!item.busy && typeof cached?.text === 'string') {
          item.text = cached.text; item.metadata = cached.metadata; paint(id);
        }
      }).catch(() => {});
    }
    return states.get(id);
  }
  function paint(id) {
    const item = state(id);
    for (const button of document.querySelectorAll('.tc-button')) {
      if (button.dataset.videoId !== id) continue;
      const label = item.busy ? 'Pulling…' : item.copied ? 'Copied!' : item.text ? 'Copy transcript' : item.error ? 'Retry transcript' : 'Pull transcript';
      if (button.textContent !== label) button.textContent = label;
      button.disabled = item.busy;
      button.dataset.state = item.error ? 'error' : item.text ? 'copy' : 'pull';
      button.title = item.error || item.note || (item.text ? `${item.text.length.toLocaleString()} characters ready` : 'Fetch directly — no tab opened');
      const error = button.parentElement.querySelector('.tc-error');
      if (error.textContent !== item.error) error.textContent = item.error;
    }
  }
  async function click(event) {
    event.preventDefault(); event.stopPropagation();
    const id = event.currentTarget.dataset.videoId;
    const item = state(id);
    if (item.busy) return;
    item.error = '';
    if (item.text) {
      try {
        const settings = await chrome.storage.local.get({includeMetadata: true});
        await navigator.clipboard.writeText(formatTranscript(item.text, item.metadata, settings.includeMetadata));
        item.copied = true;
        setTimeout(() => { item.copied = false; paint(id); }, 1000);
      } catch { item.error = 'Clipboard failed. Click again with this tab focused.'; }
      paint(id); return;
    }
    item.busy = true; paint(id);
    try {
      const result = await chrome.runtime.sendMessage({type: 'PULL_TRANSCRIPT', videoId: id});
      if (!result?.ok || typeof result.text !== 'string' || !result.text.trim()) throw new Error(result?.error || 'No transcript returned');
      item.text = result.text;
      item.metadata = result.metadata;
      item.note = result.note || '';
    } catch (error) { item.error = error.message; }
    finally { item.busy = false; paint(id); }
  }
  function mount(container, id, watch = false) {
    let wrapper = [...container.children].find(child => child.classList.contains('tc-wrapper'));
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = `tc-wrapper${watch ? ' tc-watch' : ''}`;
      const button = document.createElement('button');
      button.className = 'tc-button'; button.type = 'button';
      button.addEventListener('click', click);
      const error = document.createElement('span');
      error.className = 'tc-error'; error.setAttribute('role', 'status');
      wrapper.append(button, error);
      if (watch) container.prepend(wrapper); else container.append(wrapper);
    }
    wrapper.querySelector('button').dataset.videoId = id;
    paint(id);
  }
  function scan() {
    scheduled = false;
    for (const card of document.querySelectorAll(CARD)) {
      if (card.parentElement?.closest(CARD)) continue;
      const link = [...card.querySelectorAll('a[href]')].find(a => videoId(a.href));
      const id = link && videoId(link.href);
      if (id) mount(card, id);
      else [...card.children].find(child => child.classList.contains('tc-wrapper'))?.remove();
    }
    const id = videoId(location.href);
    const actions = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
    if (id && actions) mount(actions, id, true);
    else document.querySelectorAll('.tc-watch').forEach(element => element.remove());
  }
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true; setTimeout(scan, 300);
  }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['href']});
  window.addEventListener('yt-navigate-finish', scan);
  scan();
})();
