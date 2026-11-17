// A made-up channel so the dashboard can be explored without an API key.

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const ahead = (d) => new Date(Date.now() + d * DAY).toISOString();

const SHADES = ['#2d3a8c', '#7a2e3b', '#1f5f4a', '#6b4a12', '#3d2a6e', '#14506b', '#5c3b1e', '#26413c'];

function thumb(label, i, vertical) {
  const [w, hgt] = vertical ? [360, 640] : [640, 360];
  const bg = SHADES[i % SHADES.length];
  const words = label.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 3).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">
<rect width="100%" height="100%" fill="${bg}"/>
<circle cx="${w * 0.78}" cy="${hgt * 0.42}" r="${Math.min(w, hgt) * 0.28}" fill="#ffffff" fill-opacity="0.12"/>
<rect x="${w * 0.06}" y="${hgt * 0.62}" width="${w * 0.7}" height="${hgt * 0.2}" rx="10" fill="#ffd84d"/>
<text x="${w * 0.09}" y="${hgt * 0.76}" font-family="Arial, sans-serif" font-weight="700" font-size="${vertical ? 30 : 38}" fill="#1b1b1b">${words}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const FOOTER = `\n\n▶ Subscribe: https://www.youtube.com/@toofantoons-demo?sub_confirmation=1\n▶ All episodes: https://www.youtube.com/playlist?list=PLdemoEpisodes\n\n#ToofanToons #MasalaMission #HindiCartoon`;

const RAW = [
  {
    id: 'demo01', title: 'Masala Mission Episode 1: Chai Ki Chori | Hindi Cartoon | Toofan Toons', long: true, dur: 'PT9M12S',
    desc: `Hindi cartoon Masala Mission Episode 1 – Chai Ki Chori! Rasoi Nagar ki sabse keemti chai patti gayab ho gayi hai, aur Chotu Cooker ko chor dhoondhna hai.\n\nIs 3D cartoon kahani mein milo Tawa Rani, Mixie Monster aur Dahi Dadi se. Bachchon aur poori family ke liye mazedaar Hindi kahani.\n\nChapters:\n0:00 Rasoi Nagar ki subah\n1:10 Chai patti gayab!\n3:05 Mixie Monster ka plan\n5:40 Badi ladai\n8:20 Agla episode${FOOTER}`,
    tags: ['toofan toons', 'masala mission', 'hindi cartoon', '3d cartoon', 'cartoon kahani', 'hindi kahani', 'kids cartoon hindi', 'chai ki chori', 'rasoi nagar', 'chotu cooker', 'tawa rani', 'mixie monster', 'animated series hindi', 'family cartoon'],
    caption: true, loc: ['en'], thumbCustom: true, status: 'Public', when: ago(40), views: 18400, likes: 820, comments: 96, pl: ['Episodes'],
  },
  {
    id: 'demo02', title: 'Masala Mission Episode 2 – Pressure Cooker Ka Badla | Hindi 3D Cartoon', long: true, dur: 'PT8M47S',
    desc: `Masala Mission ka doosra episode! Pressure Cooker apna badla lene aaya hai.\n\n0:05 Intro\n1:20 Cooker ki seeti\n4:10 Badla shuru\n7:30 Ant${FOOTER}`,
    tags: ['masala mission', 'hindi cartoon', '3d cartoon', 'pressure cooker', 'toofan toons', 'cartoon video'],
    caption: true, loc: [], thumbCustom: true, status: 'Public', when: ago(33), views: 9200, likes: 300, comments: 21, pl: ['Episodes'],
  },
  {
    id: 'demo03', title: 'MASALA MISSION EPISODE 3 MIXIE KA TOOFAN!!! 😱😱🔥🔥', long: true, dur: 'PT7M58S',
    desc: 'Dekho kya hua!!! Like share subscribe.',
    tags: [], caption: false, loc: [], thumbCustom: true, status: 'Public', when: ago(26), views: 2100, likes: 30, comments: 1, pl: ['Episodes'],
  },
  {
    id: 'demo04', title: 'Meet the Masala Team – All Characters Explained | Toofan Toons', long: true, dur: 'PT3M40S',
    desc: `Masala Mission ke saare characters ek video mein – Hindi cartoon series ki poori team!\n\n0:00 Chotu Cooker\n0:45 Tawa Rani\n1:30 Mixie Monster\n2:15 Dahi Dadi\n3:00 Mirchi Baba${FOOTER}`,
    tags: ['toofan toons', 'masala mission', 'hindi cartoon', 'characters', 'cartoon characters hindi', '3d cartoon', 'chotu cooker', 'tawa rani'],
    caption: false, loc: ['en'], thumbCustom: true, status: 'Public', when: ago(45), views: 5400, likes: 240, comments: 30, pl: ['Episodes'],
  },
  {
    id: 'demo05', title: 'Episode 4', long: true, dur: 'PT9M02S', desc: '', tags: [],
    caption: false, loc: [], thumbCustom: null, status: 'Scheduled', when: ahead(3), views: 0, likes: 0, comments: 0, pl: [],
  },
  {
    id: 'demo06', title: 'Masala Mission Episode 5: Tiffin Ka Raaz | Hindi Cartoon Kahani for Kids and Family Full Episode', long: true, dur: 'PT10M15S',
    desc: `Tiffin ka raaz kya hai? Hindi cartoon Masala Mission ka paanchwa episode, Premiere mein saath dekho!\n\n0:00 Shuruaat\n2:00 Tiffin khula\n5:30 Raaz\n9:00 Twist${FOOTER}`,
    tags: ['masala mission', 'hindi cartoon', 'tiffin ka raaz', 'toofan toons', 'cartoon kahani', '3d cartoon', 'premiere'],
    caption: true, loc: [], thumbCustom: null, status: 'Premiere', when: ahead(6), views: 0, likes: 0, comments: 0, pl: ['Episodes'],
  },
  {
    id: 'demo07', title: 'Chotu Cooker ka Jugaad 🍳 | Hindi Cartoon Short', long: false, dur: 'PT34S',
    desc: `Hindi cartoon short: Chotu Cooker ka naya jugaad! Poora episode dekho Masala Mission playlist mein.\n\n#ToofanToons #HindiCartoon #Shorts`,
    tags: ['toofan toons', 'hindi cartoon', 'cartoon shorts', 'chotu cooker', 'masala mission', 'funny cartoon hindi'],
    caption: false, loc: [], thumbCustom: true, status: 'Public', when: ago(20), views: 32000, likes: 1500, comments: 80, pl: ['Shorts'],
  },
  {
    id: 'demo08', title: 'Tawa Rani vs Mixie Monster 💥 | Masala Mission', long: false, dur: 'PT41S',
    desc: 'Tawa Rani ka disc attack! Masala Mission 3D cartoon se ek scene.\n\n#MasalaMission #HindiCartoon',
    tags: ['masala mission', 'tawa rani', 'mixie monster', '3d cartoon'],
    caption: false, loc: [], thumbCustom: true, status: 'Public', when: ago(17), views: 12000, likes: 300, comments: 12, pl: ['Shorts'],
  },
  {
    id: 'demo09', title: 'Mirchi Baba ka Secret 🌶️', long: false, dur: 'PT28S',
    desc: 'Mirchi Baba!', tags: [], caption: false, loc: [], thumbCustom: false, status: 'Public', when: ago(14), views: 4300, likes: 80, comments: 2, pl: [],
  },
  {
    id: 'demo10', title: 'Mirchi Baba ka Secret 🌶️', long: false, dur: 'PT31S',
    desc: 'Mirchi Baba ka doosra secret. #Shorts', tags: ['mirchi baba'], caption: false, loc: [], thumbCustom: null, status: 'Scheduled', when: ahead(2), views: 0, likes: 0, comments: 0, pl: [],
  },
  {
    id: 'demo11', title: 'Kitchen Mein Toofan! 3D Hindi Cartoon Short | Toofan Toons', long: false, dur: 'PT45S',
    desc: `Hindi cartoon short – kitchen mein aaya toofan! Masala Mission ki poori kahani channel par.\n\n▶ Subscribe: https://www.youtube.com/@toofantoons-demo?sub_confirmation=1\n\n#ToofanToons #HindiCartoon #3DCartoon`,
    tags: ['toofan toons', 'hindi cartoon', '3d cartoon', 'kitchen cartoon', 'masala mission', 'cartoon shorts hindi', 'funny shorts'],
    caption: true, loc: ['en'], thumbCustom: null, status: 'Scheduled', when: ahead(4), views: 0, likes: 0, comments: 0, pl: ['Shorts'],
  },
  {
    id: 'demo12', title: 'Belan Bhaiya ki Training 💪 | Masala Mission', long: false, dur: 'PT38S',
    desc: 'Belan Bhaiya ki training shuru! #MasalaMission', tags: ['masala mission', 'belan bhaiya', 'cartoon'],
    caption: false, loc: [], thumbCustom: null, status: 'Scheduled', when: ahead(8), views: 0, likes: 0, comments: 0, pl: ['Shorts'],
  },
  {
    id: 'demo13', title: 'Dahi Dadi ke Nuskhe 👵 | Hindi Cartoon', long: false, dur: 'PT52S',
    desc: 'Dahi Dadi ke desi nuskhe – Hindi cartoon short from Masala Mission.\n\n#HindiCartoon #ToofanToons',
    tags: ['toofan toons', 'hindi cartoon', 'dahi dadi', 'nuskhe', 'masala mission', 'cartoon shorts'],
    caption: false, loc: [], thumbCustom: false, status: 'Public', when: ago(9), views: 2800, likes: 140, comments: 9, pl: ['Shorts'],
  },
  {
    id: 'demo14', title: 'Masala Mission Trailer | New Hindi 3D Cartoon Series', long: true, dur: 'PT2M10S',
    desc: `Masala Mission – nayi Hindi 3D cartoon series ka trailer! Har hafte naya episode.${FOOTER}`,
    tags: ['masala mission', 'trailer', 'hindi cartoon', '3d cartoon series', 'toofan toons', 'new cartoon 2026'],
    caption: true, loc: ['en'], thumbCustom: true, status: 'Public', when: ago(50), views: 7600, likes: 260, comments: 18, pl: ['Episodes'],
  },
  {
    id: 'demo15', title: 'Toofan Toons Live Q&A', long: true, dur: 'PT25M00S',
    desc: '', tags: [], caption: false, loc: [], thumbCustom: null, status: 'Private', when: ago(5), views: 0, likes: 0, comments: 0, pl: [],
  },
];

export function demoData() {
  const items = RAW.map((r, i) => {
    const m = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(r.dur);
    const durationSec = Number(m[1] || 0) * 60 + Number(m[2] || 0);
    const vertical = !r.long;
    const future = r.status === 'Scheduled' || r.status === 'Premiere';
    return {
      id: r.id,
      title: r.title,
      description: r.desc,
      tags: r.tags,
      categoryId: '1',
      categoryName: 'Film & Animation',
      publishedAt: future ? ago(1) : r.when,
      publishAt: r.status === 'Scheduled' ? r.when : '',
      premiereAt: r.status === 'Premiere' ? r.when : '',
      status: r.status,
      privacy: r.status === 'Public' || r.status === 'Premiere' ? 'public' : 'private',
      durationSec,
      isShort: vertical && durationSec <= 180,
      vertical,
      definition: 'hd',
      caption: r.caption,
      defaultLanguage: i % 4 === 3 ? '' : 'hi',
      defaultAudioLanguage: 'hi',
      localizations: r.loc,
      madeForKids: false,
      thumb: thumb(r.title, i, vertical),
      thumbSmall: thumb(r.title, i, vertical),
      views: future || r.status === 'Private' ? null : r.views,
      likes: future || r.status === 'Private' ? null : r.likes,
      comments: future || r.status === 'Private' ? null : r.comments,
      playlists: r.pl,
      thumbCustom: r.thumbCustom,
      demo: true,
    };
  });

  const channel = {
    id: 'UCdemo-toofan-toons',
    title: 'Toofan Toons (demo)',
    handle: '@toofantoons-demo',
    description:
      'Toofan Toons par milegi nayi Hindi 3D cartoon series Masala Mission – rasoi ke bartanon ki mazedaar kahaniyan. Har hafte naya episode aur roz Shorts.',
    keywords: 'hindi cartoon "3d animation" kids',
    country: 'IN',
    defaultLanguage: 'hi',
    trailer: '',
    banner: 'demo',
    avatar: thumb('TT', 2, false),
    publishedAt: ago(70),
    subscribers: 4280,
    views: 110400,
    videoCount: items.length,
    uploads: 'UUdemo',
    madeForKids: false,
    playlists: [
      { id: 'PLdemoEpisodes', title: 'Episodes', count: 7 },
      { id: 'PLdemoShorts', title: 'Shorts', count: 5 },
    ],
  };

  const settings = {
    keywords: ['hindi cartoon', 'masala mission', '3d cartoon', 'cartoon kahani'],
    brands: ['Toofan Toons', 'Masala Mission'],
  };

  const day = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
  const history = [
    { date: day(28), avg: 49, videos: 9, views: 41000, subs: 1900 },
    { date: day(21), avg: 54, videos: 11, views: 63000, subs: 2600 },
    { date: day(14), avg: 57, videos: 13, views: 82000, subs: 3300 },
    { date: day(7), avg: 60, videos: 14, views: 97000, subs: 3900 },
  ];

  return { channel, items, settings, history };
}
