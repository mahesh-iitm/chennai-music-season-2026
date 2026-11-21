// Chennai Music Season 2026 - Cloudflare Worker
// Handles: handwriting OCR (via Anthropic vision API, key kept secret here),
// storing confirmed song lists in D1, rasika-added concerts, and a private export
// used by the nightly GitHub Action that runs the majority vote.

const OCR_PROMPT = `You are reading a rasika's handwritten (or typed) notes of the songs performed at one Carnatic music concert in the Chennai December Season.

Transcribe EVERY item in the order written. For each item return what is written, and where you are confident, the standard full name.
Rasikas abbreviate heavily: e.g. "Endaro - Sri" = Endaro Mahanubhavulu in Sri raga; "RTP" or "R-T-P" = Ragam Tanam Pallavi; "Tani" = Tani Avartanam; "Kal" = Kalyani; "Thodi"/"Todi"; "Sank" = Shankarabharanam; "Adi"/"Rupakam"/"M.Chapu"/"K.Chapu" are talas. Lines may be in English, Tamil, Telugu, Kannada or Sanskrit script; transliterate titles into simple English letters.
Mark items like alapana-only, viruttam, slokam, tani avartanam, thillana, javali, padam, bhajan, tukkada, mangalam with the matching "type".

Return ONLY a JSON object, no prose, in exactly this shape:
{"items":[{"pos":1,"written":"<exactly as written>","title":"<song title, expanded if confident>","raga":"<raga or empty>","tala":"<tala or empty>","composer":"<composer or empty>","type":"<kriti|varnam|rtp|viruttam|tani|thillana|javali|padam|bhajan|tukkada|mangalam|other>","notes":"<e.g. 'main', 'alapana', 'niraval at ...', 'swaram' or empty>","confidence":<0.0-1.0>}],
 "header":{"artist":"<if written>","date":"<if written>","sabha":"<if written>","accompanists":"<if written>"},
 "unreadable":"<anything you could not read>"}
If the image is not a song list, return {"items":[],"header":{},"unreadable":"not a song list"}.`;

const MAX_IMAGE_B64 = 7_000_000;   // ~5 MB image
const MAX_ITEMS = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const route = `${request.method} ${url.pathname}`;
      let res;
      switch (route) {
        case "GET /api/health":            res = json({ ok: true }); break;
        case "POST /api/ocr":              res = await ocr(request, env); break;
        case "POST /api/submit":           res = await submit(request, env); break;
        case "POST /api/concert":          res = await addConcert(request, env); break;
        case "GET /api/concert-additions": res = await listAdditions(env); break;
        case "GET /api/counts":            res = await counts(env); break;
        case "GET /api/export":            res = await exportAll(request, env); break;
        case "GET /api/subscribers":       res = await listSubscribers(request, env); break;
        case "GET /api/whatsapp/webhook":  return verifyWebhook(url, env);
        case "POST /api/whatsapp/webhook": return await whatsappWebhook(request, env, ctx);
        default:                           res = json({ error: "not found" }, 404);
      }
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.expose ? e.message : "server error" }, status, cors);
    }
  },
};

// ---------- helpers ----------
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
}
function fail(msg, status = 400) { const e = new Error(msg); e.status = status; e.expose = true; throw e; }
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? (origin || "*") : allowed[0],
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "origin",
  };
}
async function body(request, max = 8_000_000) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) fail("request too large", 413);
  try { return await request.json(); } catch { fail("invalid JSON"); }
}
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const today = () => new Date().toISOString().slice(0, 10);
async function ipHash(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const data = new TextEncoder().encode(ip + "|" + (env.IP_SALT || "salt"));
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function bump(env, key, limit) {
  // atomic-ish daily counter; returns false when over limit
  const day = today();
  await env.DB.prepare("INSERT INTO usage(day,key,count) VALUES(?,?,1) ON CONFLICT(day,key) DO UPDATE SET count=count+1")
    .bind(day, key).run();
  const row = await env.DB.prepare("SELECT count FROM usage WHERE day=? AND key=?").bind(day, key).first();
  return (row?.count || 0) <= limit;
}
async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET) return true;            // optional bot check
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", request.headers.get("cf-connecting-ip") || "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return (await r.json()).success === true;
}
const CONCERT_ID = /^[a-z0-9-]{3,60}-\d{4}-\d{2}-\d{2}-\d{4}(-[a-z0-9]{1,12})?$/;

// ---------- OCR ----------
async function ocr(request, env) {
  const b = await body(request);
  if (!(await verifyTurnstile(b.turnstile, request, env))) fail("bot check failed", 403);
  const img = String(b.image || "");
  const mt = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(b.media_type) ? b.media_type : "image/jpeg";
  if (!img || img.length > MAX_IMAGE_B64) fail("image missing or too large (max ~5 MB)");
  const ip = await ipHash(request, env);
  if (!(await bump(env, "ocr:all", Number(env.OCR_DAILY_LIMIT || 400)))) fail("Daily reading limit reached. Please try again tomorrow, or type the list in by hand.", 429);
  if (!(await bump(env, "ocr:" + ip, Number(env.OCR_PER_IP_LIMIT || 15)))) fail("You've reached today's limit for photo reading. You can still type the list by hand.", 429);

  const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.MODEL || "claude-sonnet-5-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mt, data: img } },
        { type: "text", text: OCR_PROMPT },
      ] }],
    }),
  });
  if (!r.ok) { console.log("anthropic error", r.status, await r.text()); fail("The handwriting reader is busy. Please try again in a minute.", 502); }
  const out = await r.json();
  const text = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const parsed = parseJsonLoose(text) || { items: [], header: {}, unreadable: "could not parse reader output" };
  parsed.items = (parsed.items || []).slice(0, MAX_ITEMS).map((it, i) => ({
    pos: i + 1,
    written: clip(it.written, 200), title: clip(it.title, 200), raga: clip(it.raga, 80), tala: clip(it.tala, 60),
    composer: clip(it.composer, 80), type: clip(it.type, 20) || "kriti", notes: clip(it.notes, 200),
    confidence: Math.max(0, Math.min(1, Number(it.confidence) || 0)),
  }));
  return json(parsed);
}
function parseJsonLoose(t) {
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// ---------- submissions ----------
function cleanItems(items) {
  if (!Array.isArray(items) || items.length === 0) fail("song list is empty");
  return items.slice(0, MAX_ITEMS).map((it, i) => ({
    pos: i + 1,
    song_id: Number.isInteger(it.song_id) ? it.song_id : null,
    title: clip(it.title, 200), raga: clip(it.raga, 80), tala: clip(it.tala, 60), composer: clip(it.composer, 80),
    type: clip(it.type, 20) || "kriti", notes: clip(it.notes, 200), written: clip(it.written, 200),
    edited: !!it.edited,
  }));
}
async function submit(request, env) {
  const b = await body(request, 200_000);
  const concert_id = String(b.concert_id || "");
  if (!CONCERT_ID.test(concert_id)) fail("unknown concert");
  const items = cleanItems(b.items);
  const ip = await ipHash(request, env);
  if (!(await bump(env, "submit:" + ip, Number(env.SUBMIT_PER_IP_LIMIT || 30)))) fail("Too many submissions today from this connection.", 429);
  const client = clip(b.client_id, 40) || ip;
  const id = crypto.randomUUID();
  // one live submission per rasika (browser) per concert: a resubmit replaces the earlier one
  await env.DB.batch([
    env.DB.prepare("UPDATE submissions SET superseded=1 WHERE concert_id=? AND client_id=? AND superseded=0").bind(concert_id, client),
    env.DB.prepare("INSERT INTO submissions(id,concert_id,client_id,ip_hash,created_at,items_json,ocr_json,display_name,used_photo) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, concert_id, client, ip, new Date().toISOString(), JSON.stringify(items),
            JSON.stringify(Array.isArray(b.ocr_items) ? b.ocr_items.slice(0, MAX_ITEMS) : []),
            clip(b.display_name, 60), b.used_photo ? 1 : 0),
  ]);
  return json({ ok: true, id });
}

// ---------- rasika-added concerts ----------
async function addConcert(request, env) {
  const b = await body(request, 20_000);
  const sabha_id = clip(b.sabha_id, 60).toLowerCase();
  const date = clip(b.date, 10), time = clip(b.time, 5), artist = clip(b.artist, 120).trim();
  if (!/^[a-z0-9-]{3,60}$/.test(sabha_id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || artist.length < 2) fail("please fill sabha, date, time and artist");
  const ip = await ipHash(request, env);
  if (!(await bump(env, "concert:" + ip, 20))) fail("Too many concerts added today.", 429);
  const slug = artist.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 12) || "x";
  const id = `${sabha_id}-${date}-${time.replace(":", "")}-${slug}`;
  await env.DB.prepare("INSERT OR IGNORE INTO added_concerts(id,sabha_id,date,time,artist,accompanists,created_at,ip_hash) VALUES(?,?,?,?,?,?,?,?)")
    .bind(id, sabha_id, date, time, artist, clip(b.accompanists, 200), new Date().toISOString(), ip).run();
  return json({ ok: true, id });
}
async function listAdditions(env) {
  const { results } = await env.DB.prepare("SELECT id,sabha_id,date,time,artist,accompanists FROM added_concerts WHERE hidden=0 ORDER BY date,time").all();
  return json({ concerts: results }, 200, { "cache-control": "public, max-age=60" });
}
async function counts(env) {
  const { results } = await env.DB.prepare("SELECT concert_id, COUNT(*) n FROM submissions WHERE superseded=0 GROUP BY concert_id").all();
  return json(Object.fromEntries(results.map(r => [r.concert_id, r.n])), 200, { "cache-control": "public, max-age=60" });
}

// ---------- private export for the nightly Action ----------
async function exportAll(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!env.EXPORT_TOKEN || auth !== `Bearer ${env.EXPORT_TOKEN}`) fail("unauthorised", 401);
  const subs = (await env.DB.prepare("SELECT id,concert_id,client_id,created_at,items_json,used_photo FROM submissions WHERE superseded=0 ORDER BY created_at").all()).results;
  const added = (await env.DB.prepare("SELECT id,sabha_id,date,time,artist,accompanists,created_at FROM added_concerts WHERE hidden=0").all()).results;
  return json({
    exported_at: new Date().toISOString(),
    submissions: subs.map(s => ({ id: s.id, concert_id: s.concert_id, rasika: s.client_id, created_at: s.created_at, used_photo: !!s.used_photo, items: JSON.parse(s.items_json) })),
    added_concerts: added,
  });
}

// ---------- WhatsApp nightly summary: sign-up by message ----------
// Rasikas tap a wa.me link that opens WhatsApp with "JOIN" typed in. Sending it
// proves they own the number and are opting in. "STOP" unsubscribes.
async function ensureSubscribers(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscribers (
    wa_id TEXT PRIMARY KEY, name TEXT, status TEXT NOT NULL, joined_at TEXT, updated_at TEXT)`).run();
}
function verifyWebhook(url, env) {
  const ok = url.searchParams.get("hub.mode") === "subscribe" && env.WHATSAPP_VERIFY_TOKEN &&
             url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
  return new Response(ok ? url.searchParams.get("hub.challenge") || "" : "forbidden", { status: ok ? 200 : 403 });
}
async function hmacHex(secret, raw) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, raw);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function whatsappWebhook(request, env, ctx) {
  const raw = await request.arrayBuffer();
  if (env.WHATSAPP_APP_SECRET) {
    const got = (request.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
    if (got !== await hmacHex(env.WHATSAPP_APP_SECRET, raw)) return new Response("bad signature", { status: 401 });
  }
  let body; try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("ok"); }
  const work = [];
  for (const e of body.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {};
    const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name || ""]));
    for (const m of v.messages || []) {
      const text = (m.text?.body || m.button?.text || m.interactive?.button_reply?.title || "").trim().toUpperCase();
      work.push(handleCommand(env, m.from, names[m.from] || "", text));
    }
  }
  ctx.waitUntil(Promise.all(work).catch(err => console.log("webhook error", err)));
  return new Response("ok");                       // Meta expects a fast 200
}
const JOIN = /^(JOIN|START|SUBSCRIBE|YES)\b/, STOP = /^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)\b/;
async function handleCommand(env, waId, name, text) {
  if (!/^\d{8,15}$/.test(waId)) return;
  await ensureSubscribers(env);
  const now = new Date().toISOString();
  let reply = null;
  if (JOIN.test(text)) {
    await env.DB.prepare(`INSERT INTO subscribers(wa_id,name,status,joined_at,updated_at) VALUES(?,?,'active',?,?)
      ON CONFLICT(wa_id) DO UPDATE SET status='active', name=excluded.name, updated_at=excluded.updated_at`).bind(waId, name.slice(0, 60), now, now).run();
    reply = "Welcome! 🎶 You'll get the Margazhi Song Lists summary every morning of the Season: what was sung where, the most-heard ragas and rare gems. Reply STOP any time to unsubscribe.";
  } else if (STOP.test(text)) {
    await env.DB.prepare("UPDATE subscribers SET status='stopped', updated_at=? WHERE wa_id=?").bind(now, waId).run();
    reply = "You're unsubscribed from the Margazhi Song Lists summary. Reply JOIN to subscribe again.";
  }
  if (reply && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) {
    const r = await fetch(`https://graph.facebook.com/${env.GRAPH_VERSION || "v23.0"}/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST", headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: waId, type: "text", text: { body: reply } }),
    });
    if (!r.ok) console.log("reply failed", r.status, await r.text());
  }
}
async function listSubscribers(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!env.EXPORT_TOKEN || auth !== `Bearer ${env.EXPORT_TOKEN}`) fail("unauthorised", 401);
  await ensureSubscribers(env);
  const { results } = await env.DB.prepare("SELECT wa_id FROM subscribers WHERE status='active'").all();
  return json({ subscribers: results.map(r => r.wa_id) });
}
