function formatTranscript(text, metadata, include) {
  if (!include || !metadata) return text;
  const labels = {
    title: 'Title', channel: 'Channel', channelId: 'Channel ID', channelUrl: 'Channel URL',
    url: 'Video URL', videoId: 'Video ID', published: 'Published', publishedDisplay: 'Published (displayed)',
    uploaded: 'Uploaded', views: 'Views', likes: 'Likes (displayed)', subscribers: 'Subscribers (displayed)',
    comments: 'Comments (displayed)',
    durationSeconds: 'Duration (seconds)', category: 'Category', tags: 'Tags',
    availableCaptionTracks: 'Available caption tracks', thumbnail: 'Thumbnail URL',
    isLive: 'Currently live', isLiveContent: 'Livestream content', liveStart: 'Live start',
    liveEnd: 'Live end', unlisted: 'Unlisted', retrievedAt: 'Metadata retrieved at'
  };
  const lines = [];
  for (const [key,label] of Object.entries(labels)) {
    const value = metadata[key];
    if (['string','number','boolean'].includes(typeof value) && value !== '') lines.push(`${label}: ${String(value).replace(/\s+/g,' ')}`);
  }
  if (!lines.length && !metadata.description && !metadata.chapters) return text;
  let header = 'VIDEO METADATA\n' + lines.join('\n');
  if (typeof metadata.description === 'string' && metadata.description.trim()) header += '\n\nDESCRIPTION\n' + metadata.description;
  if (typeof metadata.chapters === 'string' && metadata.chapters.trim()) header += '\n\nCHAPTERS\n' + metadata.chapters;
  return header + '\n\nTRANSCRIPT\n' + text;
}
