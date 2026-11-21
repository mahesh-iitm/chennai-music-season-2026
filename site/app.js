/* Margazhi Song Lists 2026 · front end (no build step, no dependencies) */
(() => {
"use strict";
const CFG = window.CMS_CONFIG || {};
const API = (CFG.API_BASE || "").replace(/\/$/, "");
const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const dots = (...a) => a.filter(x => x && String(x).trim()).map(esc).join(" · ");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const mem = {};
function clientId() {
  let id = store.get("cms_client", null);
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); store.set("cms_client", id); }
  return mem.client || (mem.client = id);
}

// ---------- transliteration-tolerant keys (same rules as scripts/aggregate.py) ----------
function plain(s) {
  s = String(s || "").toLowerCase();
  return s.replace(/aa/g, "a").replace(/ee/g, "i").replace(/ii/g, "i").replace(/oo/g, "u").replace(/uu/g, "u");
}
function key(s) {
  s = plain(s).replace(/\(.*?\)/g, "").replace(/hh/g, "h").replace(/ow/g, "au");
  s = s.replace(/([sbdktcgjp])h/g, "$1").replace(/w/g, "v").replace(/z/g, "l").replace(/[^a-z]/g, "");
  return s.replace(/m$/, "").replace(/a$/, "");
}
const titleKey = s => key(s).replace(/(.)\1+/g, "$1");
const RAGA_ABBR = { kal: "Kalyani", sank: "Shankarabharanam", shank: "Shankarabharanam", tod: "Todi", kambodi: "Kambhoji",
  kamboji: "Kambhoji", kharahar: "Kharaharapriya", kp: "Kharaharapriya", pantuvarali: "Kamavardhani", mmg: "Mayamalavagaula",
  rm: "Ragamalika", ragamalik: "Ragamalika", sankarabaranam: "Shankarabharanam" };
const TALA_STD = { adi: "Adi", rupak: "Rupakam", rupaka: "Rupakam", capu: "Chapu", mcapu: "Misra Chapu", misracapu: "Misra Chapu",
  kcapu: "Khanda Chapu", kandacapu: "Khanda Chapu", ata: "Ata", at: "Ata", jampa: "Jhampa", jamp: "Jhampa", tripu: "Triputa", triput: "Triputa",
  ek: "Eka", eka: "Eka", tisraek: "Tisra Eka", kandaek: "Khanda Eka", desadi: "Desadi", madyadi: "Madhyadi" };
const stdTala = t => (t ? TALA_STD[key(t)] || t.trim() : "");
const TYPES_NO_SONG = new Set(["tani", "viruttam", "mangalam"]);

// ---------- data ----------
const D = { songs: [], byId: new Map(), ragaByKey: new Map(), ragaKeys: [], gramIdx: new Map(), sabhas: [], sabhaById: new Map(),
            concerts: [], concertById: new Map(), cindex: {}, stats: null, counts: {} };
async function getJSON(path, fallback) {
  try { const r = await fetch(path, { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); } catch { return fallback; }
}
function grams(s) { const g = new Set(); const t = `  ${s} `; for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; }
let songsReady = null;
function loadSongs() {
  return songsReady || (songsReady = getJSON("data/songs.json", { fields: [], songs: [] }).then(j => {
    j.songs.forEach((r, i) => {
      const s = { id: r[0], title: r[1], raga: r[2], tala: r[3], composer: r[4], language: r[5] };
      s.tk = titleKey(s.title); s.rk = key(s.raga); s.g = grams(s.tk);
      D.songs.push(s); D.byId.set(s.id, s);
      for (const g of s.g) { let a = D.gramIdx.get(g); if (!a) D.gramIdx.set(g, a = []); a.push(i); }
      if (s.raga && !D.ragaByKey.has(s.rk)) D.ragaByKey.set(s.rk, s.raga);
    });
    D.ragaKeys = [...D.ragaByKey.keys()];
    $("#raga-list").innerHTML = [...new Set(D.songs.map(s => s.raga).filter(Boolean))].sort().map(r => `<option value="${esc(r)}">`).join("");
    $("#tala-list").innerHTML = [...new Set(D.songs.map(s => s.tala).filter(Boolean))].sort().map(r => `<option value="${esc(r)}">`).join("");
  }));
}
async function loadCore() {
  const pub = (name, fb) => API ? getJSON(`${API}/api/data/${name}`, fb) : Promise.resolve(fb);
  const [sab, con, add, cidx, stats] = await Promise.all([
    getJSON("data/sabhas.json", { sabhas: [] }), getJSON("data/concerts.json", { concerts: [] }),
    getJSON("data/added_concerts.json", { concerts: [] }), pub("concert-index", {}), pub("stats", null)]);
  D.sabhas = sab.sabhas; D.sabhas.forEach(s => D.sabhaById.set(s.id, s));
  const addConcerts = list => list.forEach(c => { if (!D.concertById.has(c.id)) { c.source = c.source || "rasika"; D.concerts.push(c); D.concertById.set(c.id, c); } });
  addConcerts(con.concerts); addConcerts(add.concerts);
  D.cindex = cidx || {}; D.stats = stats;
  if (API) {
    const [live, counts] = await Promise.all([getJSON(API + "/api/concert-additions", { concerts: [] }), getJSON(API + "/api/counts", {})]);
    addConcerts(live.concerts); D.counts = counts;
  }
  D.concerts.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function stdRaga(raw) {
  if (!raw || !raw.trim()) return "";
  const k = key(raw);
  if (D.ragaByKey.has(k)) return D.ragaByKey.get(k);
  if (RAGA_ABBR[k]) return RAGA_ABBR[k];
  let best = null, sc = 0;
  for (const c of D.ragaKeys) { if (Math.abs(c.length - k.length) > 4) continue; const r = sim(k, c); if (r > sc) { sc = r; best = c; } }
  return best && sc >= 0.8 ? D.ragaByKey.get(best) : raw.trim();
}
function sim(a, b) { // bigram Dice
  if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
  const m = new Map(); for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  let hit = 0; for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2), n = m.get(g); if (n) { hit++; m.set(g, n - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}

// ---------- matching a read line to the Karnatik list ----------
function candidates(item, limit = 6) {
  const q = titleKey(item.title || item.written || "");
  if (q.length < 2) return [];
  const rk = item.raga ? key(stdRaga(item.raga)) : "";
  const ck = item.composer ? key(item.composer).slice(0, 5) : "";
  const qg = grams(q), seen = new Map();
  for (const g of qg) for (const i of (D.gramIdx.get(g) || [])) seen.set(i, (seen.get(i) || 0) + 1);
  const scored = [];
  for (const [i, shared] of seen) {
    if (shared < Math.min(2, qg.size)) continue;
    const s = D.songs[i]; let sc;
    if (s.tk === q) sc = 1;
    else if (q.length >= 4 && s.tk.startsWith(q)) sc = 0.8 + 0.15 * (q.length / s.tk.length);
    else if (s.tk.length >= 4 && q.startsWith(s.tk)) sc = 0.75;
    else sc = (2 * shared) / (qg.size + s.g.size);
    if (rk) sc += s.rk === rk ? 0.3 : (s.rk ? -0.12 : 0);
    if (ck && key(s.composer).startsWith(ck)) sc += 0.08;
    scored.push([sc, s]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([score, s]) => ({ score, s }));
}
function autoPick(item) {
  if (TYPES_NO_SONG.has(item.type) || item.type === "rtp") return null;
  const c = candidates(item, 3);
  if (!c.length) return null;
  const [a, b] = c;
  const ragaOk = !item.raga || key(stdRaga(item.raga)) === a.s.rk;
  if (a.score >= 1.05 || (a.score >= 0.8 && ragaOk && (!b || a.score - b.score >= 0.08))) return a.s;
  return null;
}

// ---------- routing ----------
const routes = { "": viewSeason, "daily": viewDaily, "concerts": viewConcerts, "concert": viewConcert, "submit": viewSubmit, "about": viewAbout };
function go() {
  const [, name = "", arg] = (location.hash || "#/").split("/");
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === (name || "season")));
  (routes[name] || viewSeason)(arg ? decodeURIComponent(arg) : undefined);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", go);
loadCore().then(go);

const sabhaName = id => D.sabhaById.get(id)?.name || id;
const fmtDate = d => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return x.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); };
const fmtTime = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const nLists = id => Math.max(D.counts[id] || 0, D.cindex[id] || 0);
const listsPill = id => { const n = nLists(id); return n ? `<span class="pill ${n >= 3 ? "green" : ""}">${n} list${n > 1 ? "s" : ""}</span>` : `<span class="pill grey">no list yet</span>`; };

// ---------- Season dashboard ----------
function bars(rows, field = "renditions", n = 15) {
  if (!rows?.length) return `<p class="sub">Nothing yet.</p>`;
  const top = rows.slice(0, n), max = Math.max(...top.map(r => r[field]));
  return `<ul class="bars">${top.map(r => `<li><span>${esc(r.name)}</span><span class="bar" style="width:${Math.max(4, (100 * r[field]) / max)}%"></span><span class="n">${r[field]}</span></li>`).join("")}</ul>`;
}
function viewSeason() {
  const st = D.stats, t = st?.totals;
  const hero = `<section class="hero">
    <div><h1>What is Chennai singing this Margazhi?</h1>
      <p class="lede">Rasikas share the song list from each concert they attend: a photo of the handwritten notes is enough. Lists from several rasikas are cross-checked, and the whole Season builds up here: which ragas dominate, which krithis are everywhere, and which rare gems were heard only once.</p>
      <div class="actions"><a class="btn primary" href="#/submit">Share a concert's song list</a><a class="btn" href="#/concerts">Browse concerts</a></div></div>
    <div class="card"><h3>How it works</h3><ol class="sub" style="padding-left:18px;margin:0">
      <li>Pick the sabha, date and concert.</li><li>Snap your notes. We read the handwriting.</li>
      <li>Check what we read against the Karnatik song list and confirm.</li><li>Lists from different rasikas are combined by majority vote every night.</li></ol></div>
  </section>`;
  if (!t || !t.submissions) {
    app.innerHTML = hero + `<div class="card empty"><h2>The season's first lists are yet to come in</h2><p>${D.concerts.length ? `${D.concerts.length} concerts are loaded from sabha schedules so far.` : "Sabha schedules are being loaded as they are published."} Once rasikas start sharing, this page fills with the season's ragas, krithis and rarities, updated every night.</p></div>`;
    return;
  }
  app.innerHTML = hero + `
  <div class="kpis">
    <div class="kpi"><b>${t.concerts_with_lists}</b><span>concerts with lists</span></div>
    <div class="kpi"><b>${t.submissions}</b><span>lists shared</span></div>
    <div class="kpi"><b>${t.renditions}</b><span>songs performed</span></div>
    <div class="kpi"><b>${t.distinct_songs}</b><span>different krithis</span></div>
    <div class="kpi"><b>${t.distinct_ragas}</b><span>ragas heard</span></div>
  </div>
  <div class="grid">
    <section class="card"><h2>Most-heard ragas</h2>${bars(st.top_ragas)}</section>
    <section class="card"><h2>Ragas chosen for the main piece</h2><p class="sub">Main kriti or RTP of each concert</p>${bars(st.main_piece_ragas)}</section>
    <section class="card"><h2>Most-sung krithis</h2><ol class="list">${st.top_songs.slice(0, 15).map(s => `<li><b>${esc(s.title)}</b> <span class="pill">${s.renditions}×</span><div class="sub">${dots(s.raga, s.tala, s.composer)}</div></li>`).join("")}</ol></section>
    <section class="card"><h2>Composers</h2>${bars(st.top_composers)}</section>
    <section class="card"><h2>Talas</h2>${bars(st.talas, "renditions", 10)}</section>
    <section class="card"><h2>Rare gems: heard only once</h2><p class="sub">${st.sung_once.length} krithis were sung at just one concert this season.</p>
      <ul class="list">${st.sung_once.slice(0, 40).map(s => `<li><b>${esc(s.title)}</b><div class="sub">${dots(s.raga, s.composer)}${s.raga || s.composer ? " · " : ""}<a href="#/concert/${encodeURIComponent(s.concert_id)}">${esc(s.by.join(", ") || "concert")}, ${fmtDate(s.date)}</a></div></li>`).join("")}</ul></section>
    <section class="card"><h2>Ragas not heard yet</h2><p class="sub">Ragas with five or more compositions in the Karnatik catalogue that no shared list has featured so far.</p>
      <p>${st.ragas_not_heard.slice(0, 50).map(r => `<span class="pill" title="${r.songs_in_karnatik} compositions">${esc(r.name)}</span>`).join(" ")}</p></section>
    <section class="card"><h2>Artists</h2><table><tr><th>Artist</th><th>Concerts</th><th>Krithis</th><th>Ragas</th></tr>
      ${st.artists.slice(0, 25).map(a => `<tr><td>${esc(a.artist)}</td><td>${a.concerts}</td><td>${a.distinct_songs}</td><td>${a.distinct_ragas}</td></tr>`).join("")}</table></section>
  </div>
  <p class="sub">Updated ${new Date(st.generated_at).toLocaleString("en-IN")}. A song counts once at least half the rasikas at that concert listed it.</p>`;
}

const istDate = (plus = 0) => new Date(Date.now() + 5.5 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);

// ---------- Daily summary ----------
function subscribeCard() {
  const wa = (CFG.WHATSAPP_NUMBER || "").replace(/\D/g, ""), tg = CFG.TELEGRAM_URL || "";
  if (!wa && !tg) return `<div class="card"><h3>Morning summary on your phone</h3><p class="sub">WhatsApp and Telegram summaries are coming soon.</p></div>`;
  return `<div class="card"><h3>Get this summary every morning</h3>
    <p class="sub">A short note at 7:30 am through the Season: yesterday's concerts, most-heard ragas, main pieces and rare gems.</p>
    <div class="actions">
      ${wa ? `<a class="btn primary" href="https://wa.me/${wa}?text=${encodeURIComponent("JOIN")}" rel="noopener">Subscribe on WhatsApp</a>` : ""}
      ${tg ? `<a class="btn" href="${esc(tg)}" rel="noopener">Join the Telegram channel</a>` : ""}
    </div>
    ${wa ? `<p class="sub">WhatsApp opens with <b>JOIN</b> typed in: just press send. Reply <b>STOP</b> any time to unsubscribe.</p>` : ""}</div>`;
}
async function viewDaily(day) {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  const idx = API ? await getJSON(`${API}/api/data/digest/index`, { days: [] }) : { days: [] };
  const d = API ? await getJSON(`${API}/api/data/digest/${day || "latest"}`, null) : null;
  if (!d) { app.innerHTML = `<h1>Daily summary</h1><div class="card empty"><h2>The first summary arrives the morning after the first song lists are shared.</h2></div>` + subscribeCard(); return; }
  const pick = idx.days.length > 1 ? `<select id="dd" style="max-width:220px">${idx.days.map(x => `<option value="${x}" ${x === d.date ? "selected" : ""}>${fmtDate(x)}</option>`).join("")}</select>` : "";
  app.innerHTML = `<div class="actions" style="justify-content:space-between;margin:0"><h1 style="margin:0">${esc(fmtDate(d.date))}</h1>${pick}</div>
  <p class="lede">What was sung in Chennai, from the song lists rasikas shared.</p>
  <div class="kpis"><div class="kpi"><b>${d.concerts_with_lists}</b><span>concerts with lists</span></div><div class="kpi"><b>${d.sabhas}</b><span>sabhas</span></div>
    <div class="kpi"><b>${d.songs}</b><span>songs</span></div><div class="kpi"><b>${d.next_day.concerts}</b><span>concerts on ${esc(fmtDate(d.next_day.date))}</span></div></div>
  <div class="grid">
    <section class="card"><h2>Most-heard ragas</h2>${bars(d.top_ragas.map(r => ({ name: r.name, renditions: r.count })))}</section>
    <section class="card"><h2>Main pieces</h2>${d.main_pieces.length ? `<ul class="list">${d.main_pieces.map(m => `<li><a href="#/concert/${encodeURIComponent(m.concert_id)}"><b>${esc(m.artist)}</b></a><div class="sub">${dots(m.raga, m.title, m.sabha)}</div></li>`).join("")}</ul>` : `<p class="sub">No main pieces marked in the lists.</p>`}</section>
    <section class="card"><h2>Rare gems</h2><p class="sub">Heard for the first time this Season.</p>${d.rare_gems.length ? `<ul class="list">${d.rare_gems.map(g => `<li><b>${esc(g.title)}</b><div class="sub">${dots(g.raga, g.composer)} · <a href="#/concert/${encodeURIComponent(g.concert_id)}">${esc(g.artist)}</a></div></li>`).join("")}</ul>` : `<p class="sub">None today.</p>`}</section>
  </div>` + subscribeCard();
  const dd = $("#dd"); if (dd) dd.onchange = () => { location.hash = "#/daily/" + dd.value; };
}

// ---------- Concerts ----------
function viewConcerts() {
  const f = mem.filter || (mem.filter = { sabha: "", q: "", only: false, day: "" });
  const draw = () => {
    const q = key(f.q), want = f.day === "today" ? istDate(0) : f.day === "tomorrow" ? istDate(1) : "";
    document.querySelectorAll("[data-day]").forEach(b => b.classList.toggle("primary", b.dataset.day === f.day));
    const list = D.concerts.filter(c => (!f.sabha || c.sabha_id === f.sabha) && (!q || key(c.artist).includes(q)) && (!f.only || nLists(c.id)) && (!want || c.date === want));
    const byDay = {}; list.forEach(c => (byDay[c.date] = byDay[c.date] || []).push(c));
    $("#clist").innerHTML = list.length ? Object.entries(byDay).map(([d, cs]) => `<div class="day"><h3>${fmtDate(d)}</h3>${cs.map(c =>
      `<div class="concert"><div><a href="#/concert/${encodeURIComponent(c.id)}">${esc(c.artist)}</a><div class="sub">${fmtTime(c.time)} · ${esc(sabhaName(c.sabha_id))}${c.source === "rasika" ? " · added by a rasika" : ""}</div></div>${listsPill(c.id)}</div>`).join("")}</div>`).join("")
      : `<div class="empty">${D.concerts.length ? "No concerts match." : "Sabha schedules will appear here as they are published. You can still share a list: choose your sabha and add the concert."}</div>`;
  };
  app.innerHTML = `<h1>Concerts</h1>
    <div class="actions" style="margin:0 0 12px"><button data-day="">All</button><button data-day="today">Today</button><button data-day="tomorrow">Tomorrow</button></div>
    <div class="filters">
    <select id="fs"><option value="">All sabhas</option>${D.sabhas.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>
    <input id="fq" placeholder="Search artist" value="${esc(f.q)}">
    <label style="display:flex;gap:6px;align-items:center;flex:0 0 auto"><input type="checkbox" id="fo" style="width:auto"> with lists only</label></div><div id="clist" class="card"></div>`;
  $("#fs").value = f.sabha; $("#fo").checked = f.only;
  $("#fs").onchange = e => { f.sabha = e.target.value; draw(); };
  $("#fq").oninput = e => { f.q = e.target.value; draw(); };
  $("#fo").onchange = e => { f.only = e.target.checked; draw(); };
  document.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { f.day = b.dataset.day; draw(); });
  draw();
}
async function viewConcert(id) {
  const c = D.concertById.get(id);
  const cons = D.cindex[id] && API ? await getJSON(`${API}/api/data/concert/${encodeURIComponent(id)}`, null) : null;
  if (!c && !cons) { app.innerHTML = `<div class="empty"><h2>Concert not found</h2><a href="#/concerts">Back to concerts</a></div>`; return; }
  const head = c ? `<h1>${esc(c.artist)}</h1><p class="sub">${fmtDate(c.date)}, ${fmtTime(c.time)} · ${esc(sabhaName(c.sabha_id))}${c.accompanists ? `<br>${esc(c.accompanists)}` : ""}</p>` : `<h1>${esc(id)}</h1>`;
  const live = D.counts[id] || 0;
  let body;
  if (!cons) body = `<div class="card empty"><p>${live ? `${live} list${live > 1 ? "s have" : " has"} been shared. The combined list appears after tonight's update.` : "No list shared yet for this concert."}</p><a class="btn primary" href="#/submit/${encodeURIComponent(id)}">Share your list</a></div>`;
  else {
    const lvl = cons.n_rasikas >= 3 ? `<span class="pill green">consensus of ${cons.n_rasikas} rasikas</span>` : `<span class="pill warn">${cons.level}: needs more rasikas to confirm</span>`;
    body = `<div class="card"><div class="actions" style="margin:0 0 10px">${lvl}<a class="btn" href="#/submit/${encodeURIComponent(id)}">Add your list</a></div>
      <table><tr><th>#</th><th>Song</th><th>Raga</th><th>Tala</th><th>Composer</th><th>Agreement</th></tr>
      ${cons.songs.map(s => `<tr><td>${s.pos}</td><td><b>${esc(s.title)}</b>${s.type !== "kriti" ? ` <span class="pill grey">${esc(s.type)}</span>` : ""}${s.notes ? `<div class="sub">${esc(s.notes)}</div>` : ""}</td><td>${esc(s.raga)}</td><td>${esc(s.tala)}</td><td>${esc(s.composer)}</td><td>${s.votes}/${cons.n_rasikas}</td></tr>`).join("")}</table>
      ${cons.disputed?.length ? `<h3 style="margin-top:16px">Listed by fewer than half</h3><ul class="list">${cons.disputed.map(s => `<li>${esc(s.title)} <span class="sub">${esc(s.raga)} · ${s.votes}/${cons.n_rasikas}</span></li>`).join("")}</ul>` : ""}</div>`;
  }
  app.innerHTML = head + body;
}
function viewAbout() {
  app.innerHTML = `<div class="card"><h1>How it works</h1>
  <p><b>Concert list.</b> The schedules of Chennai's major sabhas are loaded as they are published. If a concert is missing, any rasika can add it.</p>
  <p><b>Reading your notes.</b> Your photo is sent to an AI handwriting reader, which returns each line it can read. The photo is not stored. Each line is then matched to the <a href="https://www.karnatik.com/lyrics.shtml">karnatik.com</a> catalogue of over 8,000 compositions, using the raga you noted to tell apart songs with similar names. You correct anything it got wrong before confirming.</p>
  <p><b>Majority vote.</b> Every night, all confirmed lists for a concert are combined. A song is accepted when at least half the rasikas at that concert listed it, and the order follows the median position. One list is shown as a "single report", three or more as a consensus.</p>
  <p><b>Privacy.</b> No login, no names, no photos kept. Each browser gets a random id so that a rasika who resubmits replaces their own earlier list rather than voting twice.</p>
  <p><b>Your data.</b> Song lists and statistics are shown here for rasikas and are not published as downloadable data. How the collected data may be shared after the Season will be decided later.</p></div>`;
}

// ---------- Share a list ----------
function viewSubmit(preset) {
  const S = mem.sub = { concert: preset ? D.concertById.get(preset) : null, items: [], ocr: null, usedPhoto: false, header: null };
  loadSongs();
  stepConcert(S);
}
function steps(n) {
  return `<div class="steps">${["Concert", "Photo", "Check", "Done"].map((s, i) => `<span class="${i + 1 === n ? "on" : i + 1 < n ? "done" : ""}">${i + 1}. ${s}</span>`).join("")}</div>`;
}
function stepConcert(S) {
  const c0 = S.concert;
  app.innerHTML = `<h1>Share a song list</h1>${steps(1)}<div class="card">
    <div class="field"><label for="s-sabha">Sabha</label><select id="s-sabha"><option value="">Choose sabha</option>${D.sabhas.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="s-date">Date</label><select id="s-date" disabled><option>Choose sabha first</option></select></div>
    <div class="field"><label for="s-con">Concert</label><select id="s-con" disabled><option>Choose date first</option></select></div>
    <p><button class="link" id="s-add">Concert not in the list? Add it</button></p>
    <div id="s-addform" hidden class="card" style="background:#fffaf0">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="field"><label>Date</label><input type="date" id="a-date" min="2026-11-01" max="2027-02-15"></div>
        <div class="field"><label>Start time</label><input type="time" id="a-time"></div>
        <div class="field" style="grid-column:1/-1"><label>Main artist(s)</label><input id="a-artist" placeholder="e.g. vocalist name"></div>
        <div class="field" style="grid-column:1/-1"><label>Accompanists (optional)</label><input id="a-acc"></div></div>
      <button class="primary" id="a-save">Add concert</button> <span id="a-msg" class="sub"></span></div>
    <div class="actions"><button class="primary" id="s-next" disabled>Next: photo of your notes</button></div></div>`;
  const sab = $("#s-sabha"), dt = $("#s-date"), con = $("#s-con"), next = $("#s-next");
  const fillDates = () => {
    const cs = D.concerts.filter(c => c.sabha_id === sab.value);
    const dates = [...new Set(cs.map(c => c.date))];
    dt.disabled = !sab.value; con.disabled = true; next.disabled = true;
    dt.innerHTML = !sab.value ? `<option>Choose sabha first</option>` : dates.length ? `<option value="">Choose date</option>` + dates.map(d => `<option value="${d}">${fmtDate(d)}</option>`).join("") : `<option value="">Schedule not loaded yet: add your concert below</option>`;
    if (sab.value && !dates.length) $("#s-addform").hidden = false;
  };
  const fillConcerts = () => {
    const cs = D.concerts.filter(c => c.sabha_id === sab.value && c.date === dt.value);
    con.disabled = !dt.value;
    con.innerHTML = `<option value="">Choose concert</option>` + cs.map(c => `<option value="${esc(c.id)}">${fmtTime(c.time)} · ${esc(c.artist)}${nLists(c.id) ? ` (${nLists(c.id)} list${nLists(c.id) > 1 ? "s" : ""} shared)` : ""}</option>`).join("");
  };
  sab.onchange = fillDates; dt.onchange = fillConcerts;
  con.onchange = () => { S.concert = D.concertById.get(con.value) || null; next.disabled = !S.concert; };
  $("#s-add").onclick = () => { const f = $("#s-addform"); f.hidden = !f.hidden; if (dt.value) $("#a-date").value = dt.value; };
  $("#a-save").onclick = async () => {
    const msg = $("#a-msg"), body = { sabha_id: sab.value, date: $("#a-date").value, time: $("#a-time").value, artist: $("#a-artist").value.trim(), accompanists: $("#a-acc").value.trim() };
    if (!body.sabha_id) { msg.textContent = "Choose the sabha above first."; return; }
    if (!body.date || !body.time || body.artist.length < 2) { msg.textContent = "Please fill date, time and artist."; return; }
    if (!API) { msg.textContent = "The site isn't connected to its server yet."; return; }
    msg.textContent = "Saving…";
    try {
      const r = await post("/api/concert", body);
      const c = { id: r.id, ...body, source: "rasika" };
      if (!D.concertById.has(c.id)) { D.concerts.push(c); D.concertById.set(c.id, c); D.concerts.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); }
      fillDates(); dt.value = c.date; fillConcerts(); con.value = c.id; con.onchange();
      $("#s-addform").hidden = true; msg.textContent = "";
    } catch (e) { msg.textContent = e.message; }
  };
  if (c0) { sab.value = c0.sabha_id; fillDates(); dt.value = c0.date; fillConcerts(); con.value = c0.id; con.onchange(); }
  next.onclick = () => stepPhoto(S);
}
async function post(path, body) {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status}). Please try again.`);
  return j;
}
function concertLine(c) { return `<p class="sub"><b>${esc(c.artist)}</b> · ${fmtDate(c.date)}, ${fmtTime(c.time)} · ${esc(sabhaName(c.sabha_id))} <button class="link" id="chg">change</button></p>`; }
function stepPhoto(S) {
  app.innerHTML = `<h1>Share a song list</h1>${steps(2)}${concertLine(S.concert)}<div class="card">
    <label class="drop" id="drop"><input type="file" id="file" accept="image/*" capture="environment" hidden>
      <div id="prev"><b>Tap to take or choose a photo of your notes</b><div class="sub">Song, raga, tala, whatever you wrote down. Any language is fine.</div></div></label>
    <div id="ts"></div><div id="pmsg"></div>
    <div class="actions"><button class="primary" id="read" disabled>Read my notes</button><button id="type">Type the list instead</button></div></div>`;
  $("#chg").onclick = () => stepConcert(S);
  let blob = null, tsToken = "";
  if (CFG.TURNSTILE_SITEKEY && API) {
    window.onTs = t => { tsToken = t; };
    if (!window.turnstile) { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=renderTs"; s.async = true; document.head.append(s); }
    window.renderTs = () => window.turnstile.render("#ts", { sitekey: CFG.TURNSTILE_SITEKEY, callback: window.onTs });
    if (window.turnstile) window.renderTs();
  }
  $("#file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $("#pmsg").innerHTML = "";
    try { blob = await shrink(f); } catch { $("#pmsg").innerHTML = `<div class="notice err">Couldn't open that image. Try a JPEG or PNG photo.</div>`; return; }
    $("#prev").innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Your notes"><span class="sub">Tap to choose a different photo</span>`;
    $("#read").disabled = false;
  };
  $("#type").onclick = () => { S.items = [blankItem()]; S.ocr = null; S.usedPhoto = false; loadSongs().then(() => stepCheck(S)); };
  $("#read").onclick = async () => {
    if (!API) { $("#pmsg").innerHTML = `<div class="notice err">The site isn't connected to its handwriting reader yet. You can type the list instead.</div>`; return; }
    const btn = $("#read"); btn.disabled = true; btn.textContent = "Reading your handwriting…";
    try {
      const b64 = await toB64(blob);
      const [res] = await Promise.all([post("/api/ocr", { image: b64, media_type: "image/jpeg", turnstile: tsToken, concert_id: S.concert.id }), loadSongs()]);
      if (!res.items?.length) { $("#pmsg").innerHTML = `<div class="notice err">We couldn't find a song list in that photo${res.unreadable ? ` (${esc(res.unreadable)})` : ""}. Try a sharper, well-lit photo, or type the list.</div>`; btn.disabled = false; btn.textContent = "Read my notes"; return; }
      S.ocr = res.items; S.header = res.header || {}; S.usedPhoto = true; S.unreadable = res.unreadable || "";
      S.items = res.items.map(it => { const m = autoPick(it); return { ...it, raga: m ? m.raga : stdRaga(it.raga), tala: m ? m.tala || stdTala(it.tala) : stdTala(it.tala), song_id: m ? m.id : null, auto: !!m }; });
      stepCheck(S);
    } catch (e) { $("#pmsg").innerHTML = `<div class="notice err">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = "Read my notes"; if (window.turnstile) window.turnstile.reset(); }
  };
}
function blankItem() { return { written: "", title: "", raga: "", tala: "", composer: "", type: "kriti", notes: "", song_id: null }; }
async function shrink(file, max = 1600) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.85));
}
const toB64 = b => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(b); });

function stepCheck(S) {
  const c = S.concert, h = S.header || {};
  const mism = h.artist && key(h.artist).slice(0, 5) && !key(c.artist).includes(key(h.artist).slice(0, 5));
  app.innerHTML = `<h1>Check what we read</h1>${steps(3)}${concertLine(c)}
    ${S.usedPhoto ? `<div class="notice">We read <b>${S.items.length}</b> item${S.items.length > 1 ? "s" : ""}. Lines marked <span class="pill green">matched</span> were found in the Karnatik song list. Fix anything that's wrong, then confirm.</div>` : `<div class="notice">Add each song in the order it was sung. Start typing a title to pick it from the Karnatik song list.</div>`}
    ${mism ? `<div class="notice err">Your notes mention <b>${esc(h.artist)}</b>, but the concert you chose is <b>${esc(c.artist)}</b>. Please check you picked the right concert.</div>` : ""}
    ${S.unreadable ? `<div class="notice">Couldn't read: ${esc(S.unreadable)}</div>` : ""}
    <ol class="rows" id="rows"></ol>
    <div class="actions"><button id="addrow">+ Add a song</button></div>
    <div class="card" style="margin-top:16px"><div class="actions" style="margin:0"><button class="primary" id="confirm">Confirm and share</button><button id="back">Back to photo</button><span id="cmsg" class="sub"></span></div></div>`;
  $("#chg").onclick = () => stepConcert(S);
  $("#back").onclick = () => stepPhoto(S);
  $("#addrow").onclick = () => { S.items.push(blankItem()); drawRows(S); $("#rows").lastElementChild?.querySelector(".q").focus(); };
  $("#confirm").onclick = () => confirmSubmit(S);
  drawRows(S);
}
function drawRows(S) {
  const ol = $("#rows"); ol.innerHTML = "";
  S.items.forEach((it, i) => {
    const li = $("#tpl-row").content.firstElementChild.cloneNode(true);
    li.querySelector(".row-num").textContent = i + 1;
    li.querySelector(".written").textContent = it.written ? `Your note: “${it.written}”` : "";
    const q = li.querySelector(".q"), sug = li.querySelector(".suggest"), st = li.querySelector(".status");
    const song = it.song_id ? D.byId.get(it.song_id) : null;
    q.value = song ? song.title : it.title || "";
    for (const f of ["raga", "tala", "notes"]) { const inp = li.querySelector("." + f); inp.value = it[f] || ""; inp.oninput = () => { it[f] = inp.value; it.edited = true; if (f === "raga") renderStatus(); }; }
    const ty = li.querySelector(".type"); ty.value = it.type || "kriti"; ty.onchange = () => { it.type = ty.value; it.edited = true; renderStatus(); };
    const choose = s => {
      it.song_id = s.id; it.title = s.title; it.raga = s.raga; it.tala = s.tala || it.tala; it.composer = s.composer; it.edited = true; it.auto = false;
      q.value = s.title; li.querySelector(".raga").value = s.raga; li.querySelector(".tala").value = it.tala; sug.classList.remove("open"); renderStatus();
    };
    const showSug = () => {
      const list = candidates({ ...it, title: q.value }, 8);
      sug.innerHTML = list.map(({ s }) => `<button type="button" data-id="${s.id}">${esc(s.title)}<small>${dots(s.raga, s.tala, s.composer)}</small></button>`).join("")
        + (q.value.trim() ? `<button type="button" data-free="1">Keep “${esc(q.value.trim())}” (not in the Karnatik list)<small>It will still be counted by its title and raga</small></button>` : "");
      sug.classList.toggle("open", !!sug.innerHTML);
      sug.querySelectorAll("button").forEach(b => b.onmousedown = e => {
        e.preventDefault();
        if (b.dataset.free) { it.song_id = null; it.title = q.value.trim(); it.edited = true; sug.classList.remove("open"); renderStatus(); }
        else choose(D.byId.get(Number(b.dataset.id)));
      });
    };
    q.onfocus = showSug;
    q.oninput = () => { it.title = q.value; it.song_id = null; it.edited = true; showSug(); renderStatus(); };
    q.onblur = () => setTimeout(() => sug.classList.remove("open"), 150);
    function renderStatus() {
      const cur = it.song_id ? D.byId.get(it.song_id) : null;
      if (TYPES_NO_SONG.has(it.type) || it.type === "rtp") st.innerHTML = `<span class="ok">✓ ${esc(ty.options[ty.selectedIndex].text)}${it.raga ? " in " + esc(it.raga) : ""}</span>`;
      else if (cur) st.innerHTML = `<span class="pill green">matched</span> <span class="sub">${esc(cur.composer)}${it.auto ? " · picked automatically, please check" : ""}</span>`;
      else {
        const alt = candidates({ ...it, title: q.value }, 3);
        st.innerHTML = `<span class="warn">Not matched yet.</span>` + (alt.length ? ` Did you mean: <span class="chips">${alt.map(({ s }) => `<button type="button" data-id="${s.id}">${dots(s.title, s.raga)}</button>`).join("")}</span>` : "");
        st.querySelectorAll("button").forEach(b => b.onclick = () => choose(D.byId.get(Number(b.dataset.id))));
      }
    }
    renderStatus();
    li.querySelector(".up").onclick = () => { if (i) { [S.items[i - 1], S.items[i]] = [S.items[i], S.items[i - 1]]; drawRows(S); } };
    li.querySelector(".down").onclick = () => { if (i < S.items.length - 1) { [S.items[i + 1], S.items[i]] = [S.items[i], S.items[i + 1]]; drawRows(S); } };
    li.querySelector(".del").onclick = () => { S.items.splice(i, 1); drawRows(S); };
    ol.append(li);
  });
}
async function confirmSubmit(S) {
  const msg = $("#cmsg"), items = S.items.filter(it => (it.title || "").trim() || it.song_id || TYPES_NO_SONG.has(it.type) || it.type === "rtp");
  if (!items.length) { msg.textContent = "Add at least one song."; return; }
  const unmatched = items.filter(it => !it.song_id && !TYPES_NO_SONG.has(it.type) && it.type !== "rtp").length;
  if (unmatched && !S.warned) { S.warned = true; msg.textContent = `${unmatched} song${unmatched > 1 ? "s are" : " is"} not matched to the Karnatik list. Press Confirm again to share anyway.`; return; }
  if (!API) { msg.textContent = "The site isn't connected to its server yet."; return; }
  const btn = $("#confirm"); btn.disabled = true; msg.textContent = "Sharing…";
  try {
    await post("/api/submit", { concert_id: S.concert.id, client_id: clientId(), used_photo: S.usedPhoto, ocr_items: S.ocr || [],
      items: items.map(it => ({ song_id: it.song_id, title: it.title, raga: it.raga, tala: it.tala, composer: it.composer, type: it.type, notes: it.notes, written: it.written, edited: !!it.edited })) });
    D.counts[S.concert.id] = (D.counts[S.concert.id] || 0) + 1;
    app.innerHTML = `<h1>Thank you!</h1>${steps(4)}<div class="card"><p>Your list of <b>${items.length}</b> item${items.length > 1 ? "s" : ""} for <b>${esc(S.concert.artist)}</b> at ${esc(sabhaName(S.concert.sabha_id))} has been shared.</p>
      <p class="sub">Lists from all rasikas at this concert are combined every night. If you share again for the same concert, your new list replaces this one.</p>
      <div class="actions"><a class="btn primary" href="#/submit">Share another concert</a><a class="btn" href="#/concert/${encodeURIComponent(S.concert.id)}">View this concert</a><a class="btn" href="#/">Season view</a></div></div>`;
  } catch (e) { msg.textContent = e.message; btn.disabled = false; }
}
})();
