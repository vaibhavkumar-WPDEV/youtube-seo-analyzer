// YouTube Data API v3 client (runs in the browser).
// Mode 1: API key → public videos only.
// Mode 2: Google sign-in (read-only) → your private, unlisted and scheduled videos too.

import { parseISODuration, loadScript, pool } from './util.js';

const BASE = 'https://www.googleapis.com/youtube/v3/';
export const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

export class ApiError extends Error {
  constructor(message, reason, status) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

function friendlyError(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  const raw = body?.error?.message || `HTTP ${status}`;
  const origin = location.origin;
  const map = {
    keyInvalid: 'This API key is not valid. Copy it again from Google Cloud → Credentials and save it in Settings.',
    badRequest: raw.includes('API key') ? 'This API key is not valid. Copy it again from Google Cloud → Credentials.' : raw,
    quotaExceeded: 'Today\'s YouTube API quota is used up. It resets at midnight Pacific time (about 1:30 pm IST).',
    dailyLimitExceeded: 'Today\'s YouTube API quota is used up. It resets at midnight Pacific time (about 1:30 pm IST).',
    accessNotConfigured: 'YouTube Data API v3 is not turned on for this key\'s Google Cloud project. Enable it, wait a minute, then try again.',
    SERVICE_DISABLED: 'YouTube Data API v3 is not turned on for this key\'s Google Cloud project. Enable it, wait a minute, then try again.',
    ipRefererBlocked: `This key is locked to other websites. In Google Cloud, add ${origin}/* to the key's website restrictions.`,
    forbidden: raw,
    authError: 'Google sign-in has expired. Sign in again in Settings.',
    channelNotFound: 'No channel found for that handle or ID.',
  };
  if (status === 401) return new ApiError(map.authError, 'authError', status);
  if (/referer|referrer/i.test(raw)) return new ApiError(map.ipRefererBlocked, 'ipRefererBlocked', status);
  return new ApiError(map[reason] || raw, reason, status);
}

export class YouTubeClient {
  constructor({ apiKey, accessToken }) {
    this.apiKey = apiKey || '';
    this.accessToken = accessToken || '';
    this.units = 0;
  }

  get ownerMode() {
    return !!this.accessToken;
  }

  async get(path, params = {}, cost = 1) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
    const headers = { Accept: 'application/json' };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    else if (this.apiKey) url.searchParams.set('key', this.apiKey);
    else throw new ApiError('Add an API key or sign in with Google in Settings first.', 'noAuth', 0);
    let res;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new ApiError('Could not reach the YouTube API. Check your internet connection.', 'network', 0);
    }
    const body = await res.json().catch(() => ({}));
    this.units += cost;
    if (!res.ok) throw friendlyError(res.status, body);
    return body;
  }

  // Accepts @handle, handle, channel ID (UC…), or a channel URL. Empty + signed in = your channel.
  async channel(input) {
    const parts = 'snippet,statistics,brandingSettings,contentDetails,status,localizations';
    const q = parseChannelInput(input);
    let params;
    if (q.id) params = { part: parts, id: q.id };
    else if (q.handle) params = { part: parts, forHandle: q.handle };
    else if (this.ownerMode) params = { part: parts, mine: 'true' };
    else throw new ApiError('Enter your channel handle (like @TadakBoom) in Settings.', 'noChannel', 0);
    const data = await this.get('channels', params);
    const c = data.items?.[0];
    if (!c) throw new ApiError(`No channel found for "${input}". Check the handle.`, 'channelNotFound', 404);
    return normalizeChannel(c);
  }

  async uploadIds(playlistId, max = 200, onProgress) {
    const ids = [];
    let pageToken;
    do {
      const data = await this.get('playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, pageToken });
      for (const it of data.items || []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
      pageToken = data.nextPageToken;
      onProgress?.(ids.length);
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async videos(ids, onProgress) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const data = await this.get('videos', {
        part: 'snippet,contentDetails,statistics,status,player,localizations,topicDetails,liveStreamingDetails',
        id: chunk.join(','),
        maxHeight: 1000,
      });
      out.push(...(data.items || []));
      onProgress?.(out.length, ids.length);
    }
    return out;
  }

  async playlists(channelId) {
    const lists = [];
    let pageToken;
    do {
      const data = await this.get('playlists', {
        part: 'snippet,contentDetails',
        ...(this.ownerMode ? { mine: 'true' } : { channelId }),
        maxResults: 50,
        pageToken,
      });
      for (const p of data.items || []) lists.push({ id: p.id, title: p.snippet.title, count: p.contentDetails?.itemCount ?? 0 });
      pageToken = data.nextPageToken;
    } while (pageToken && lists.length < 100);
    return lists;
  }

  // Map videoId → [playlist titles]. Reads at most 30 playlists × 200 items.
  async playlistMembership(lists) {
    const map = new Map();
    await pool(lists.slice(0, 30), 4, async (pl) => {
      let pageToken;
      let n = 0;
      do {
        const data = await this.get('playlistItems', { part: 'contentDetails', playlistId: pl.id, maxResults: 50, pageToken });
        for (const it of data.items || []) {
          const id = it.contentDetails?.videoId;
          if (!id) continue;
          if (!map.has(id)) map.set(id, []);
          map.get(id).push(pl.title);
        }
        n += 50;
        pageToken = data.nextPageToken;
      } while (pageToken && n < 200);
    });
    return map;
  }

  async categories(regionCode = 'IN') {
    const data = await this.get('videoCategories', { part: 'snippet', regionCode, hl: 'en' });
    const map = {};
    for (const c of data.items || []) map[c.id] = c.snippet.title;
    return map;
  }
}

export function parseChannelInput(input) {
  const t = (input || '').trim();
  if (!t) return {};
  const idInUrl = /channel\/(UC[\w-]{22})/.exec(t);
  if (idInUrl) return { id: idInUrl[1] };
  if (/^UC[\w-]{22}$/.test(t)) return { id: t };
  const handleInUrl = /youtube\.com\/(@[\w.-]+)/i.exec(t);
  if (handleInUrl) return { handle: handleInUrl[1] };
  return { handle: t.startsWith('@') ? t : `@${t}` };
}

function bestThumb(thumbnails = {}) {
  return (thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default || {}).url || '';
}

export function normalizeChannel(c) {
  const sn = c.snippet || {};
  const br = c.brandingSettings || {};
  return {
    id: c.id,
    title: sn.title || '',
    handle: sn.customUrl || '',
    description: sn.description || br.channel?.description || '',
    keywords: br.channel?.keywords || '',
    country: sn.country || br.channel?.country || '',
    defaultLanguage: sn.defaultLanguage || br.channel?.defaultLanguage || '',
    trailer: br.channel?.unsubscribedTrailer || '',
    banner: br.image?.bannerExternalUrl || '',
    avatar: (sn.thumbnails?.medium || sn.thumbnails?.default || {}).url || '',
    publishedAt: sn.publishedAt || '',
    subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0),
    views: Number(c.statistics?.viewCount ?? 0),
    videoCount: Number(c.statistics?.videoCount ?? 0),
    uploads: c.contentDetails?.relatedPlaylists?.uploads || '',
    madeForKids: c.status?.madeForKids ?? null,
    playlists: null,
  };
}

export function normalizeVideo(item, categories = {}, membership = null) {
  const sn = item.snippet || {};
  const cd = item.contentDetails || {};
  const st = item.status || {};
  const stats = item.statistics || {};
  const durationSec = parseISODuration(cd.duration);
  const ew = Number(item.player?.embedWidth) || 0;
  const eh = Number(item.player?.embedHeight) || 0;
  const vertical = ew && eh ? eh > ew : null;
  const isShort = durationSec > 0 && durationSec <= 180 && vertical !== false;
  let status = 'Public';
  if (st.privacyStatus === 'private') status = st.publishAt ? 'Scheduled' : 'Private';
  else if (st.privacyStatus === 'unlisted') status = 'Unlisted';
  if (sn.liveBroadcastContent === 'upcoming') status = 'Premiere';
  if (sn.liveBroadcastContent === 'live') status = 'Live';
  const num = (x) => (x == null ? null : Number(x));
  return {
    id: item.id,
    title: sn.title || '',
    description: sn.description || '',
    tags: sn.tags || [],
    categoryId: sn.categoryId || '',
    categoryName: categories[sn.categoryId] || '',
    publishedAt: sn.publishedAt || '',
    publishAt: st.publishAt || '',
    premiereAt: item.liveStreamingDetails?.scheduledStartTime || '',
    status,
    privacy: st.privacyStatus || '',
    durationSec,
    isShort,
    vertical,
    definition: cd.definition || '',
    caption: cd.caption === 'true',
    defaultLanguage: sn.defaultLanguage || '',
    defaultAudioLanguage: sn.defaultAudioLanguage || '',
    localizations: Object.keys(item.localizations || {}),
    madeForKids: st.madeForKids ?? null,
    thumb: bestThumb(sn.thumbnails),
    thumbSmall: (sn.thumbnails?.medium || sn.thumbnails?.default || {}).url || '',
    views: num(stats.viewCount),
    likes: num(stats.likeCount),
    comments: num(stats.commentCount),
    playlists: membership ? membership.get(item.id) || [] : [],
    thumbCustom: null,
  };
}

// ---------------------------------------------------------------------------
// Google sign-in (Google Identity Services token client). Token lives in memory only.
// ---------------------------------------------------------------------------
export async function signIn(clientId) {
  if (!clientId) throw new ApiError('Add your OAuth Client ID in Settings first.', 'noClientId', 0);
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) reject(new ApiError(r.error_description || r.error, 'oauth', 0));
        else resolve({ token: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      },
      error_callback: (e) => reject(new ApiError(e?.type === 'popup_closed' ? 'The Google sign-in window was closed.' : e?.message || 'Sign-in failed.', 'oauth', 0)),
    });
    tc.requestAccessToken({ prompt: '' });
  });
}

export function signOut(token) {
  try {
    window.google?.accounts?.oauth2?.revoke(token, () => {});
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Custom thumbnail check: compares the chosen thumbnail with YouTube's 3 auto frames.
// Returns true (custom), false (auto frame) or null (could not check).
// ---------------------------------------------------------------------------
async function pixels(url) {
  const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!res.ok) throw new Error('img');
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, 32, 24);
  return ctx.getImageData(0, 0, 32, 24).data;
}

function diff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
}

export async function isCustomThumbnail(videoId) {
  try {
    const main = await pixels(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    let compared = 0;
    for (const n of ['hq1', 'hq2', 'hq3']) {
      try {
        const d = await pixels(`https://i.ytimg.com/vi/${videoId}/${n}.jpg`);
        compared++;
        if (diff(main, d) < 9) return false;
      } catch {
        /* frame missing */
      }
    }
    return compared ? true : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keyword ideas from YouTube search autocomplete.
// The JSONP request runs in a small helper page (assets/suggest.html) inside a sandboxed
// iframe with no origin, so it has no access to this page or your key.
// (An inline srcdoc frame can't be used: it inherits this page's script policy.)
// ---------------------------------------------------------------------------
const SUGGEST_PAGE = new URL('../suggest.html', import.meta.url).href;

export function keywordIdeas(seed, { hl = 'hi', gl = 'IN' } = {}) {
  return new Promise((resolve, reject) => {
    const nonce = Math.random().toString(36).slice(2);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.display = 'none';
    frame.src = `${SUGGEST_PAGE}#${new URLSearchParams({ q: seed, hl, gl, n: nonce })}`;
    const timer = setTimeout(() => done(new Error('No answer from YouTube suggestions. Try again.')), 8000);
    function done(err, list) {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      frame.remove();
      err ? reject(err) : resolve(list);
    }
    function onMsg(e) {
      if (e.source !== frame.contentWindow || !e.data || e.data.n !== nonce) return;
      if (e.data.e) return done(new Error('YouTube suggestions are blocked on this network.'));
      const raw = Array.isArray(e.data.d) ? e.data.d[1] : [];
      const list = (raw || []).map((x) => (Array.isArray(x) ? x[0] : x)).filter((x) => typeof x === 'string').slice(0, 15);
      done(null, list);
    }
    window.addEventListener('message', onMsg);
    document.body.append(frame);
  });
}
