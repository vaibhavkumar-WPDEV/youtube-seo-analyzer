// SEO rules for YouTube videos and channels.
// Every rule returns { status: pass | warn | fail | unknown | info, msg, fix }.
// Score = weighted share of passed checks (warn counts half). "unknown" and "info" are not scored.

import { glen, normalize, gslice, daysSince, camelTag, fmtDuration } from './util.js';

const STOP = new Set(
  ('the and for with you your from this that are was were will can how what why who when new best top full video videos ' +
    'episode ep part shorts short official hai ka ki ke se me mein aur ko par na ho to hi bhi ek kya kaise jab tak sab ' +
    'in on of a an is it at by or be as do so up my we').split(' ')
);

export function words(str) {
  return normalize(str)
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

export function hashtags(str) {
  const out = [];
  for (const m of (str || '').matchAll(/(?:^|[\s(])#([\p{L}\p{N}_]+)/gu)) out.push(m[1]);
  return out;
}

export const emojiCount = (str) => ((str || '').match(/\p{Extended_Pictographic}/gu) || []).length;

const toSec = (t) => {
  const p = t.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

export function parseChapters(desc) {
  const re = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*(?:[-–—:|•]\s*)?(.*)$/;
  const items = [];
  for (const line of (desc || '').split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) items.push({ t: toSec(m[1]), stamp: m[1], label: m[2].trim() });
  }
  if (!items.length) return { items, valid: false, reason: 'none' };
  if (items[0].t !== 0) return { items, valid: false, reason: 'the first timestamp must be 0:00' };
  if (items.length < 3) return { items, valid: false, reason: 'YouTube needs at least 3 timestamps' };
  for (let i = 1; i < items.length; i++) {
    if (items[i].t <= items[i - 1].t) return { items, valid: false, reason: `timestamps must go up in order (${items[i].stamp})` };
    if (items[i].t - items[i - 1].t < 10) return { items, valid: false, reason: `each chapter must be 10+ seconds long (${items[i - 1].stamp} → ${items[i].stamp})` };
  }
  return { items, valid: true, reason: '' };
}

// Earliest match of any phrase (also matches the joined #hashtag form, e.g. "rasoikijung").
export function firstHit(text, phrases) {
  const t = normalize(text);
  const squashed = t.replace(/\s+/g, '');
  let best = null;
  for (const raw of phrases) {
    const p = normalize(raw).trim();
    if (!p) continue;
    let i = t.indexOf(p);
    if (i < 0 && p.includes(' ')) {
      const j = squashed.indexOf(p.replace(/\s+/g, ''));
      if (j >= 0) i = j; // approximate position
    }
    if (i >= 0 && (!best || i < best.index)) best = { phrase: raw.trim(), index: i };
  }
  return best;
}

export const containsAny = (text, phrases) => !!firstHit(text, phrases);

const LINK_RE = /(youtube\.com\/(@|channel\/|c\/|playlist|watch|shorts\/)|youtu\.be\/|sub_confirmation=1)/i;

function titleRange(v) {
  return v.isShort ? { min: 20, max: 60 } : { min: 30, max: 70 };
}

// ---------------------------------------------------------------------------
// Video rules
// ---------------------------------------------------------------------------
export const VIDEO_RULES = [
  // ---- Title ----
  {
    id: 'title_length', group: 'Title', issue: 'Title too long or too short', weight: 6,
    check(v) {
      const n = glen(v.title);
      const { min, max } = titleRange(v);
      if (n > max) return { status: 'warn', msg: `Title is ${n} characters`, fix: `Keep it under ${max} so it isn't cut off in search. Put the main keyword in the first 40 characters.` };
      if (n < min) return { status: 'warn', msg: `Title is only ${n} characters`, fix: `Add the main keyword and what happens in the video (aim for ${min}–${max} characters).` };
      return { status: 'pass', msg: `Good length (${n} characters)` };
    },
  },
  {
    id: 'title_keyword', group: 'Title', issue: 'Keyword missing or late in title', weight: 8,
    check(v, ctx) {
      if (!ctx.keywords.length) return { status: 'info', msg: 'Add target keywords in Settings to check keyword use' };
      const hit = firstHit(v.title, ctx.keywords);
      if (!hit) return { status: 'fail', msg: 'No target keyword in the title', fix: `Add one of: ${ctx.keywords.slice(0, 4).join(', ')}.` };
      if (hit.index > 40) return { status: 'warn', msg: `"${hit.phrase}" starts at character ${hit.index + 1}`, fix: 'Move it into the first 40 characters. Mobile search cuts long titles.' };
      return { status: 'pass', msg: `"${hit.phrase}" is near the start` };
    },
  },
  {
    id: 'title_unique', group: 'Title', issue: 'Duplicate title', weight: 3,
    check(v, ctx) {
      const n = ctx.titleCount.get(normalize(v.title).trim()) || 0;
      if (n > 1) return { status: 'fail', msg: `Same title as ${n - 1} other video${n > 2 ? 's' : ''}`, fix: 'Give every video its own title so they don\'t compete with each other.' };
      return { status: 'pass', msg: 'Title is unique on your channel' };
    },
  },
  {
    id: 'title_caps', group: 'Title', issue: 'Too many capital letters', weight: 2,
    check(v) {
      const letters = (v.title.match(/[\p{Lu}\p{Ll}]/gu) || []);
      const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
      if (letters.length >= 12 && upper / letters.length > 0.6)
        return { status: 'warn', msg: 'Title is mostly CAPITAL letters', fix: 'Use normal case and capitalise only 1–2 words. All caps looks like spam.' };
      return { status: 'pass', msg: 'Normal use of capital letters' };
    },
  },
  {
    id: 'title_emoji', group: 'Title', issue: 'Too many emojis in title', weight: 2,
    check(v) {
      const n = emojiCount(v.title);
      if (n > 2) return { status: 'warn', msg: `${n} emojis in the title`, fix: 'Keep 1–2 emojis. They use space your keywords need.' };
      return { status: 'pass', msg: n ? `${n} emoji${n > 1 ? 's' : ''} — fine` : 'No emojis — fine' };
    },
  },
  {
    id: 'title_brand', group: 'Title', issue: 'No series or brand name in title', weight: 2,
    check(v, ctx) {
      if (!ctx.brands.length) return { status: 'info', msg: 'Add brand words in Settings to check this' };
      if (containsAny(v.title, ctx.brands)) return { status: 'pass', msg: 'Series or brand name is in the title' };
      return { status: 'warn', msg: 'No series or brand name', fix: `Add "| ${ctx.brands[0]}" at the end so viewers recognise your series.` };
    },
  },

  // ---- Description ----
  {
    id: 'desc_length', group: 'Description', issue: 'Description too short', weight: 6,
    check(v) {
      const n = glen(v.description.trim());
      const [ok, low] = v.isShort ? [100, 30] : [500, 150];
      const fix = v.isShort
        ? 'Add 1–2 lines about the clip with a keyword and the name of the full episode.'
        : 'Write 2–3 short paragraphs (500+ characters): what happens, who is in it, and your main keywords.';
      if (n >= ok) return { status: 'pass', msg: `${n} characters` };
      if (n >= low) return { status: 'warn', msg: `Only ${n} characters`, fix };
      return { status: 'fail', msg: n ? `Only ${n} characters` : 'Description is empty', fix };
    },
  },
  {
    id: 'desc_hook', group: 'Description', issue: 'Keyword not in the first 2 lines', weight: 6,
    check(v, ctx) {
      const first = gslice(v.description.trim(), 150);
      if (!first) return { status: 'fail', msg: 'Nothing above "more"', fix: 'Start the description with one sentence that uses your main keyword.' };
      if (/^\s*(https?:\/\/|#)/i.test(first)) return { status: 'warn', msg: 'Starts with a link or hashtags', fix: 'Start with a sentence people can read. Move links and hashtags lower.' };
      const phrases = ctx.keywords.length ? ctx.keywords : words(v.title).slice(0, 6);
      const hit = firstHit(first, phrases);
      if (hit) return { status: 'pass', msg: `"${hit.phrase}" is in the first 150 characters` };
      return {
        status: ctx.keywords.length ? 'fail' : 'warn',
        msg: 'First 150 characters miss your keyword',
        fix: `Search and viewers only see the first 2 lines. Use "${phrases[0] || 'your main keyword'}" in the first sentence.`,
      };
    },
  },
  {
    id: 'desc_hashtags', group: 'Description', issue: 'No hashtags or too many', weight: 4,
    check(v) {
      const n = new Set([...hashtags(v.title), ...hashtags(v.description)].map((x) => x.toLowerCase())).size;
      if (n === 0) return { status: 'warn', msg: 'No hashtags', fix: 'Add 3–5 relevant hashtags at the end of the description. The first 3 show above your title.' };
      if (n > 60) return { status: 'fail', msg: `${n} hashtags — YouTube ignores all of them`, fix: 'Use 15 or fewer. Above 60, YouTube drops every hashtag on the video.' };
      if (n > 15) return { status: 'warn', msg: `${n} hashtags is a lot`, fix: 'Keep 3–15. Only the first 3 show above the title.' };
      return { status: 'pass', msg: `${n} hashtag${n > 1 ? 's' : ''}` };
    },
  },
  {
    id: 'desc_chapters', group: 'Description', issue: 'No chapters', weight: 5,
    applies: (v) => !v.isShort && v.durationSec >= 180,
    check(v) {
      const ch = parseChapters(v.description);
      if (ch.valid) return { status: 'pass', msg: `${ch.items.length} chapters` };
      if (ch.reason === 'none')
        return { status: 'warn', msg: 'No chapters', fix: `Add timestamps in the description starting at 0:00 (3 or more, each 10+ seconds). Chapters show in search and on Google. Video length: ${fmtDuration(v.durationSec)}.` };
      return { status: 'fail', msg: `Chapters won't show: ${ch.reason}`, fix: 'Fix the timestamps so the first is 0:00, they go up in order, and each part is 10+ seconds.' };
    },
  },
  {
    id: 'desc_links', group: 'Description', issue: 'No subscribe or playlist link', weight: 4,
    weightFor: (v) => (v.isShort ? 1 : 4),
    check(v) {
      if (LINK_RE.test(v.description)) return { status: 'pass', msg: 'Has channel, playlist or video links' };
      return { status: 'warn', msg: 'No subscribe or playlist link', fix: 'Add your subscribe link (youtube.com/@handle?sub_confirmation=1) and a playlist link so viewers keep watching.' };
    },
  },
  {
    id: 'desc_unique', group: 'Description', issue: 'Copy-paste description', weight: 2,
    check(v, ctx) {
      const key = normalize(v.description).trim();
      if (!key) return { status: 'info', msg: 'Empty description' };
      const n = ctx.descCount.get(key) || 0;
      if (n > 1) return { status: 'warn', msg: `Same description as ${n - 1} other video${n > 2 ? 's' : ''}`, fix: 'Keep your footer, but write a unique first paragraph for each video.' };
      return { status: 'pass', msg: 'Description is unique' };
    },
  },

  // ---- Tags ----
  {
    id: 'tags_count', group: 'Tags', issue: 'Few or no tags', weight: 5,
    check(v) {
      const n = v.tags.length;
      if (!n) return { status: 'fail', msg: 'No tags', fix: 'Add 10–15 tags: brand, series name, main keywords and spelling variations (Hindi + English).' };
      if (n < 5) return { status: 'warn', msg: `Only ${n} tag${n > 1 ? 's' : ''}`, fix: 'Add more: series name, characters, topic and the words people search.' };
      return { status: 'pass', msg: `${n} tags` };
    },
  },
  {
    id: 'tags_chars', group: 'Tags', issue: 'Tag space unused', weight: 2,
    applies: (v) => v.tags.length > 0,
    check(v) {
      const n = tagChars(v.tags);
      if (n < 150) return { status: 'warn', msg: `Tags use ${n} of 500 characters`, fix: 'Add a few more relevant phrases. YouTube allows 500 characters.' };
      return { status: 'pass', msg: `${n} of 500 characters used` };
    },
  },
  {
    id: 'tags_keyword', group: 'Tags', issue: 'Keyword not in tags', weight: 4,
    applies: (v) => v.tags.length > 0,
    check(v, ctx) {
      const phrases = ctx.keywords.length ? ctx.keywords : words(v.title).slice(0, 6);
      if (!phrases.length) return { status: 'info', msg: 'Add target keywords in Settings' };
      if (containsAny(v.tags.join(' | '), phrases)) return { status: 'pass', msg: 'Tags include your keyword' };
      return { status: 'warn', msg: 'Tags miss your main keyword', fix: `Add "${phrases[0]}" and close variations as tags.` };
    },
  },
  {
    id: 'tags_brand', group: 'Tags', issue: 'No brand tag', weight: 2,
    applies: (v) => v.tags.length > 0,
    check(v, ctx) {
      if (!ctx.brands.length) return { status: 'info', msg: 'Add brand words in Settings' };
      if (containsAny(v.tags.join(' | '), ctx.brands)) return { status: 'pass', msg: 'Brand is in the tags' };
      return { status: 'warn', msg: 'No brand tag', fix: `Add ${ctx.brands.map((b) => `"${b}"`).join(', ')} as tags.` };
    },
  },

  // ---- Thumbnail & video ----
  {
    id: 'thumb_custom', group: 'Thumbnail & video', issue: 'Auto-generated thumbnail', weight: 5,
    check(v) {
      if (v.thumbCustom === true) return { status: 'pass', msg: 'Custom thumbnail' };
      if (v.thumbCustom === false)
        return { status: 'warn', msg: 'Looks like an auto-picked frame', fix: v.isShort ? 'Upload a custom 1080×1920 thumbnail: big character, 2–4 bold words.' : 'Upload a custom 1280×720 thumbnail: big face or character, 2–4 bold words, strong contrast.' };
      return { status: 'unknown', msg: 'Not checked (private video or image blocked) — look at the preview' };
    },
  },
  {
    id: 'captions', group: 'Thumbnail & video', issue: 'No subtitles', weight: 4,
    weightFor: (v) => (v.isShort ? 1 : 4),
    check(v) {
      if (v.caption) return { status: 'pass', msg: 'Has uploaded subtitles' };
      return { status: 'warn', msg: 'No uploaded subtitles', fix: 'Upload or auto-sync subtitles (Hindi and English). They help search and people who watch on mute.' };
    },
  },
  {
    id: 'language', group: 'Thumbnail & video', issue: 'Language not set', weight: 2,
    check(v) {
      if (v.defaultLanguage && v.defaultAudioLanguage) return { status: 'pass', msg: `Language set (${v.defaultAudioLanguage})` };
      return { status: 'warn', msg: 'Video or title language not set', fix: 'In Studio → Details → Show more → Language and captions, set both the video language and the title language.' };
    },
  },
  {
    id: 'hd', group: 'Thumbnail & video', issue: 'Not HD', weight: 2,
    check(v) {
      if (v.definition === 'hd') return { status: 'pass', msg: 'HD quality' };
      return { status: 'warn', msg: 'SD quality', fix: 'Export and upload in 1080p or higher.' };
    },
  },
  {
    id: 'translations', group: 'Thumbnail & video', issue: 'No title translation', weight: 1,
    check(v) {
      const n = v.localizations.length;
      if (n) return { status: 'pass', msg: `${n} title translation${n > 1 ? 's' : ''}` };
      return { status: 'warn', msg: 'No title translations', fix: 'Add an English title and description in Studio → Languages to reach more viewers.' };
    },
  },
  {
    id: 'in_playlist', group: 'Thumbnail & video', issue: 'Not in a playlist', weight: 2,
    applies: (v, ctx) => ctx.playlistsLoaded,
    check(v) {
      if (v.playlists.length) return { status: 'pass', msg: `In ${v.playlists.join(', ')}` };
      return { status: 'warn', msg: 'Not in any playlist', fix: 'Add it to a playlist. Playlists keep people watching and show up in search.' };
    },
  },

  // ---- Engagement (only for public videos with enough views) ----
  {
    id: 'like_rate', group: 'Engagement', issue: 'Low likes', weight: 4,
    applies: (v) => v.status === 'Public' && daysSince(v.publishedAt) >= 2 && v.views >= 30 && v.likes != null,
    check(v) {
      const r = v.likes / v.views;
      const msg = `${(r * 100).toFixed(1)}% of viewers liked`;
      const fix = 'Ask for a like at a high point of the video and at the end. Pin a comment that asks a question.';
      if (r >= 0.04) return { status: 'pass', msg };
      if (r >= 0.02) return { status: 'warn', msg, fix };
      return { status: 'fail', msg, fix };
    },
  },
  {
    id: 'comment_rate', group: 'Engagement', issue: 'Few comments', weight: 2,
    applies: (v) => v.status === 'Public' && daysSince(v.publishedAt) >= 2 && v.views >= 30 && v.comments != null,
    check(v) {
      const r = (v.comments / v.views) * 1000;
      const msg = `${r.toFixed(1)} comments per 1,000 views`;
      const fix = 'Ask one simple question in the video ("Kaun jeetega?") and pin it as the first comment.';
      if (r >= 5) return { status: 'pass', msg };
      if (r >= 1) return { status: 'warn', msg, fix };
      return { status: 'fail', msg, fix };
    },
  },
];

export function tagChars(tags) {
  // YouTube counts the comma between tags and adds quotes around tags with spaces.
  return tags.reduce((sum, t) => sum + glen(t) + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

export function buildContext(videos, settings, playlistsLoaded) {
  const count = (fn) => {
    const m = new Map();
    for (const v of videos) {
      const k = fn(v);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  return {
    keywords: settings.keywords || [],
    brands: settings.brands || [],
    titleCount: count((v) => normalize(v.title).trim()),
    descCount: count((v) => normalize(v.description).trim()),
    playlistsLoaded: !!playlistsLoaded,
  };
}

const VALUE = { pass: 1, warn: 0.5, fail: 0 };

export function analyzeVideo(v, ctx) {
  const results = [];
  let got = 0;
  let max = 0;
  for (const rule of VIDEO_RULES) {
    if (rule.applies && !rule.applies(v, ctx)) continue;
    const r = rule.check(v, ctx);
    const weight = rule.weightFor ? rule.weightFor(v) : rule.weight;
    const scored = r.status in VALUE;
    if (scored) {
      got += weight * VALUE[r.status];
      max += weight;
    }
    results.push({ id: rule.id, group: rule.group, issue: rule.issue, weight: scored ? weight : 0, ...r });
  }
  const score = max ? Math.round((got / max) * 100) : 0;
  return {
    score,
    results,
    fails: results.filter((r) => r.status === 'fail').length,
    warns: results.filter((r) => r.status === 'warn').length,
  };
}

export function analyzeAll(videos, settings, playlistsLoaded) {
  const ctx = buildContext(videos, settings, playlistsLoaded);
  const byId = new Map();
  for (const v of videos) byId.set(v.id, analyzeVideo(v, ctx));
  return byId;
}

export function band(score) {
  if (score >= 80) return { key: 'great', label: 'Great', status: 'pass' };
  if (score >= 60) return { key: 'okay', label: 'Okay', status: 'warn' };
  return { key: 'poor', label: 'Needs work', status: 'fail' };
}

// Issues across the channel, worst first (weight × videos affected, fails count double).
export function topIssues(videos, analysis) {
  const agg = new Map();
  for (const v of videos) {
    const a = analysis.get(v.id);
    if (!a) continue;
    for (const r of a.results) {
      if (r.status !== 'fail' && r.status !== 'warn') continue;
      const cur = agg.get(r.id) || { id: r.id, issue: r.issue, group: r.group, videos: 0, fails: 0, warns: 0, priority: 0 };
      cur.videos += 1;
      cur[r.status === 'fail' ? 'fails' : 'warns'] += 1;
      cur.priority += r.weight * (r.status === 'fail' ? 1 : 0.5);
      agg.set(r.id, cur);
    }
  }
  return [...agg.values()].sort((a, b) => b.priority - a.priority || b.videos - a.videos);
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------
export function suggestHashtags(v, settings) {
  const seen = new Set();
  const out = [];
  const add = (phrase) => {
    const tag = camelTag(phrase);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(`#${tag}`);
    }
  };
  (settings.brands || []).forEach(add);
  (settings.keywords || []).forEach(add);
  hashtags(v.description).forEach(add);
  if (v.isShort) add('Shorts');
  return out.slice(0, 5);
}

export function suggestTags(v, settings) {
  const seen = new Set();
  const out = [];
  const covered = (k) => out.some((t) => normalize(t).includes(k));
  const add = (t, { skipIfCovered = false } = {}) => {
    const tag = (t || '').replace(/\p{Extended_Pictographic}/gu, '').replace(/[#|<>:;!?"“”()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const k = normalize(tag);
    if (tag.length < 3 || tag.length > 60 || seen.has(k)) return;
    if (skipIfCovered && covered(k)) return;
    seen.add(k);
    out.push(tag);
  };
  (settings.brands || []).forEach((b) => add(b));
  (settings.keywords || []).forEach((k) => add(k));
  add(v.title.split('|')[0].toLowerCase());
  v.tags.forEach((t) => add(t));
  // Two-word phrases that sit next to each other in the title (never across | or :).
  const good = (x) => x.length >= 3 && !STOP.has(x) && !/^\d+$/.test(x);
  for (const part of normalize(v.title).split(/[|:–—\-,.!?]+/)) {
    const t = part.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (let i = 0; i < t.length - 1; i++) if (good(t[i]) && good(t[i + 1])) add(`${t[i]} ${t[i + 1]}`, { skipIfCovered: true });
  }
  const picked = [];
  for (const t of out) {
    if (tagChars([...picked, t]) > 480) break;
    picked.push(t);
  }
  return picked;
}

export function chapterTemplate(v) {
  const step = Math.max(10, Math.round(v.durationSec / 6 / 10) * 10);
  const lines = ['0:00 Shuruaat (intro)'];
  for (let t = step; t < v.durationSec - 10 && lines.length < 6; t += step) lines.push(`${fmtDuration(t)} …`);
  return lines.join('\n');
}

export function claudePrompt(v, analysis, settings, channelTitle) {
  const problems = analysis.results.filter((r) => r.status === 'fail' || r.status === 'warn').map((r) => `- ${r.msg}${r.fix ? ` → ${r.fix}` : ''}`);
  const { max } = titleRange(v);
  const needsChapters = !v.isShort && v.durationSec >= 180 && !parseChapters(v.description).valid;
  return [
    'You are a YouTube SEO expert. Improve this video\'s metadata.',
    'Keep the facts. No clickbait. Keep the same language style (Hindi / Hinglish if that is what the title uses).',
    '',
    `Channel: ${channelTitle || '—'}`,
    `Type: ${v.isShort ? 'YouTube Short' : 'Long video'} · Length ${fmtDuration(v.durationSec)}`,
    `Target keywords: ${(settings.keywords || []).join(', ') || '—'}`,
    `Brand / series: ${(settings.brands || []).join(', ') || '—'}`,
    '',
    `Current title: ${v.title}`,
    'Current description:',
    '"""',
    v.description || '(empty)',
    '"""',
    `Current tags: ${v.tags.join(', ') || '(none)'}`,
    '',
    'Problems found:',
    ...(problems.length ? problems : ['- none']),
    '',
    'Give me:',
    `1. 3 title options, each under ${max} characters, main keyword in the first 40 characters`,
    '2. New first 2 lines for the description (under 150 characters, with the main keyword)',
    '3. 15 tags as one comma-separated line (under 500 characters in total)',
    '4. 3 hashtags',
    ...(needsChapters ? ['5. A chapter list starting at 0:00 (I will fix the times)'] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Channel rules
// ---------------------------------------------------------------------------
export function analyzeChannel(ch, videos, analysis, settings) {
  const out = [];
  const add = (id, label, status, msg, fix) => out.push({ id, label, status, msg, fix });
  const desc = (ch.description || '').trim();
  const n = glen(desc);
  add('ch_desc', 'Channel description', n >= 300 ? 'pass' : n >= 100 ? 'warn' : 'fail', `${n} characters`,
    n >= 300 ? '' : 'Write 300+ characters: what the channel is, who it is for, how often you upload, and your main keywords.');

  const phrases = settings.keywords || [];
  if (phrases.length) {
    const hit = firstHit(gslice(desc, 150), phrases);
    add('ch_desc_kw', 'Keyword at the start of the channel description', hit ? 'pass' : 'warn', hit ? `"${hit.phrase}" is in the first 150 characters` : 'Not in the first 150 characters', hit ? '' : `Start the channel description with "${phrases[0]}".`);
  }

  const kw = (ch.keywords || '').match(/"[^"]+"|\S+/g) || [];
  add('ch_keywords', 'Channel keywords', kw.length >= 5 ? 'pass' : kw.length ? 'warn' : 'fail', kw.length ? `${kw.length} keywords` : 'None set',
    kw.length >= 5 ? '' : 'Add 5–15 keywords in Studio → Settings → Channel → Basic info → Keywords.');

  add('ch_trailer', 'Channel trailer', ch.trailer ? 'pass' : 'warn', ch.trailer ? 'Set' : 'Not set', ch.trailer ? '' : 'Pick a short video as the trailer for people who haven\'t subscribed (Customisation → Home tab).');
  add('ch_banner', 'Banner image', ch.banner ? 'pass' : 'warn', ch.banner ? 'Set' : 'Not set', ch.banner ? '' : 'Upload a 2560×1440 banner with your channel name and upload schedule.');
  add('ch_country', 'Country', ch.country ? 'pass' : 'warn', ch.country || 'Not set', ch.country ? '' : 'Set your country in Studio → Settings → Channel.');
  add('ch_lang', 'Default language', ch.defaultLanguage ? 'pass' : 'warn', ch.defaultLanguage || 'Not set', ch.defaultLanguage ? '' : 'Set the channel language in Studio → Settings → Channel.');
  add('ch_handle', 'Handle', ch.handle ? 'pass' : 'warn', ch.handle || 'Not set', ch.handle ? '' : 'Choose a short handle that matches your channel name.');

  const now = Date.now();
  const recent = videos.filter((v) => v.status === 'Public' && now - new Date(v.publishedAt).getTime() <= 30 * 86400000).length;
  const upcoming = videos.filter((v) => {
    const t = new Date(v.publishAt || v.premiereAt || 0).getTime();
    return t > now && t - now <= 30 * 86400000;
  }).length;
  const total = recent + upcoming;
  add('ch_cadence', 'Upload rhythm (30 days back + 30 days ahead)', total >= 8 ? 'pass' : total >= 3 ? 'warn' : 'fail', `${recent} published, ${upcoming} scheduled`,
    total >= 8 ? '' : 'Aim for at least 2 uploads a week. Shorts count.');

  if (ch.playlists) {
    const pl = ch.playlists.length;
    add('ch_playlists', 'Playlists', pl >= 3 ? 'pass' : pl ? 'warn' : 'fail', `${pl} playlist${pl === 1 ? '' : 's'}`, pl >= 3 ? '' : 'Group videos into playlists: episodes, characters, Shorts.');
    const inPl = videos.filter((v) => v.playlists.length).length;
    const share = videos.length ? inPl / videos.length : 0;
    add('ch_pl_cover', 'Videos inside playlists', share >= 0.8 ? 'pass' : share >= 0.4 ? 'warn' : 'fail', `${inPl} of ${videos.length} videos`, share >= 0.8 ? '' : 'Put every video in at least one playlist.');
  }

  const scores = videos.map((v) => analysis.get(v.id)?.score ?? 0);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  return { checks: out, avg };
}
