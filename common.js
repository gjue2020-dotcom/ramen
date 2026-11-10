/* 라면질문 점프! — 학생·교사 화면이 함께 쓰는 코드 */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("rq_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("rq_" + k, JSON.stringify(v)); } catch (e) {} }
};

const MAXLEN = 100;   // 질문·답 글자 수
const MAXQ = 3;       // 학생 한 명이 낼 수 있는 질문 수
const DEFAULTS = {
  studentCount: 16,
  frames: [
    "만약 너희가 ____라면, ____ 할 거야?",
    "너희들도 ____처럼 ____ 한 적 있어?"
  ],
  examples: [
    "만약 너희가 흥부라면, 놀부를 용서해 줄 거야?",
    "너희들도 토끼처럼 방심하다가 진 적 있어?",
    "만약 너희에게 소원 하나가 생긴다면, 무엇을 빌 거야?"
  ]
};

function pad2(n) { return String(n).padStart(2, "0"); }
function todayStr(d = new Date()) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function dateLabel(ms) {
  const d = new Date(ms);
  const w = "일월화수목금토"[d.getDay()];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${w}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const byAt = arr => arr.sort((a, b) => (a.at || 0) - (b.at || 0));

let toastTimer = null;
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
function errText(e) {
  const c = e && e.code;
  if (c === "permission-denied") return "저장이 막혔어요. Firebase 보안 규칙을 확인해 주세요. (안내서 4단계)";
  if (c === "resource-exhausted") return "오늘 무료 사용량을 넘었어요. 내일 다시 써 주세요.";
  if (c === "unavailable") return "인터넷 연결이 끊겼어요. 연결되면 자동으로 다시 보내요.";
  return "문제가 생겼어요. 인터넷 연결을 확인해 주세요.";
}
function onErr(e) { console.error(e); toast(errText(e)); }

/* ================= 데이터 연결 =================
   config.js가 채워져 있으면 Firebase, 아니면 이 컴퓨터 안에서만 되는 체험 모드 */
function makeDB() {
  const cfg = window.FIREBASE_CONFIG;
  const ok = window.firebase && cfg && cfg.apiKey && !/여기에/.test(JSON.stringify(cfg));
  return ok ? firebaseDB(cfg) : localDB();
}

function firebaseDB(cfg) {
  firebase.initializeApp(cfg);
  const fs = firebase.firestore();
  const list = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const S = sid => fs.collection("sessions").doc(sid);
  return {
    demo: false,
    watchLive: (cb, err = onErr) => fs.doc("live/state").onSnapshot(d => cb(d.exists ? d.data() : null), err),
    setLive: data => fs.doc("live/state").set(data, { merge: true }),
    watchSettings: (cb, err = onErr) => fs.doc("config/settings").onSnapshot(d => cb(d.exists ? d.data() : null), err),
    saveSettings: data => fs.doc("config/settings").set(data, { merge: true }),
    createSession: async data => (await fs.collection("sessions").add(data)).id,
    updateSession: (sid, patch) => S(sid).update(patch),
    listSessions: async () => list(await fs.collection("sessions").orderBy("at", "desc").limit(200).get()),
    addQuestion: (sid, data) => S(sid).collection("questions").add(data),
    updateQuestion: (sid, id, patch) => S(sid).collection("questions").doc(id).update(patch),
    watchQuestions(sid, cb, num, err = onErr) {
      let q = S(sid).collection("questions");
      if (num) q = q.where("num", "==", num);
      return q.onSnapshot(s => cb(byAt(list(s))), err);
    },
    setAnswer: (sid, id, data) => S(sid).collection("answers").doc(id).set(data, { merge: true }),
    updateAnswer: (sid, id, patch) => S(sid).collection("answers").doc(id).update(patch),
    watchAnswers: (sid, round, cb, err = onErr) => S(sid).collection("answers").where("round", "==", round).onSnapshot(s => cb(byAt(list(s))), err),
    watchAnswer: (sid, id, cb, err = onErr) => S(sid).collection("answers").doc(id).onSnapshot(d => cb(d.exists ? { id: d.id, ...d.data() } : null), err),
    setRound: (sid, round, data) => S(sid).collection("rounds").doc(String(round)).set(data),
    watchRounds: (sid, cb, err = onErr) => S(sid).collection("rounds").onSnapshot(s => cb(list(s).sort((a, b) => a.round - b.round)), err),
    async dump(sid) {
      const [q, a, r] = await Promise.all(["questions", "answers", "rounds"].map(c => S(sid).collection(c).get()));
      return { questions: byAt(list(q)), answers: byAt(list(a)), rounds: list(r).sort((x, y) => x.round - y.round) };
    }
  };
}

function localDB() {
  const KEY = "rq_demo_store";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  let st = load();
  const subs = new Set();
  const notify = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} setTimeout(notify, 0); return Promise.resolve(); };
  addEventListener("storage", e => { if (e.key === KEY) { st = load(); notify(); } });
  const sub = fn => { subs.add(fn); setTimeout(fn, 0); return () => subs.delete(fn); };
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const sess = sid => { st.sessions = st.sessions || {}; return st.sessions[sid] = st.sessions[sid] || { data: {}, questions: {}, answers: {}, rounds: {} }; };
  const arr = o => Object.entries(o || {}).map(([id, v]) => ({ id, ...v }));
  const cl = x => JSON.parse(JSON.stringify(x));
  return {
    demo: true,
    watchLive: cb => sub(() => cb(st.live ? cl(st.live) : null)),
    setLive: d => { st.live = { ...(st.live || {}), ...cl(d) }; return save(); },
    watchSettings: cb => sub(() => cb(st.settings ? cl(st.settings) : null)),
    saveSettings: d => { st.settings = { ...(st.settings || {}), ...cl(d) }; return save(); },
    createSession: async d => { const id = newId(); sess(id).data = cl(d); await save(); return id; },
    updateSession: (sid, p) => { Object.assign(sess(sid).data, cl(p)); return save(); },
    listSessions: async () => Object.entries(st.sessions || {}).map(([id, s]) => ({ id, ...s.data })).sort((a, b) => b.at - a.at),
    addQuestion: (sid, d) => { sess(sid).questions[newId()] = cl(d); return save(); },
    updateQuestion: (sid, id, p) => { Object.assign(sess(sid).questions[id] || {}, cl(p)); return save(); },
    watchQuestions: (sid, cb, num) => sub(() => cb(byAt(arr(sess(sid).questions).filter(q => !num || q.num === num)).map(cl))),
    setAnswer: (sid, id, d) => { const a = sess(sid).answers; a[id] = { ...(a[id] || {}), ...cl(d) }; return save(); },
    updateAnswer: (sid, id, p) => { Object.assign(sess(sid).answers[id] || {}, cl(p)); return save(); },
    watchAnswers: (sid, round, cb) => sub(() => cb(byAt(arr(sess(sid).answers).filter(a => a.round === round)).map(cl))),
    watchAnswer: (sid, id, cb) => sub(() => { const a = sess(sid).answers[id]; cb(a ? { id, ...cl(a) } : null); }),
    setRound: (sid, round, d) => { sess(sid).rounds[String(round)] = cl(d); return save(); },
    watchRounds: (sid, cb) => sub(() => cb(arr(sess(sid).rounds).sort((a, b) => a.round - b.round).map(cl))),
    dump: async sid => { const s = sess(sid); return cl({ questions: byAt(arr(s.questions)), answers: byAt(arr(s.answers)), rounds: arr(s.rounds).sort((a, b) => a.round - b.round) }); }
  };
}

/* ================= 소리 (교사 화면에서만 사용) =================
   음악은 모두 이 앱을 위해 새로 만든 8비트 곡이에요. 음원 파일 없이 브라우저가 직접 연주해요. */
const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, noiseBuf, timer = null;
  let cur = null, step = 0, nextT = 0;
  const prefs = Object.assign({ music: true, sfx: true, vol: 0.7 }, LS.get("sound", {}));

  const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  const hz = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12); };
  const bar = s => s.trim().split(/\s+/).map(x => (x === "-" ? null : x));

  // 곡: 8분음표 한 칸씩. lead=멜로디, bass=베이스, drum: k=킥 s=스네어 h=하이햇 t=틱
  const SONGS = {
    write: { // 질문 쓰기 — 통통 튀는 산책
      bpm: 112, leadType: "square", leadVol: 0.07,
      lead: bar(`E5 - G5 E5 C5 - D5 E5  F5 - A5 F5 D5 - - -  E5 - G5 E5 C5 - D5 E5  D5 - B4 G4 C5 - - -
                 G5 - E5 G5 A5 - G5 E5  F5 - D5 F5 E5 - C5 -  D5 - E5 F5 G5 - E5 C5  D5 - G4 B4 C5 - - -`),
      bass: bar(`C3 - G3 - C3 - G3 -  F2 - C3 - F2 - C3 -  C3 - G3 - C3 - G3 -  G2 - D3 - C3 - G2 -
                 C3 - G3 - A2 - E3 -  F2 - C3 - C3 - G3 -  D3 - A3 - G2 - D3 -  G2 - D3 - C3 - - -`),
      drum: "k h s h k h s h"
    },
    pick: { // 질문 고르기 — 똑딱똑딱 고민 중
      bpm: 96, leadType: "triangle", leadVol: 0.16,
      lead: bar(`A4 - C5 - E5 - C5 -  B4 - D5 - E5 - D5 -  A4 - C5 - E5 - A5 -  E5 - D5 - B4 - G#4 -`),
      bass: bar(`A2 - - - A2 - - -  G2 - - - G2 - - -  F2 - - - F2 - - -  E2 - - - E2 - - -`),
      drum: "t - t - t - t -"
    },
    answer: { // 답하기 — 신나게 달리기
      bpm: 148, leadType: "square", leadVol: 0.07,
      lead: bar(`C5 C5 - F5 - A5 G5 F5  G5 - E5 - C5 - - -  A4 A4 - D5 - F5 E5 D5  E5 - G5 - F5 - - -
                 A5 - A5 G5 F5 - G5 A5  G5 - E5 - C5 - - -  D5 - F5 - A5 - G5 F5  E5 - C5 - F5 - - -`),
      bass: bar(`F2 F3 F2 F3 F2 F3 F2 F3  C3 C4 C3 C4 C3 C4 C3 C4  D2 D3 D2 D3 D2 D3 D2 D3  C3 C4 C3 C4 F2 F3 F2 F3
                 F2 F3 F2 F3 F2 F3 F2 F3  C3 C4 C3 C4 C3 C4 C3 C4  A#2 A#3 A#2 A#3 A#2 A#3 A#2 A#3  C3 C4 C3 C4 F2 F3 F2 F3`),
      drum: "k h s h k k s h"
    }
  };

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = prefs.vol; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = prefs.music ? 1 : 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = prefs.sfx ? 1 : 0; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    timer = setInterval(tick, 25);
  }

  function tone(f, t, dur, type, vol, dest, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(t, dur, vol, dest, hp) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function drum(ch, t, dest, v = 1) {
    if (ch === "k") tone(150, t, 0.12, "sine", 0.5 * v, dest, 45);
    else if (ch === "s") noise(t, 0.12, 0.22 * v, dest, 1500);
    else if (ch === "h") noise(t, 0.03, 0.06 * v, dest, 7000);
    else if (ch === "t") noise(t, 0.025, 0.09 * v, dest, 5000);
  }

  function tick() {
    if (!ctx || !cur || !prefs.music) return;
    const song = SONGS[cur], e8 = 60 / song.bpm / 2;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + 0.15) {
      const L = song.lead[step % song.lead.length], B = song.bass[step % song.bass.length];
      const D = song.drum.split(" ")[step % 8];
      if (L) tone(hz(L), nextT, e8 * 0.9, song.leadType, song.leadVol, musicBus);
      if (B) tone(hz(B), nextT, e8 * (cur === "pick" ? 3.6 : 0.85), "triangle", 0.2, musicBus);
      if (D && D !== "-") drum(D, nextT, musicBus, 0.8);
      nextT += e8; step++;
    }
  }

  function play(name) {
    if (name === cur) return;
    cur = name; step = 0;
    if (ctx) nextT = ctx.currentTime + 0.1;
  }
  function stop() { cur = null; }

  function duck(on) {
    if (!ctx) return;
    const g = musicBus.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(prefs.music ? (on ? 0.15 : 1) : 0, t + 0.15);
  }

  const sfx = {
    coin() { const t = ctx.currentTime; tone(hz("B5"), t, 0.07, "square", 0.09, sfxBus); tone(hz("E6"), t + 0.07, 0.3, "square", 0.09, sfxBus); },
    stage() {
      const t = ctx.currentTime;
      ["C5", "E5", "G5", "C6", "E6", "G6"].forEach((n, i) => tone(hz(n), t + i * 0.07, 0.12, "square", 0.08, sfxBus));
      ["C5", "E5", "G5"].forEach(n => tone(hz(n), t + 0.45, 0.5, "triangle", 0.15, sfxBus));
    },
    drumroll(sec = 1.4) {
      duck(true);
      const t0 = ctx.currentTime; let t = t0, i = 0;
      while (t < t0 + sec) {
        const p = (t - t0) / sec;
        noise(t, 0.05, 0.08 + 0.18 * p, sfxBus, 900);
        if (i % 4 === 0) tone(110, t, 0.07, "sine", 0.18, sfxBus, 60);
        t += 0.09 - 0.055 * p; i++;
      }
    },
    tada() {
      const t = ctx.currentTime;
      drum("s", t, sfxBus, 1.3);
      ["C5", "E5", "G5", "C6"].forEach(n => tone(hz(n), t, 0.7, "square", 0.05, sfxBus));
      ["C4", "G4"].forEach(n => tone(hz(n), t, 0.7, "triangle", 0.2, sfxBus));
      tone(hz("E6"), t + 0.12, 0.5, "square", 0.05, sfxBus);
      setTimeout(() => duck(false), 650);
    },
    pop() { const t = ctx.currentTime; tone(hz("A5"), t, 0.05, "square", 0.06, sfxBus); tone(hz("D6"), t + 0.05, 0.08, "square", 0.06, sfxBus); },
    down() { const t = ctx.currentTime; tone(hz("E5"), t, 0.25, "square", 0.06, sfxBus, hz("E4")); },
    fanfare() {
      const t = ctx.currentTime;
      [["G4", 0], ["C5", .12], ["E5", .24], ["G5", .36], ["E5", .54], ["G5", .66]].forEach(([n, d]) => tone(hz(n), t + d, 0.14, "square", 0.08, sfxBus));
      ["C5", "E5", "G5", "C6"].forEach(n => tone(hz(n), t + 0.84, 0.9, "square", 0.05, sfxBus));
    }
  };

  return {
    init,
    get ready() { return !!ctx; },
    play, stop,
    fx(name, ...a) { if (ctx && prefs.sfx && sfx[name]) sfx[name](...a); },
    prefs,
    setMusic(on) { prefs.music = on; LS.set("sound", prefs); if (ctx) { duck(false); nextT = ctx.currentTime + 0.1; } },
    setSfx(on) { prefs.sfx = on; LS.set("sound", prefs); if (ctx) sfxBus.gain.value = on ? 1 : 0; },
    setVol(v) { prefs.vol = v; LS.set("sound", prefs); if (ctx) master.gain.value = v; }
  };
})();

/* 배경(하늘·구름·언덕·벽돌 바닥) */
function paintScenery() {
  const s = document.createElement("div");
  s.className = "scenery"; s.setAttribute("aria-hidden", "true");
  s.innerHTML = `<i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i><i class="hill h1"></i><i class="hill h2"></i><i class="ground"></i>`;
  document.body.prepend(s);
}

/* 아이콘 (선 아이콘) */
const ICON = {
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6 0 10 8 10 8a17 17 0 0 1-2.9 3.9"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s4 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>',
  eye: '<path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  flag: '<path d="M5 22V3"/><path d="M5 4h12l-2 4 2 4H5"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.1 6.1 20.3l1.3-6.5L2.5 9.3l6.6-.8z"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'
};
const ic = (name, size = 22, extra = "") => `<svg class="ic" ${extra} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
