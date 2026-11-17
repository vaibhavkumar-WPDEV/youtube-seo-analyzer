import {
  $, $$, h, clear, compact, full, pct, fmtDate, fmtDateTime, fmtDuration, glen, gslice, store, download, csvCell,
  debounce, copyText, statusIcon, STATUS_WORD, todayKey, pool, normalize,
} from './util.js';
import {
  analyzeAll, analyzeChannel, band, topIssues, suggestHashtags, suggestTags, chapterTemplate, claudePrompt,
  parseChapters, hashtags, words, firstHit, tagChars, VIDEO_RULES,
} from './rules.js';
import { YouTubeClient, ApiError, normalizeVideo, signIn, signOut, isCustomThumbnail, keywordIdeas } from './api.js';
import { rankedBars, histogram, scatter, lineChart, dataTable, hideTip } from './charts.js';
import { demoData } from './demo.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const KEY = {
  settings: 'ytseo.settings.v1',
  last: 'ytseo.last.v1',
  theme: 'ytseo.theme.v1',
  snap: (id) => `ytseo.snap.${id}`,
  hist: (id) => `ytseo.hist.${id}`,
};

const DEFAULTS = { apiKey: '', clientId: '', channel: '', keywords: [], brands: [], maxVideos: 200, checkThumbs: true, region: 'IN' };

const state = {
  settings: { ...DEFAULTS, ...store.get(KEY.settings, {}) },
  token: null,
  data: null, // { channel, videos, fetchedAt, mode, units, playlistsLoaded }
  analysis: new Map(),
  channelReport: null,
  history: [],
  filters: { type: 'all', status: 'all', band: 'all', issue: 'all', bin: null, q: '' },
  sort: { key: 'score', dir: 'asc' },
  view: 'videos',
  busy: false,
  drawerId: null,
  tables: {},
  lastFocus: null,
};

const VIEWS = ['videos', 'keywords', 'channel', 'settings'];
const BINS = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, label: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}` }));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
  applyTheme(store.get(KEY.theme, 'auto'));
  $('#theme-btn').addEventListener('click', cycleTheme);
  $('#analyze-btn').addEventListener('click', () => analyze());
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.drawerId) closeDrawer();
    if (e.key === 'Tab' && state.drawerId) trapFocus(e);
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', debounce(() => renderCharts(), 150));

  const last = store.get(KEY.last, null);
  if (last) {
    const snap = store.get(KEY.snap(last), null);
    if (snap) loadSnapshot(snap);
  }
  route();
}

function route() {
  const v = location.hash.replace('#', '');
  state.view = VIEWS.includes(v) ? v : 'videos';
  render();
}

function go(view) {
  if (location.hash !== `#${view}`) location.hash = view;
  else route();
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
  const label = { auto: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' }[mode] || 'Theme: auto';
  $('#theme-btn').textContent = label;
  $('#theme-btn').dataset.mode = mode;
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf($('#theme-btn').dataset.mode || 'auto') + 1) % 3];
  store.set(KEY.theme, next);
  applyTheme(next);
  renderCharts();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function loadSnapshot(snap) {
  state.data = snap;
  recompute();
  state.history = snap.mode === 'demo' ? snap.history || [] : store.get(KEY.hist(snap.channel.id), []);
}

function recompute() {
  if (!state.data) return;
  const settings = state.data.mode === 'demo' ? { ...state.settings, ...state.data.demoSettings } : state.settings;
  state.analysis = analyzeAll(state.data.videos, settings, state.data.playlistsLoaded);
  state.channelReport = analyzeChannel(state.data.channel, state.data.videos, state.analysis, settings);
}

function activeSettings() {
  return state.data?.mode === 'demo' ? { ...state.settings, ...state.data.demoSettings } : state.settings;
}

function loadDemo() {
  const d = demoData();
  const snap = {
    mode: 'demo',
    channel: d.channel,
    videos: d.items,
    fetchedAt: new Date().toISOString(),
    units: 0,
    playlistsLoaded: true,
    demoSettings: d.settings,
    history: [],
  };
  state.data = snap;
  recompute();
  state.history = [...d.history, { date: todayKey(), avg: state.channelReport.avg, videos: d.items.length, views: d.channel.views, subs: d.channel.subscribers }];
  snap.history = state.history;
  state.filters = { type: 'all', status: 'all', band: 'all', issue: 'all', bin: null, q: '' };
  toast('Demo data loaded. This is a made-up channel.');
  go('videos');
  render();
}

function tokenValid() {
  return state.token && state.token.expiresAt > Date.now() + 30000;
}

async function analyze() {
  if (state.busy) return;
  const st = state.settings;
  if (!tokenValid() && !st.apiKey) {
    toast('Add a YouTube API key (or sign in with Google) first.', 'error');
    go('settings');
    return;
  }
  if (!tokenValid() && !st.channel) {
    toast('Enter your channel handle first, like @TadakBoom.', 'error');
    go('settings');
    return;
  }
  setBusy(true);
  const client = new YouTubeClient({ apiKey: st.apiKey, accessToken: tokenValid() ? state.token.token : '' });
  try {
    progress('Reading channel…');
    const channel = await client.channel(st.channel);
    progress('Listing videos…');
    const ids = await client.uploadIds(channel.uploads, Number(st.maxVideos) || 200, (n) => progress(`Listing videos… ${n}`));
    progress(`Reading ${ids.length} videos…`);
    const raw = await client.videos(ids, (n, total) => progress(`Reading videos… ${n} of ${total}`));
    let categories = {};
    try {
      categories = await client.categories(st.region || 'IN');
    } catch {
      /* optional */
    }
    let membership = null;
    try {
      progress('Reading playlists…');
      channel.playlists = await client.playlists(channel.id);
      membership = await client.playlistMembership(channel.playlists);
    } catch {
      channel.playlists = null;
    }
    const videos = raw.map((it) => normalizeVideo(it, categories, membership));
    const prev = store.get(KEY.snap(channel.id), null);
    const prevThumbs = new Map((prev?.videos || []).map((v) => [v.id, v.thumbCustom]));
    if (st.checkThumbs) {
      const publicOnes = videos.filter((v) => v.status === 'Public' || v.status === 'Unlisted' || v.status === 'Premiere');
      let blocked = 0;
      let done = 0;
      await pool(publicOnes, 6, async (v) => {
        if (prevThumbs.get(v.id) != null) {
          v.thumbCustom = prevThumbs.get(v.id);
        } else if (blocked < 3) {
          v.thumbCustom = await isCustomThumbnail(v.id);
          if (v.thumbCustom == null) blocked++;
        }
        done++;
        progress(`Checking thumbnails… ${done} of ${publicOnes.length}`);
      });
    }
    const snap = {
      mode: client.ownerMode ? 'owner' : 'key',
      channel,
      videos,
      fetchedAt: new Date().toISOString(),
      units: client.units,
      playlistsLoaded: !!membership,
    };
    state.data = snap;
    recompute();
    const hist = store.get(KEY.hist(channel.id), []).filter((x) => x.date !== todayKey());
    hist.push({ date: todayKey(), avg: state.channelReport.avg, videos: videos.length, views: channel.views, subs: channel.subscribers });
    state.history = hist.slice(-120);
    store.set(KEY.hist(channel.id), state.history);
    if (!store.set(KEY.snap(channel.id), snap)) toast('Analysis done, but this browser would not save it for next time.', 'error');
    store.set(KEY.last, channel.id);
    toast(`Analysed ${videos.length} videos. Used ${client.units} of 10,000 free API units today.`);
    if (state.view === 'settings') go('videos');
  } catch (err) {
    console.error(err);
    toast(err instanceof ApiError ? err.message : `Something went wrong: ${err.message}`, 'error');
    if (err.reason === 'authError') state.token = null;
  } finally {
    setBusy(false);
    progress('');
    render();
  }
}

function setBusy(b) {
  state.busy = b;
  const btn = $('#analyze-btn');
  btn.disabled = b;
  btn.textContent = b ? 'Analysing…' : 'Analyze channel';
  $('#main').setAttribute('aria-busy', b ? 'true' : 'false');
}

function progress(msg) {
  const el = $('#progress');
  el.textContent = msg;
  el.hidden = !msg;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'error' ? 9000 : 5000);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  hideTip();
  $$('[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'));
  VIEWS.forEach((v) => ($(`#view-${v}`).hidden = v !== state.view));
  renderHeader();
  const view = $(`#view-${state.view}`);
  clear(view);
  if (state.view === 'videos') renderVideos(view);
  if (state.view === 'keywords') renderKeywords(view);
  if (state.view === 'channel') renderChannel(view);
  if (state.view === 'settings') renderSettings(view);
  requestAnimationFrame(renderCharts);
}

function renderHeader() {
  const pill = $('#channel-pill');
  clear(pill);
  if (state.data) {
    const c = state.data.channel;
    const modeText = { demo: 'Demo data', key: 'Public videos', owner: 'All videos (signed in)' }[state.data.mode];
    pill.append(
      c.avatar ? h('img', { src: c.avatar, alt: '', width: 24, height: 24, loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('span', { class: 'pill-name', text: c.handle || c.title }),
      h('span', { class: 'pill-mode', text: modeText })
    );
    pill.hidden = false;
  } else pill.hidden = true;
}

const chartJobs = [];
function renderCharts() {
  for (const job of chartJobs) {
    if (document.body.contains(job.el) && !job.el.closest('[hidden]')) job.draw();
  }
}
function addChartJob(el, draw) {
  chartJobs.push({ el, draw });
}

// ---------- Videos view ----------
function emptyHero(view) {
  view.append(h('div', { class: 'empty-layout' },
    h(
      'section',
      { class: 'hero hero-empty' },
      h('h1', { class: 'hero-line', text: 'See what to fix on every video, without opening Studio.' }),
      h('p', { class: 'hero-sub', text: 'Connect your channel with a free YouTube API key. The analyzer checks each title, description, tag set, hashtag, chapter list, thumbnail and engagement rate, then lists exactly what to change.' }),
      h(
        'div',
        { class: 'hero-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('settings'), text: 'Connect your channel' }),
        h('button', { class: 'btn', type: 'button', onclick: loadDemo, text: 'Explore with demo data' })
      ),
      h('p', { class: 'fine', text: 'Runs in your browser. Your key stays on this device and is only sent to Google\'s YouTube API.' })
    ),
    proofSample()
  ));
}

// A small proof-sheet sample shown before any data is loaded.
function proofSample() {
  const title = 'Masala Mission Episode 5: Tiffin Ka Raaz | Hindi Cartoon Kahani for Kids and Family Full Episode';
  return h(
    'section',
    { class: 'sample', 'aria-label': 'Example of a title check' },
    h('h2', { class: 'section-title', text: 'How a title gets checked' }),
    titleProof({ title, isShort: false }, ['hindi cartoon', 'masala mission']),
    h(
      'ul',
      { class: 'checklist compact' },
      checkRow({ status: 'warn', msg: 'Title is 96 characters', fix: 'Keep it under 70 so it isn\'t cut off in search.' }),
      checkRow({ status: 'pass', msg: '"masala mission" is near the start' }),
      checkRow({ status: 'pass', msg: 'Series or brand name is in the title' })
    )
  );
}

function filteredVideos() {
  const f = state.filters;
  const q = normalize(f.q).trim();
  return state.data.videos.filter((v) => {
    const a = state.analysis.get(v.id);
    if (f.type === 'short' && !v.isShort) return false;
    if (f.type === 'long' && v.isShort) return false;
    if (f.status !== 'all' && v.status !== f.status) return false;
    if (f.band !== 'all' && band(a.score).key !== f.band) return false;
    if (f.issue !== 'all' && !a.results.some((r) => r.id === f.issue && (r.status === 'fail' || r.status === 'warn'))) return false;
    if (f.bin) {
      const b = BINS.find((x) => x.label === f.bin);
      if (b && (a.score < b.from || a.score > b.to)) return false;
    }
    if (q && !normalize(`${v.title} ${v.tags.join(' ')} ${v.description}`).includes(q)) return false;
    return true;
  });
}

function sortVideos(list) {
  const { key, dir } = state.sort;
  const m = dir === 'asc' ? 1 : -1;
  const val = (v) => {
    const a = state.analysis.get(v.id);
    if (key === 'score') return a.score;
    if (key === 'views') return v.views ?? -1;
    if (key === 'fixes') return a.fails * 100 + a.warns;
    if (key === 'date') return new Date(v.publishAt || v.premiereAt || v.publishedAt).getTime();
    if (key === 'title') return normalize(v.title);
    return 0;
  };
  return [...list].sort((x, y) => (val(x) > val(y) ? m : val(x) < val(y) ? -m : 0));
}

function renderVideos(view) {
  chartJobs.length = 0;
  if (!state.data) return emptyHero(view);
  const { channel, videos } = state.data;
  const scores = videos.map((v) => state.analysis.get(v.id).score);
  const need = scores.filter((x) => x < 80).length;
  const issues = topIssues(videos, state.analysis);
  const top = issues[0];
  const scheduled = videos.filter((v) => v.status === 'Scheduled' || v.status === 'Premiere').length;
  const shorts = videos.filter((v) => v.isShort).length;

  view.append(
    h(
      'section',
      { class: 'hero' },
      h(
        'h1',
        { class: 'hero-line' },
        need ? `${need} of ${videos.length} videos need work.` : `All ${videos.length} videos pass the main checks.`
      ),
      h(
        'p',
        { class: 'hero-sub' },
        top
          ? `Start with “${top.issue.toLowerCase()}”: ${top.videos} video${top.videos === 1 ? '' : 's'}. Click any video to see the fixes.`
          : 'Keep it up. Press Analyze after each upload to check the new video.'
      ),
      h(
        'div',
        { class: 'kpis' },
        meterTile('Channel SEO score', state.channelReport.avg),
        statTile('Subscribers', channel.subscribers == null ? 'Hidden' : compact(channel.subscribers)),
        statTile('Total views', compact(channel.views)),
        statTile('Videos checked', full(videos.length), `${shorts} Shorts · ${scheduled} scheduled`)
      ),
      h('p', { class: 'fine' }, `Last analysed ${fmtDateTime(state.data.fetchedAt)}${state.data.mode === 'key' ? ' · Public videos only. Sign in with Google in Settings to include scheduled and private videos.' : ''}`)
    )
  );

  view.append(filterRow(videos));
  const list = filteredVideos();

  const grid = h('div', { class: 'viz-grid' });
  const fixCard = chartCard('fix', 'Most common issues', 'Videos affected by each issue. Click a bar to list those videos.');
  const binCard = chartCard('bins', 'Score spread', 'How many videos sit in each score range.');
  const scatCard = chartCard('scatter', 'Views and SEO score', 'Public videos only. Each dot is one video.');
  grid.append(fixCard.card, h('div', { class: 'viz-col' }, binCard.card, scatCard.card));
  view.append(grid);

  const listIssues = topIssues(list, state.analysis).sort((a, b) => b.videos - a.videos || b.priority - a.priority).slice(0, 10);
  const fixRows = listIssues.map((i) => ({ key: i.id, label: i.issue, value: i.videos, detail: `${i.fails} to fix · ${i.warns} to improve` }));
  drawOrTable(fixCard, () => rankedBars(fixCard.body, fixRows, { total: list.length, selected: state.filters.issue, onSelect: (k) => setFilter('issue', state.filters.issue === k ? 'all' : k) }),
    ['Issue', 'Videos', 'To fix', 'To improve'], listIssues.map((i) => [i.issue, i.videos, i.fails, i.warns]));

  const bins = BINS.map((b) => ({ ...b, value: list.filter((v) => { const sc = state.analysis.get(v.id).score; return sc >= b.from && sc <= b.to; }).length }));
  drawOrTable(binCard, () => histogram(binCard.body, bins, { selected: state.filters.bin, onSelect: (label) => setFilter('bin', state.filters.bin === label ? null : label) }),
    ['Score range', 'Videos'], bins.map((b) => [b.label, b.value]));

  const pts = list.filter((v) => v.status === 'Public' && v.views != null).map((v) => ({ id: v.id, x: state.analysis.get(v.id).score, y: v.views, label: v.title }));
  if (pts.length < 2) {
    clear(scatCard.body).append(h('p', { class: 'empty-note', text: 'Shows up once at least 2 public videos are in this view.' }));
  } else {
    drawOrTable(scatCard, () => scatter(scatCard.body, pts, { onSelect: openDrawer }), ['Video', 'SEO score', 'Views'], pts.map((p) => [p.label, p.x, full(p.y)]));
  }

  view.append(videoTable(sortVideos(list)));
}

function chartCard(id, title, note) {
  const body = h('div', { class: 'chart-body' });
  const toggle = h('button', {
    type: 'button', class: 'link-btn', 'aria-pressed': state.tables[id] ? 'true' : 'false',
    text: state.tables[id] ? 'Show chart' : 'Show table',
    onclick: () => { state.tables[id] = !state.tables[id]; render(); },
  });
  const card = h('section', { class: 'chart-card', 'aria-labelledby': `chart-${id}` },
    h('header', { class: 'chart-head' }, h('div', {}, h('h2', { id: `chart-${id}`, text: title }), h('p', { class: 'chart-note', text: note })), toggle),
    body);
  return { id, card, body };
}

function drawOrTable(c, draw, headers, rows) {
  if (state.tables[c.id]) {
    clear(c.body).append(rows.length ? dataTable(headers, rows, c.id) : h('p', { class: 'empty-note', text: 'No data in this view.' }));
  } else addChartJob(c.body, draw);
}

function meterTile(label, value) {
  const b = band(value);
  return h(
    'div',
    { class: 'tile tile-meter' },
    h('span', { class: 'tile-label', text: label }),
    h('span', { class: 'tile-value' }, String(value), h('span', { class: 'tile-unit', text: '/100' })),
    h('span', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value, 'aria-label': `${label}: ${value} out of 100` }, h('span', { class: 'meter-fill', style: { width: `${value}%` } })),
    h('span', { class: 'tile-sub' }, statusIcon(b.status, 14), ` ${b.label}`)
  );
}

function statTile(label, value, sub) {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-label', text: label }), h('span', { class: 'tile-value', text: value }), sub ? h('span', { class: 'tile-sub', text: sub }) : null);
}

function setFilter(key, value) {
  state.filters[key] = value;
  render();
}

function filterRow(videos) {
  const f = state.filters;
  const issues = topIssues(videos, state.analysis);
  const seg = (value, label) =>
    h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': f.type === value ? 'true' : 'false', onclick: () => setFilter('type', value), text: label });
  const statuses = ['Public', 'Scheduled', 'Premiere', 'Unlisted', 'Private', 'Live'].filter((x) => videos.some((v) => v.status === x));
  const select = (key, label, options) =>
    h('label', { class: 'field-inline' }, h('span', { class: 'sr-only', text: label }),
      h('select', { onchange: (e) => setFilter(key, e.target.value), 'aria-label': label },
        options.map(([val, text]) => h('option', { value: val, selected: f[key] === val ? 'selected' : null, text }))));
  const search = h('input', { type: 'search', placeholder: 'Search titles, tags…', value: f.q, 'aria-label': 'Search videos' });
  search.addEventListener('input', debounce((e) => {
    state.filters.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const again = $('.filters input[type=search]');
    again?.focus();
    again?.setSelectionRange(pos, pos);
  }, 250));
  const chips = [];
  if (f.bin) chips.push(h('button', { type: 'button', class: 'chip-x', onclick: () => setFilter('bin', null), 'aria-label': `Remove filter score ${f.bin}` }, `Score ${f.bin}`, h('span', { 'aria-hidden': 'true', text: ' ×' })));
  const active = f.type !== 'all' || f.status !== 'all' || f.band !== 'all' || f.issue !== 'all' || f.bin || f.q;
  return h(
    'div',
    { class: 'filters', role: 'group', 'aria-label': 'Filter videos' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Video type' }, seg('all', 'All'), seg('short', 'Shorts'), seg('long', 'Long videos')),
    select('status', 'Status', [['all', 'Any status'], ...statuses.map((x) => [x, x])]),
    select('band', 'Score', [['all', 'Any score'], ['poor', 'Needs work (under 60)'], ['okay', 'Okay (60–79)'], ['great', 'Great (80+)']]),
    select('issue', 'Issue', [['all', 'Any issue'], ...issues.map((i) => [i.id, `${i.issue} (${i.videos})`])]),
    search,
    ...chips,
    active ? h('button', { type: 'button', class: 'link-btn', onclick: () => { state.filters = { type: 'all', status: 'all', band: 'all', issue: 'all', bin: null, q: '' }; render(); }, text: 'Clear filters' }) : null,
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn btn-small', onclick: exportCSV, text: 'Export CSV' })
  );
}

function sortHead(key, label, cls = '') {
  const active = state.sort.key === key;
  const dir = active ? state.sort.dir : null;
  return h('th', { scope: 'col', class: cls, 'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' },
    h('button', {
      type: 'button', class: 'sort-btn',
      onclick: () => { state.sort = { key, dir: active && dir === 'asc' ? 'desc' : 'asc' }; render(); },
    }, label, h('span', { class: 'sort-mark', 'aria-hidden': 'true', text: active ? (dir === 'asc' ? ' ↑' : ' ↓') : '' })));
}

function videoTable(list) {
  const wrap = h('section', { class: 'table-wrap', 'aria-labelledby': 'tbl-title' });
  wrap.append(h('div', { class: 'table-head' }, h('h2', { id: 'tbl-title', class: 'section-title', text: `Videos (${list.length})` }), h('p', { class: 'chart-note', text: 'Sorted worst first. Click a video for the full check and copy-ready fixes.' })));
  if (!list.length) {
    wrap.append(h('p', { class: 'empty-note', text: 'No videos match these filters.' }));
    return wrap;
  }
  const tbody = h('tbody');
  for (const v of list) {
    const a = state.analysis.get(v.id);
    const b = band(a.score);
    const n = glen(v.title);
    const max = v.isShort ? 60 : 70;
    tbody.append(
      h('tr', { class: state.drawerId === v.id ? 'is-open' : '' },
        h('td', { class: 'c-video' },
          h('button', { type: 'button', class: 'row-open', onclick: (e) => openDrawer(v.id, e.currentTarget), 'aria-label': `Open checks for ${v.title}` },
            h('span', { class: `thumb${v.isShort ? ' thumb-short' : ''}` }, v.thumbSmall ? h('img', { src: v.thumbSmall, alt: '', loading: 'lazy', width: 112, height: 63, referrerpolicy: 'no-referrer' }) : null),
            h('span', { class: 'row-text' },
              h('span', { class: 'row-title', text: v.title || '(no title)' }),
              h('span', { class: 'ruler', 'aria-hidden': 'true', style: { '--len': Math.min(n, 100), '--max': max } }, h('span', { class: 'ruler-fill' }), h('span', { class: 'ruler-over' }), h('span', { class: 'ruler-cut' })),
              h('span', { class: 'row-meta', text: `${v.isShort ? 'Short' : 'Video'} · ${fmtDuration(v.durationSec)} · ${n} chars` })))),
        h('td', { class: 'c-status' }, h('span', { class: 'status-text', text: v.status }), h('span', { class: 'row-meta', text: whenText(v) })),
        h('td', { class: 'c-score num' }, h('span', { class: 'score' }, statusIcon(b.status, 14), h('strong', { text: a.score })), h('span', { class: 'row-meta', text: b.label })),
        h('td', { class: 'c-fix' },
          a.fails ? h('span', { class: 'fixcount' }, statusIcon('fail', 13), ` ${a.fails} fix`) : null,
          a.warns ? h('span', { class: 'fixcount' }, statusIcon('warn', 13), ` ${a.warns} improve`) : null,
          !a.fails && !a.warns ? h('span', { class: 'fixcount' }, statusIcon('pass', 13), ' All good') : null),
        h('td', { class: 'c-views num', text: v.views == null ? '—' : full(v.views) }),
        h('td', { class: 'c-likes num', text: v.views && v.likes != null ? pct(v.likes / v.views) : '—' }))
    );
  }
  wrap.append(
    h('div', { class: 'table-scroll' },
      h('table', { class: 'vtable' },
        h('caption', { class: 'sr-only', text: 'Videos with their SEO score' }),
        h('thead', {}, h('tr', {}, sortHead('title', 'Video'), sortHead('date', 'Status'), sortHead('score', 'Score', 'num'), sortHead('fixes', 'Fixes'), sortHead('views', 'Views', 'num'), h('th', { scope: 'col', class: 'num', text: 'Like rate' }))),
        tbody))
  );
  return wrap;
}

function whenText(v) {
  if (v.status === 'Scheduled') return fmtDateTime(v.publishAt);
  if (v.status === 'Premiere' && v.premiereAt) return fmtDateTime(v.premiereAt);
  return fmtDate(v.publishedAt);
}

// ---------- Drawer ----------
function openDrawer(id, opener) {
  state.lastFocus = opener || document.activeElement;
  state.drawerId = id;
  renderDrawer();
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  document.body.classList.add('drawer-open');
  $('#drawer-close').focus();
  $$('.vtable tr').forEach((tr) => tr.classList.remove('is-open'));
}

function closeDrawer() {
  state.drawerId = null;
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  document.body.classList.remove('drawer-open');
  hideTip();
  if (state.lastFocus && document.body.contains(state.lastFocus)) state.lastFocus.focus();
}

function trapFocus(e) {
  const nodes = $$('#drawer button, #drawer a[href], #drawer [tabindex="0"], #drawer summary').filter((n) => !n.closest('[hidden]'));
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function highlight(text, phrases) {
  const frag = document.createDocumentFragment();
  const list = phrases.map((p) => p.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length || !text) {
    frag.append(text || '');
    return frag;
  }
  const re = new RegExp(list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('mark', { text: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function titleProof(v, phrases) {
  const n = glen(v.title);
  const max = v.isShort ? 60 : 70;
  const row = (label, limit) => {
    const cut = n > limit;
    return h('div', { class: 'proof-row' },
      h('span', { class: 'proof-label', text: label }),
      h('span', { class: 'proof-text' }, highlight(cut ? gslice(v.title, limit) : v.title, phrases), cut ? h('span', { class: 'proof-cut', text: '…' }) : null));
  };
  return h('div', { class: 'proof' },
    row('Phone search (≈40 chars)', 40),
    row(`Desktop (≈${max} chars)`, max),
    h('div', { class: 'proof-ruler', style: { '--len': Math.min(n, 100), '--max': max } },
      h('span', { class: 'ruler-fill' }), h('span', { class: 'ruler-over' }), h('span', { class: 'ruler-cut' }),
      h('span', { class: 'proof-count', text: `${n} / 100 characters` })));
}

function checkRow(r) {
  return h('li', { class: `check check-${r.status}` },
    statusIcon(r.status, 16),
    h('div', { class: 'check-text' },
      h('span', { class: 'check-msg' }, h('span', { class: 'sr-only', text: `${STATUS_WORD[r.status] || ''}: ` }), r.msg),
      r.fix ? h('span', { class: 'check-fix', text: r.fix }) : null));
}

function copyBlock(label, text, note) {
  const pre = h('pre', { class: 'copy-text', tabindex: 0 }, text);
  return h('div', { class: 'copy-block' },
    h('div', { class: 'copy-head' }, h('h4', { text: label }),
      h('button', { type: 'button', class: 'btn btn-small', onclick: async (e) => { const ok = await copyText(text); e.currentTarget.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => (e.target.textContent = 'Copy'), 1600); }, text: 'Copy' })),
    note ? h('p', { class: 'chart-note', text: note }) : null,
    pre);
}

function renderDrawer() {
  const v = state.data.videos.find((x) => x.id === state.drawerId);
  const body = clear($('#drawer-body'));
  if (!v) return;
  const a = state.analysis.get(v.id);
  const b = band(a.score);
  const settings = activeSettings();
  const phrases = [...(settings.keywords || []), ...(settings.brands || [])];
  $('#drawer-title').textContent = v.title || '(no title)';
  const isDemo = !!v.demo;

  body.append(
    h('div', { class: 'd-meta' },
      h('span', { text: `${v.status} · ${whenText(v)}` }),
      h('span', { text: `${v.isShort ? 'Short' : 'Long video'} · ${fmtDuration(v.durationSec)}` }),
      v.categoryName ? h('span', { text: v.categoryName }) : null,
      v.madeForKids != null ? h('span', { text: `Made for kids: ${v.madeForKids ? 'yes' : 'no'}` }) : null),
    h('div', { class: 'd-links' },
      isDemo ? h('span', { class: 'fine', text: 'Demo video — links are off' }) : [
        h('a', { class: 'btn btn-small btn-primary', href: `https://studio.youtube.com/video/${v.id}/edit`, target: '_blank', rel: 'noopener', text: 'Edit in YouTube Studio' }),
        h('a', { class: 'btn btn-small', href: `https://www.youtube.com/watch?v=${v.id}`, target: '_blank', rel: 'noopener', text: 'Watch' }),
      ]),
    h('div', { class: 'd-score' },
      h('div', {}, h('span', { class: 'd-score-num', text: a.score }), h('span', { class: 'tile-unit', text: '/100' })),
      h('div', { class: 'd-score-side' },
        h('span', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': a.score, 'aria-label': `SEO score ${a.score} out of 100` }, h('span', { class: 'meter-fill', style: { width: `${a.score}%` } })),
        h('span', { class: 'tile-sub' }, statusIcon(b.status, 14), ` ${b.label} · ${a.fails} to fix · ${a.warns} to improve`))),
    v.thumb ? h('figure', { class: `d-thumb${v.isShort ? ' d-thumb-short' : ''}` }, h('img', { src: v.thumb, alt: `Thumbnail of ${v.title}`, loading: 'lazy', referrerpolicy: 'no-referrer' })) : null
  );

  body.append(h('section', { class: 'd-sec' }, h('h3', { text: 'Title' }), titleProof(v, phrases)));

  const desc = v.description.trim();
  const first = gslice(desc, 150);
  const rest = desc.slice(first.length);
  const ch = parseChapters(v.description);
  const tags = [...new Set([...hashtags(v.title), ...hashtags(v.description)])];
  body.append(
    h('section', { class: 'd-sec' },
      h('h3', { text: 'Description' }),
      desc
        ? h('div', { class: 'desc-proof' },
            h('p', { class: 'desc-first' }, h('span', { class: 'proof-label', text: 'Seen before “more” (first 150 characters)' }), h('span', { class: 'desc-text' }, highlight(first, phrases))),
            rest ? h('details', { class: 'desc-rest' }, h('summary', { text: `Show the rest (${glen(rest)} more characters)` }), h('p', { class: 'desc-text' }, highlight(rest, phrases))) : null)
        : h('p', { class: 'empty-note', text: 'This video has no description.' }),
      ch.items.length ? h('p', { class: 'chart-note', text: `Timestamps found: ${ch.items.map((c) => c.stamp).join(', ')}` }) : null,
      tags.length ? h('div', { class: 'chips', 'aria-label': 'Hashtags' }, tags.map((t) => h('span', { class: 'chip', text: `#${t}` }))) : null)
  );

  body.append(
    h('section', { class: 'd-sec' },
      h('h3', { text: `Tags (${v.tags.length})` }),
      v.tags.length ? h('div', { class: 'chips' }, v.tags.map((t) => h('span', { class: 'chip', text: t }))) : h('p', { class: 'empty-note', text: 'No tags.' }),
      h('p', { class: 'chart-note', text: `${tagChars(v.tags)} of 500 characters used` }))
  );

  const groups = [...new Set(VIDEO_RULES.map((r) => r.group))];
  const order = { fail: 0, warn: 1, unknown: 2, pass: 3, info: 4 };
  const checks = h('section', { class: 'd-sec' }, h('h3', { text: 'All checks' }));
  for (const g of groups) {
    const rows = a.results.filter((r) => r.group === g).sort((x, y) => order[x.status] - order[y.status]);
    if (!rows.length) continue;
    checks.append(h('h4', { class: 'check-group', text: g }), h('ul', { class: 'checklist' }, rows.map(checkRow)));
  }
  body.append(checks);

  const fixes = h('section', { class: 'd-sec' }, h('h3', { text: 'Copy-ready fixes' }));
  const ht = suggestHashtags(v, settings);
  if (ht.length) fixes.append(copyBlock('Hashtags', ht.join(' '), 'Paste at the end of the description. The first 3 show above the title.'));
  const st = suggestTags(v, settings);
  if (st.length) fixes.append(copyBlock('Tags', st.join(', '), `${tagChars(st)} of 500 characters. Paste into Studio → Tags.`));
  if (!v.isShort && v.durationSec >= 180 && !ch.valid) fixes.append(copyBlock('Chapter template', chapterTemplate(v), 'Replace … with the real scene names, then paste into the description.'));
  fixes.append(copyBlock('Prompt for Claude', claudePrompt(v, a, settings, state.data.channel.title), 'Paste into Claude to get new titles, description lines and tags written for this video.'));
  body.append(fixes);
}

// ---------- Keywords view ----------
function renderKeywords(view) {
  chartJobs.length = 0;
  view.append(h('section', { class: 'page-head' }, h('h1', { class: 'page-title', text: 'Keywords' }), h('p', { class: 'hero-sub', text: 'Check how often your target keywords appear, find the words you lean on, and get new ideas from YouTube search.' })));
  const settings = activeSettings();
  const kws = settings.keywords || [];
  const editor = keywordEditor();

  if (!state.data) {
    view.append(editor, ideasPanel());
    return;
  }
  const videos = state.data.videos;
  const cov = h('section', { class: 'panel' }, h('h2', { class: 'section-title', text: 'Target keyword coverage' }));
  if (!kws.length) {
    cov.append(h('p', { class: 'empty-note', text: 'Add your target keywords below to see where they are used.' }));
  } else {
    const rows = kws.map((k) => {
      const inTitle = videos.filter((v) => firstHit(v.title, [k])).length;
      const inFirst = videos.filter((v) => firstHit(gslice(v.description.trim(), 150), [k])).length;
      const inTags = videos.filter((v) => firstHit(v.tags.join(' | '), [k])).length;
      const any = videos.filter((v) => firstHit(`${v.title} ${v.description} ${v.tags.join(' | ')}`, [k])).length;
      return { k, inTitle, inFirst, inTags, any };
    });
    const list = h('ul', { class: 'meter-list' });
    rows.forEach((r) => {
      const share = videos.length ? r.any / videos.length : 0;
      list.append(h('li', {},
        h('span', { class: 'ml-name', text: r.k }),
        h('span', { class: 'ml-bar', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': videos.length, 'aria-valuenow': r.any, 'aria-label': `${r.k}: used in ${r.any} of ${videos.length} videos` }, h('span', { class: 'meter-fill', style: { width: `${share * 100}%` } })),
        h('span', { class: 'ml-fig', text: `${r.any} of ${videos.length}` }),
        h('span', { class: 'ml-detail', text: `Title ${r.inTitle} · First 2 lines ${r.inFirst} · Tags ${r.inTags}` })));
    });
    cov.append(list);
  }

  const freq = new Map();
  for (const v of videos) {
    const seen = new Set([...words(v.title), ...v.tags.flatMap((t) => words(t))]);
    for (const w of seen) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const wordsCard = chartCard('words', 'Words you use most', 'Number of videos whose title or tags use the word.');
  drawOrTable(wordsCard, () => rankedBars(wordsCard.body, topWords.map(([w, n]) => ({ key: w, label: w, value: n })), { total: videos.length, onSelect: (w) => { state.filters.q = w; go('videos'); } }),
    ['Word', 'Videos'], topWords.map(([w, n]) => [w, n]));

  view.append(cov, editor, h('div', { class: 'viz-grid two' }, wordsCard.card, ideasPanel()));
}

function keywordEditor() {
  const s = state.settings;
  const demo = state.data?.mode === 'demo';
  const kw = h('textarea', { id: 'kw-input', rows: 3, placeholder: 'hindi cartoon, rasoi ki jung, 3d animation', 'aria-describedby': 'kw-help' }, (demo ? state.data.demoSettings.keywords : s.keywords).join(', '));
  const br = h('input', { id: 'brand-input', type: 'text', placeholder: 'TadakBoom, Rasoi Ki Jung', value: (demo ? state.data.demoSettings.brands : s.brands).join(', ') });
  const save = () => {
    const keywords = splitList(kw.value);
    const brands = splitList(br.value);
    if (demo) state.data.demoSettings = { keywords, brands };
    else saveSettings({ keywords, brands });
    recompute();
    toast('Keywords saved. Scores updated.');
    render();
  };
  return h('section', { class: 'panel' },
    h('h2', { class: 'section-title', text: 'Your keywords' }),
    h('div', { class: 'field' }, h('label', { for: 'kw-input', text: 'Target keywords' }), kw, h('p', { id: 'kw-help', class: 'help', text: 'The words people type to find videos like yours. Comma or new line between each.' })),
    h('div', { class: 'field' }, h('label', { for: 'brand-input', text: 'Brand and series names' }), br),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: save, text: 'Save keywords' }),
    demo ? h('p', { class: 'fine', text: 'Demo mode: these keywords are only for the demo channel.' }) : null);
}

function ideasPanel() {
  const input = h('input', { type: 'text', id: 'idea-seed', placeholder: 'hindi cartoon', value: activeSettings().keywords?.[0] || '' });
  const lang = h('select', { id: 'idea-lang', 'aria-label': 'Language' }, h('option', { value: 'hi', text: 'Hindi' }), h('option', { value: 'en', text: 'English' }));
  const out = h('div', { class: 'ideas', 'aria-live': 'polite' });
  const run = async () => {
    const seed = input.value.trim();
    if (!seed) return;
    clear(out).append(h('p', { class: 'chart-note', text: 'Asking YouTube search…' }));
    try {
      const list = await keywordIdeas(seed, { hl: lang.value, gl: state.settings.region || 'IN' });
      clear(out);
      if (!list.length) return out.append(h('p', { class: 'empty-note', text: 'No suggestions for that. Try a shorter phrase.' }));
      out.append(h('ul', { class: 'idea-list' }, list.map((x) => h('li', {}, h('span', { text: x }),
        h('button', { type: 'button', class: 'link-btn', onclick: () => addKeyword(x), text: 'Add as target' })))));
    } catch (err) {
      clear(out).append(h('p', { class: 'empty-note', text: err.message }));
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  return h('section', { class: 'panel' },
    h('h2', { class: 'section-title', text: 'Keyword ideas' }),
    h('p', { class: 'chart-note', text: 'What people type into YouTube search, starting with your words.' }),
    h('div', { class: 'row' }, h('label', { for: 'idea-seed', class: 'sr-only', text: 'Starting words' }), input, lang, h('button', { type: 'button', class: 'btn', onclick: run, text: 'Get ideas' })),
    out);
}

function addKeyword(k) {
  if (state.data?.mode === 'demo') {
    const s = state.data.demoSettings;
    if (!s.keywords.includes(k)) s.keywords.push(k);
  } else if (!state.settings.keywords.includes(k)) saveSettings({ keywords: [...state.settings.keywords, k] });
  recompute();
  toast(`Added "${k}" to your target keywords.`);
  render();
}

function splitList(text) {
  return [...new Set(text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
}

// ---------- Channel view ----------
function renderChannel(view) {
  chartJobs.length = 0;
  if (!state.data) {
    view.append(h('section', { class: 'page-head' }, h('h1', { class: 'page-title', text: 'Channel' }), h('p', { class: 'hero-sub', text: 'Analyse your channel first to see channel-level checks.' }), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('settings'), text: 'Connect your channel' })));
    return;
  }
  const c = state.data.channel;
  const rep = state.channelReport;
  view.append(
    h('section', { class: 'page-head ch-head' },
      c.avatar ? h('img', { class: 'ch-avatar', src: c.avatar, alt: '', width: 72, height: 72, referrerpolicy: 'no-referrer' }) : null,
      h('div', {},
        h('h1', { class: 'page-title', text: c.title }),
        h('p', { class: 'hero-sub', text: `${c.handle || ''}${c.publishedAt ? ` · Joined ${fmtDate(c.publishedAt)}` : ''}` }),
        h('div', { class: 'kpis small' },
          statTile('Subscribers', c.subscribers == null ? 'Hidden' : full(c.subscribers)),
          statTile('Views', full(c.views)),
          statTile('Videos', full(c.videoCount)),
          meterTile('Average video score', rep.avg))))
  );
  view.append(h('section', { class: 'panel' }, h('h2', { class: 'section-title', text: 'Channel checks' }),
    h('ul', { class: 'checklist' }, rep.checks.map((r) => checkRow({ status: r.status, msg: `${r.label}: ${r.msg}`, fix: r.fix })))));

  const histCard = chartCard('hist', 'Average score over time', 'One point each day you press Analyze.');
  if (state.history.length < 2) clear(histCard.body).append(h('p', { class: 'empty-note', text: 'Analyse again on another day to start your trend line.' }));
  else drawOrTable(histCard, () => lineChart(histCard.body, state.history.map((x) => ({ date: x.date, value: x.avg })), { label: 'Average score' }),
    ['Date', 'Average score', 'Videos', 'Subscribers'], state.history.map((x) => [fmtDate(x.date), x.avg, x.videos, x.subs == null ? '—' : full(x.subs)]));

  const pl = h('section', { class: 'panel' }, h('h2', { class: 'section-title', text: 'Playlists' }));
  if (!c.playlists) pl.append(h('p', { class: 'empty-note', text: 'Playlists could not be read.' }));
  else if (!c.playlists.length) pl.append(h('p', { class: 'empty-note', text: 'No playlists yet. Make one for episodes and one for Shorts.' }));
  else pl.append(h('ul', { class: 'plain-list' }, c.playlists.map((p) => h('li', {}, h('span', { text: p.title }), h('span', { class: 'row-meta', text: `${p.count} video${p.count === 1 ? '' : 's'}` })))));
  view.append(h('div', { class: 'viz-grid two' }, histCard.card, pl));
}

// ---------- Settings view ----------
function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  store.set(KEY.settings, state.settings);
}

function renderSettings(view) {
  chartJobs.length = 0;
  const s = state.settings;
  const keyInput = h('input', { id: 'api-key', type: 'password', autocomplete: 'off', spellcheck: 'false', value: s.apiKey, placeholder: 'AIza…', 'aria-describedby': 'key-help' });
  const showKey = h('button', { type: 'button', class: 'link-btn', 'aria-controls': 'api-key', onclick: (e) => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; e.currentTarget.textContent = keyInput.type === 'password' ? 'Show' : 'Hide'; }, text: 'Show' });
  const chInput = h('input', { id: 'channel-input', type: 'text', value: s.channel, placeholder: '@TadakBoom', autocomplete: 'off' });
  const clientInput = h('input', { id: 'client-id', type: 'text', value: s.clientId, placeholder: '1234-abc.apps.googleusercontent.com', autocomplete: 'off', spellcheck: 'false' });
  const maxSel = h('select', { id: 'max-videos' }, [50, 100, 200, 500].map((n) => h('option', { value: n, selected: Number(s.maxVideos) === n ? 'selected' : null, text: `Latest ${n} videos` })));
  const region = h('select', { id: 'region' }, [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['AE', 'UAE']].map(([v, t]) => h('option', { value: v, selected: s.region === v ? 'selected' : null, text: t })));
  const thumbs = h('input', { id: 'check-thumbs', type: 'checkbox', checked: s.checkThumbs });

  const signedIn = tokenValid();
  const save = () => {
    saveSettings({ apiKey: keyInput.value.trim(), channel: chInput.value.trim(), clientId: clientInput.value.trim(), maxVideos: Number(maxSel.value), region: region.value, checkThumbs: thumbs.checked });
    toast('Settings saved.');
    render();
  };
  const doSignIn = async () => {
    saveSettings({ clientId: clientInput.value.trim() });
    try {
      state.token = await signIn(state.settings.clientId);
      toast('Signed in. Press Analyze channel to include scheduled and private videos.');
    } catch (err) {
      toast(err.message, 'error');
    }
    render();
  };
  const doSignOut = () => {
    if (state.token) signOut(state.token.token);
    state.token = null;
    toast('Signed out of Google.');
    render();
  };

  view.append(
    h('section', { class: 'page-head' }, h('h1', { class: 'page-title', text: 'Settings' }), h('p', { class: 'hero-sub', text: 'Everything here is saved in this browser only.' })),
    h('form', { class: 'settings', onsubmit: (e) => { e.preventDefault(); save(); } },
      h('fieldset', { class: 'panel' },
        h('legend', { class: 'section-title', text: '1. Your channel' }),
        h('div', { class: 'field' }, h('label', { for: 'channel-input', text: 'Channel handle, link or ID' }), chInput, h('p', { class: 'help', text: 'For example @TadakBoom. Leave empty if you sign in with Google below.' }))),
      h('fieldset', { class: 'panel' },
        h('legend', { class: 'section-title', text: '2. YouTube API key (public videos)' }),
        h('div', { class: 'field' }, h('label', { for: 'api-key', text: 'API key' }), h('div', { class: 'row' }, keyInput, showKey),
          h('p', { id: 'key-help', class: 'help', text: 'Free from Google Cloud. Reads public videos, stats and tags. See the setup steps below.' }))),
      h('fieldset', { class: 'panel' },
        h('legend', { class: 'section-title', text: '3. Google sign-in (optional: scheduled and private videos)' }),
        h('div', { class: 'field' }, h('label', { for: 'client-id', text: 'OAuth Client ID' }), clientInput,
          h('p', { class: 'help', text: `Read-only access. Add ${location.origin} as an authorised JavaScript origin. The sign-in lasts one hour and is never saved.` })),
        h('div', { class: 'row' },
          signedIn
            ? [h('span', { class: 'signed', text: 'Signed in with Google (read-only)' }), h('button', { type: 'button', class: 'btn', onclick: doSignOut, text: 'Sign out' })]
            : h('button', { type: 'button', class: 'btn', onclick: doSignIn, text: 'Sign in with Google' }))),
      h('fieldset', { class: 'panel' },
        h('legend', { class: 'section-title', text: '4. Options' }),
        h('div', { class: 'field-grid' },
          h('div', { class: 'field' }, h('label', { for: 'max-videos', text: 'Videos to check' }), maxSel),
          h('div', { class: 'field' }, h('label', { for: 'region', text: 'Country (for categories and keyword ideas)' }), region)),
        h('label', { class: 'check-field', for: 'check-thumbs' }, thumbs, h('span', { text: 'Check for custom thumbnails (public videos)' }))),
      h('div', { class: 'row form-actions' },
        h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save settings' }),
        h('button', { type: 'button', class: 'btn', onclick: () => { save(); analyze(); }, text: 'Save and analyze' }))),
    keywordEditor(),
    setupGuide(!s.apiKey),
    h('section', { class: 'panel' },
      h('h2', { class: 'section-title', text: 'Your data' }),
      h('p', { class: 'chart-note', text: 'Saved analyses and score history live in this browser.' }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', disabled: !state.data, onclick: exportJSON, text: 'Download last analysis (JSON)' }),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: clearData, text: 'Remove saved data' })))
  );
}

function setupGuide(open) {
  const origin = location.origin;
  const step = (title, ...lines) => h('li', {}, h('strong', { text: title }), ...lines.map((l) => h('span', { class: 'help', text: l })));
  return h('details', { class: 'panel guide', open: open ? 'open' : null },
    h('summary', { class: 'section-title', text: 'Setup steps (about 5 minutes, one time)' }),
    h('ol', { class: 'steps' },
      step('Open Google Cloud Console', 'Go to console.cloud.google.com and sign in with the Google account of your channel.'),
      step('Create a project', 'Top bar → project picker → New project → name it "YouTube SEO" → Create.'),
      step('Turn on the YouTube API', 'APIs & Services → Library → search "YouTube Data API v3" → Enable.'),
      step('Create an API key', 'APIs & Services → Credentials → Create credentials → API key. Copy it.'),
      step('Lock the key to this site', `Edit the key → Application restrictions → Websites → add ${origin}/* . API restrictions → YouTube Data API v3. Save.`),
      step('Paste it here', 'Paste the key in "YouTube API key" above, add your channel handle, then press Save and analyze.'),
      step('Optional: see scheduled and private videos', `OAuth consent screen → External → add your own email as a test user. Then Credentials → Create credentials → OAuth client ID → Web application → Authorised JavaScript origins: ${origin}. Paste the Client ID above and press Sign in with Google.`)),
    h('p', { class: 'fine', text: 'Free quota is 10,000 units a day. One full check of a 200-video channel uses about 10–20 units.' }));
}

// ---------- Export / clear ----------
function exportCSV() {
  if (!state.data) return;
  const list = sortVideos(filteredVideos());
  const head = ['video_id', 'title', 'type', 'status', 'publish_date', 'seo_score', 'band', 'to_fix', 'to_improve', 'top_issues', 'views', 'likes', 'comments', 'like_rate', 'tags', 'url'];
  const lines = [head.join(',')];
  for (const v of list) {
    const a = state.analysis.get(v.id);
    const issues = a.results.filter((r) => r.status === 'fail' || r.status === 'warn').map((r) => r.msg).join(' | ');
    lines.push([v.id, v.title, v.isShort ? 'Short' : 'Video', v.status, (v.publishAt || v.publishedAt || '').slice(0, 10), a.score, band(a.score).label, a.fails, a.warns, issues,
      v.views ?? '', v.likes ?? '', v.comments ?? '', v.views && v.likes != null ? (v.likes / v.views).toFixed(4) : '', v.tags.join('; '), `https://youtu.be/${v.id}`].map(csvCell).join(','));
  }
  const name = (state.data.channel.handle || state.data.channel.title || 'channel').replace(/[^\w-]+/g, '');
  download(`youtube-seo-${name}-${todayKey()}.csv`, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8');
}

function exportJSON() {
  if (!state.data) return;
  const out = { ...state.data, analysis: Object.fromEntries([...state.analysis.entries()].map(([id, a]) => [id, { score: a.score, results: a.results }])) };
  download(`youtube-seo-${todayKey()}.json`, JSON.stringify(out, null, 2), 'application/json');
}

function clearData() {
  if (!window.confirm('Remove saved analyses, history and settings (including your API key) from this browser?')) return;
  store.keys('ytseo.').forEach((k) => store.del(k));
  state.settings = { ...DEFAULTS };
  state.data = null;
  state.history = [];
  state.token = null;
  toast('Saved data removed from this browser.');
  go('videos');
  render();
}

init();
