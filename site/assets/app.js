const $ = id => document.getElementById(id);
// CSP: no inline handlers. A link-card image that fails to load removes its card (was onerror="this.parentNode.remove()").
document.addEventListener("error", e => { if (e.target instanceof HTMLImageElement && e.target.hasAttribute("data-drop-parent")) e.target.parentNode?.remove(); }, true);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const WEEK = "日月火水木金土";
// ---------- the page's words ----------
// Japanese only: myradio's language machinery is gone. Words that never change are in index.html.
const UI = { share: "共有", copied: "コピーしました", resumeAt: t => `${t} から続きを再生`, from0: "最初から", heard: "聞いた", partway: t => `途中 ${t}`, rate: "再生速度", wxHere: "現在地", wxNoGeo: "位置情報が使えませんでした", wxPrompt: "右上から場所を選ぶと、天気が出ます", wxChoose: "場所を選ぶ", wxUseHere: "現在地にする", wxHi: "最高", wxLo: "最低", wxRain: "降水", copyHint: "押すとコピー", news: "TOPICS", jump: "この話題へ", bye: "またあした！", related: "関連記事",
        notFound: c => `リンク先が見つかりませんでした（${c}）`, source: "出典", expired: "この回の音声は公開が終わりました", loading: "読み込み中…", empty: "まだ放送がありません",
        sep: "・", colon: "：" };
const tr = k => UI[k];
const info = e => e.ja;   // {title, seconds} of an episodes.json entry
const dateJp = d => { const t = new Date(d + "T00:00:00"); return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日（${WEEK[t.getDay()]}）`; };
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PLAY = '<path d="M0 0v12l10-6z"/>', PAUSE = '<path d="M0 0h3.5v12H0zM6.5 0H10v12H6.5z"/>';
const audio = $("audio");
let ep = null, speech = [], curPart = -1;

// ---------- the stage follows the page width ----------
// a phone held upright: the upright stage (html.v), the date under the player, and, scrolled down past
// the player, the usual 16:9 stage docked at the top (html.dock)
const PHONE = matchMedia("(orientation:portrait) and (max-width:820px)");
let docked = false, uprightH = 0;
function phoneLayout() {
  const root = document.documentElement;
  root.classList.toggle("phone", PHONE.matches);
  if (!PHONE.matches && docked) { docked = false; root.classList.remove("dock"); }
  root.classList.toggle("v", PHONE.matches && !docked);
  // the episode picker: under the player on a phone, in the stage's header otherwise
  if (PHONE.matches) $("mnav").append($("epsel"));
  else if ($("epsel").parentNode !== document.querySelector(".brand")) document.querySelector(".brand").append($("epsel"));
}
function dockCheck() {
  if (!PHONE.matches) return;
  const root = document.documentElement;
  const place = (docked ? $("dockSpace") : $("frame")).getBoundingClientRect();
  if (!docked) uprightH = place.height;
  // docked once what is left of it on screen is no taller than the docked player (a little give on the way back)
  const want = place.top + uprightH < root.clientWidth * 9 / 16 + (docked ? 24 : 0);
  if (want === docked) return;
  docked = want;
  $("dockSpace").style.height = uprightH + "px";
  root.classList.add("swap");   // the other stage at once: no gliding from the old places
  root.classList.toggle("dock", docked);
  root.classList.toggle("v", !docked);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("swap")));
}
PHONE.addEventListener("change", () => { phoneLayout(); dockCheck(); });
addEventListener("scroll", dockCheck, { passive: true });
phoneLayout();
new ResizeObserver(([e]) => { $("stage").style.transform = `scale(${e.contentRect.width / $("stage").offsetWidth})`; }).observe($("frame"));

// ---------- her ----------
// the character pack (character/character.json):
//   "sprites" a base image with small mouth / eye images laid on it, drawn through WebGL: a depth map turns the head a
//             little toward the pointer, the body breathes and the back hair sways (a pseudo Live2D)
let CHAR = { type: "sprites", background: "#161a26" };   // Tám Radio: sprites only (the clip type was removed)
// Tám Radio: the pack lives in character/<outfit>/ when character/character.json is an outfit index
let CHAR_DIR = "character/", OUTFITS = null, curOutfit = null, outfitTok = 0;
const CHAR_BASE = { ...CHAR };
const charUrl = f => CHAR_DIR + f;
// JSON is fetched with cache "no-cache": always revalidated (a rebuilt episode shows at once), but unchanged files
// come back as 304 instead of a full download
async function loadCharacter() {
  let j = null;
  try { j = await (await fetch("character/character.json", { cache: "no-cache" })).json(); } catch {}
  // the outfit index; the episode picks the outfit when it loads (loading the default here too fetched two outfits)
  if (j?.outfits) OUTFITS = j;
}
// the day's outfit: load that pack and redraw; the same outfit again does nothing; a later call wins over an earlier one
async function setOutfit(id) {
  if (!OUTFITS) return;
  if (!OUTFITS.outfits[id]) id = OUTFITS.default;
  if (id === curOutfit) return;
  const tok = ++outfitTok, pack = OUTFITS.outfits[id].pack, dir = "character/" + pack.replace(/[^/]*$/, "");
  const j = await (await fetch("character/" + pack, { cache: "no-cache" })).json();
  if (tok !== outfitTok) return;
  CHAR = { ...CHAR_BASE, ...j }; CHAR_DIR = dir; curOutfit = id;
  document.documentElement.style.setProperty("--cam", CHAR.background);
  document.documentElement.dataset.outfit = id;
  await initSprites(tok);
}
// ---------- her as sprites ----------
const SP = { ready: false, key: "", look: [0, 0], pointer: null, pointerAt: -1e9, nextBlink: 0, blinkAt: -1e9, mouth: 0, mouthAt: 0 };
document.addEventListener("pointermove", e => {
  const r = $("cam").getBoundingClientRect();
  SP.pointer = [Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))),
                Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * .35)) / (r.height / 2)))];
  SP.pointerAt = performance.now();
});
const MOUTH_HOLD = 80;    // ms a mouth shape is held at least: faster changes read as chattering
const VERT = "attribute vec2 p; varying vec2 v; void main(){ v = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }";
const FRAG = `precision mediump float;
uniform sampler2D col, dep; uniform vec2 look; uniform float t, hasDep; uniform vec3 bg; varying vec2 v;
void main() {
  vec2 uv = v;
  float d = hasDep > .5 ? texture2D(dep, uv).r : .5;
  uv.y += sin(t * 1.7) * .0035 * smoothstep(.45, 1., uv.y);                      // breathing: the body rises a little
  // the head turns: nearer parts move more. Each pixel is taken from where it came from, found by stepping from near to
  // far until the depth there is reached, so the outline of the face moves with what is inside it (a mouth stays on the face)
  if (hasDep > .5) {
    vec2 off = look * .045, prev = uv - off * .55; float zp = 1., dp = texture2D(dep, prev).r;
    for (int i = 1; i <= 24; i++) {
      float z = 1. - float(i) / 24.; vec2 q = uv - off * (z - .45); float dq = texture2D(dep, q).r;
      if (dq >= z || i == 24) { float a = (zp - dp) / max((zp - dp) + (dq - z), 1e-4); d = mix(dp, dq, a); uv -= off * (mix(zp, z, a) - .45); break; }
      zp = z; dp = dq;
    }
  } else uv -= look * (d - .45) * .045;
  // Tám Radio: a ray that only meets depth below .25 met the soft edge of the depth map, not the
  // character (whose depth starts at about .34): it is background. Drawing it moved the black outline outward as a
  // ghost line ("black shadow"); it is left empty, and it does not sway
  bool bgHit = hasDep > .5 && d < .25;
  float hair = hasDep > .5 && !bgHit ? smoothstep(.42, .16, d) * smoothstep(.25, .95, uv.y) : 0.;   // back hair (far in depth)
  uv.x += sin(t * 1.25 + uv.y * 4.) * .006 * hair;                               // sways, more toward the tips
  vec4 c = bgHit ? vec4(0.) : texture2D(col, uv);                               // premultiplied
  gl_FragColor = vec4(c.rgb + bg * (1. - c.a), 1.);
}`;
// an image of the character; one retry, since a busy server can drop one of the many small requests
const loadImg = (src, tries = 2) => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = charUrl(src); })
  .catch(e => tries > 1 ? loadImg(src, tries - 1) : Promise.reject(e));
async function initSprites(tok) {
  const [w, h] = CHAR.size;
  // load everything first, then swap in one go, so the old outfit stays on screen until the new one is ready
  const base = await loadImg(CHAR.base);
  const depth = CHAR.depth ? await loadImg(CHAR.depth).catch(() => null) : null;
  const parts = {};
  // a part that does not load is left out (that eye or mouth just does not change), not the whole character
  await Promise.all(Object.entries(CHAR.parts || {}).map(async ([k, p]) => {
    const img = await loadImg(p.src).catch(() => null); if (img) parts[k] = { img, x: p.x, y: p.y }; }));
  if (tok !== undefined && tok !== outfitTok) return;
  SP.base = base; SP.depth = depth; SP.parts = parts; SP.key = null;   // null: the next frame always redraws (an empty layer list is "")
  if (SP.gl) {   // second outfit onward: same canvas and program, new depth texture and background
    const gl = SP.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, SP.depTex);
    if (SP.depth) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, SP.depth);
    gl.uniform1f(gl.getUniformLocation(SP.prog, "hasDep"), SP.depth ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(SP.prog, "bg"), ...CHAR.background.match(/\w\w/g).map(x => parseInt(x, 16) / 255));
    SP.ready = true;
    return;
  }
  SP.comp = Object.assign(document.createElement("canvas"), { width: w, height: h });
  SP.cx = SP.comp.getContext("2d");
  const cv = $("charcv"); cv.width = w; cv.height = h; cv.hidden = false;
  const gl = SP.gl = cv.getContext("webgl", { alpha: false, antialias: false });
  if (gl) {
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const pr = SP.prog = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit, img) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      return t;
    };
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    SP.colTex = tex(0, null); SP.depTex = tex(1, SP.depth);
    gl.uniform1i(gl.getUniformLocation(pr, "col"), 0); gl.uniform1i(gl.getUniformLocation(pr, "dep"), 1);
    gl.uniform1f(gl.getUniformLocation(pr, "hasDep"), SP.depth ? 1 : 0);
    const bg = CHAR.background.match(/\w\w/g).map(x => parseInt(x, 16) / 255);
    gl.uniform3f(gl.getUniformLocation(pr, "bg"), ...bg);
    SP.u = { look: gl.getUniformLocation(pr, "look"), t: gl.getUniformLocation(pr, "t") };
  }
  SP.ready = true;
}
// which small images lie on the base right now
function compose(layers) {
  const key = layers.join(",");
  if (key === SP.key) return;
  SP.key = key;
  const c = SP.cx; c.clearRect(0, 0, SP.comp.width, SP.comp.height); c.drawImage(SP.base, 0, 0);
  for (const n of layers) { const p = SP.parts[n]; if (p) c.drawImage(p.img, p.x, p.y); }
  if (SP.gl) { const gl = SP.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SP.colTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, SP.comp); }
}
function spriteFrame(t, now, speaking, kind) {
  if (!SP.ready) return;
  // mouth: measured from the voice as it plays; else the episode's precomputed levels; else a simple flap
  let want = 0;
  if (speaking) {
    const lv = ep?.mouth, live = voiceLevel();
    want = live !== null ? live : lv ? +(lv.levels[Math.floor(t * lv.fps)] || 0) : (Math.floor(now / 160) % 3 === 0 ? 1 : 2);
  }
  // change shape only after holding the current one a while, and one step at a time (closed <-> half <-> open)
  if (want !== SP.mouth && now - SP.mouthAt >= MOUTH_HOLD) { SP.mouth += Math.sign(want - SP.mouth); SP.mouthAt = now; }
  const m = SP.mouth;
  // she watches what the viewer is looking at (the link card), wherever the layout has put it: her eyes
  // go there, and so does her body unless the pointer moved lately (then the body turns to the pointer); else she sways a little
  const st = $("stage").classList;
  const watch = st.contains("has-card") ? $("card") : null;
  let gaze = null;
  if (watch) {
    const a = watch.getBoundingClientRect(), c = $("cam").getBoundingClientRect();
    gaze = [(a.x + a.width / 2 - c.x - c.width / 2) / (c.width / 2), (a.y + a.height / 2 - c.y - c.height / 2) / (c.height / 2)]
      .map(v => Math.max(-1, Math.min(1, v)));
  }
  const target = now - SP.pointerAt < 4000 && SP.pointer ? SP.pointer
    : gaze || [Math.sin(now / 2300) * .25, Math.sin(now / 3100) * .15];
  SP.look = SP.look.map((v, i) => v + (target[i] - v) * .07);
  // a blink: half closed, closed, half closed (without a "half" image: closed only); now and then a double blink
  if (now > SP.nextBlink) { SP.blinkAt = now; SP.nextBlink = now + (Math.random() < .15 ? 260 : 2200 + Math.random() * 4000); }
  const bt = now - (SP.blinkAt ?? -1e9), half = CHAR.eye?.half;
  const blinkEye = bt < 40 ? half || CHAR.eye?.blink : bt < 120 ? CHAR.eye?.blink : bt < 170 ? half : null;
  // she smiles for the goodbye: an expression names an eye and / or a mouth image ({eye, mouth}; older packs: [eye, mouth])
  const ex = kind === "closing" ? CHAR.expressions?.smile : null;
  const exEye = Array.isArray(ex) ? ex[0] : ex?.eye, exMouth = Array.isArray(ex) ? ex[1] : ex?.mouth;
  const eye = exEye || blinkEye || (gaze?.[0] < -.4 ? CHAR.eye?.left : gaze?.[0] > .4 ? CHAR.eye?.right : null);
  const mouth = m ? CHAR.mouth?.[m] : exMouth;
  compose([eye, mouth].filter(Boolean));
  if (SP.gl) {
    const gl = SP.gl;
    gl.uniform2f(SP.u.look, SP.look[0], SP.look[1] * .6); gl.uniform1f(SP.u.t, now / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    const c = $("charcv").getContext("2d"); c.fillStyle = CHAR.background; c.fillRect(0, 0, SP.comp.width, SP.comp.height); c.drawImage(SP.comp, 0, 0);
  }
}

// ---------- slides ----------
// a topic, not "news": Tám Radio is not a news site
function partHtml(p) {
  if (p.kind === "opening")
    return `<p class="tag">TODAY</p><p class="big"><i class="logo" aria-hidden="true"></i>${esc(STATION.name)}</p><p class="sub">${esc(STATION.tagline || "")}</p><p class="date"><time datetime="${esc(ep.date)}">${esc(dateJp(ep.date))}</time></p>
      <ol>${ep.news.map((n, j) => `<li data-n="${String(j + 1).padStart(2, "0")}" data-seg="${newsSeg(j)}" data-delay="${0.25 + j * 0.12}">${esc(n.label)}</li>`).join("")}</ol>`;
  if (p.kind === "closing")
    return `<p class="tag">SEE YOU</p><p class="big">${tr("bye")}</p><p class="closing-title">${esc(ep.title)}</p>${pickHtml()}`;
  const n = ep.news[p.index];
  return `<p class="tag">TOPIC ${String(p.index + 1).padStart(2, "0")} / ${String(ep.news.length).padStart(2, "0")}</p>
    <h2>${headCopy(n.label, esc(n.label))}</h2><ul>${n.points.map((x, j) =>
      `<li data-delay="${0.35 + j * 0.45}">${esc(x)}</li>`).join("")}</ul>`;   // points are plain text: no details
}
// the closing shows the image of today's highlight (the script's "highlight": which news the closing picks), linked to it
function pickHtml() {
  const n = ep.news[ep.highlight], l = n?.link;
  if (n?.minor) return "";   // Tám Radio: no photo of a celebrity's child on the end screen
  if (!l?.image || l.status === 404 || l.status === 410) return "";
  return `<a class="pick" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(l.image)}" alt="" referrerpolicy="no-referrer" data-drop-parent><span>${esc(n.label)}<i>↗</i></span></a>`;
}
// a click on a heading copies it, and the show plays on: a topic's heading copies its words (to search for),
// the station's name the address of its repository (station.json "repo")
const headCopy = (text, inner) => text ? `<button class="head" data-copy="${esc(text)}" title="${tr("copyHint")}">${inner}</button>` : inner;
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.append(ta); ta.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { ta.remove(); }
}
$("panel").addEventListener("click", async e => {
  if (e.target.closest("a.pick")) { audio.pause(); return; }
  const b = e.target.closest("button.head"); if (!b) return;
  if (!await copyText(b.dataset.copy)) return;
  b.classList.remove("copied"); void b.offsetWidth; b.classList.add("copied");   // a short flash: copied
  // and a small bubble above the pointer that floats over everything (it moves nothing on the page)
  const t = $("tip"); t.textContent = tr("copied");
  t.style.left = e.clientX + "px"; t.style.top = e.clientY + "px";
  t.classList.remove("go"); void t.offsetWidth; t.classList.add("go");
});
// Tám Radio patch: a subtitle never wraps; when it is wider than the caption area its font shrinks (down to 60 %)
function fitCap() {
  const s = $("cap").firstChild, box = $("cap");
  s.style.fontSize = "";
  if (document.documentElement.classList.contains("v")) return;  // upright phone stage keeps its two-line caption
  const base = parseFloat(getComputedStyle(s).fontSize);
  let f = base;  // nowrap text wider than its box shows as scrollWidth > clientWidth (the box stops at max-width)
  while ((s.scrollWidth > s.clientWidth + 1 || s.offsetWidth > box.clientWidth) && f > base * 0.6) { f -= 1; s.style.fontSize = f + "px"; }
}
// the panel's words shrink a little when they do not fit
function fitPanel() {
  const el = $("panel"), f = el.querySelector(".fit"); if (!f) return;
  let z = 1; f.style.zoom = z;
  while (el.scrollHeight > el.clientHeight + 1 && z > .6) { z -= .04; f.style.zoom = z; }
}
function showPart(i) {
  if (i === curPart) return;
  curPart = i;
  const el = $("panel"); el.innerHTML = `<div class="fit">${partHtml(ep.segments[i])}</div>`;
  // CSP: no inline style attributes; the stagger is set through CSSOM
  el.querySelectorAll("[data-delay]").forEach(x => { x.style.animationDelay = x.dataset.delay + "s"; });
  fitPanel();
  el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  showCard(ep.segments[i].kind === "news" ? ep.news[ep.segments[i].index].link : null);
  document.querySelectorAll("#toc button").forEach(b => b.classList.toggle("cur", +b.dataset.seg === i));
}
// jump to a part of the show (a topic)
const newsSeg = j => ep.segments.findIndex(s => s.kind === "news" && s.index === j);
// while it plays it plays on from there; while it is stopped it only moves there, so the show reads like an article too
function jumpTo(i) {
  const s = ep?.segments[i]; if (!s) return;
  const go = () => { audio.currentTime = s.start; };
  if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, { once: true });
  $("cover").hidden = true;
}
document.addEventListener("click", e => {
  const hit = e.target.closest("[data-seg]");
  if (!hit) return;
  e.preventDefault(); e.stopPropagation();
  jumpTo(+hit.dataset.seg);
  if (hit.closest(".links")) $("frame").scrollIntoView({ behavior: "smooth", block: "nearest" });
}, true);
// the episode picker (the date in the header), and one episode back / forward beside it
let EPS = [];
const epStep = d => { const e = EPS[EPS.findIndex(x => x.date === ep?.date) + d]; if (e) { epOpen(false); audio.pause(); load(e.date); } };
$("epPrev").onclick = () => epStep(1); $("epNext").onclick = () => epStep(-1);
function epOpen(on) {
  $("epsel").classList.toggle("open", on); $("sdate").setAttribute("aria-expanded", on);
  if (on) ($("eplist").querySelector("[aria-selected=true]") || $("eplist").querySelector("[data-date]"))?.focus();
}
$("sdate").onclick = () => epOpen(!$("epsel").classList.contains("open"));
$("eplist").onclick = e => {
  const b = e.target.closest("[data-date]"); if (!b) return;
  epOpen(false); $("sdate").focus();
  if (b.dataset.date !== ep?.date) { audio.pause(); load(b.dataset.date); }
};
$("eplist").onkeydown = e => {
  const opts = [...$("eplist").querySelectorAll("[data-date]")], i = opts.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  else if (e.key === "Escape") { epOpen(false); $("sdate").focus(); }
  else if (e.key === "Enter" || e.key === " ") document.activeElement.click();
  else return;
  e.preventDefault(); e.stopPropagation();
};
document.addEventListener("click", e => { if (!e.target.closest("#epsel")) epOpen(false); });
// a click on the stage away from anything clickable plays or stops, like a video
$("stage").addEventListener("click", e => {
  if (e.target.closest("a, button, [data-seg], #epsel, #wx")) return;
  const play = audio.paused;
  toggle();
  const f = $("flash");
  f.querySelector("svg").innerHTML = play ? PLAY : PAUSE; f.classList.toggle("play", play);
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
});

// Episode links come from news feeds: only https: URLs may become a link or a picture. A link whose page URL is not
// https is dropped as a whole; a bad picture or icon URL is dropped on its own.
const httpsOnly = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
function safeLinks(e) {
  const clean = l => { if (!l || typeof l !== "object" || !httpsOnly(l.url)) return null;
    for (const k of ["image", "icon"]) if (l[k] && !httpsOnly(l[k])) delete l[k];
    return l; };
  for (const n of e?.news || []) {
    if ("link" in n) n.link = clean(n.link);
    if ("source_link" in n) n.source_link = clean(n.source_link);
    if ("url" in n && !httpsOnly(n.url)) delete n.url;
  }
}

function showCard(link) {
  const card = $("card"), stage = $("stage");
  stage.classList.toggle("has-card", !!link);
  if (!link) return;
  const host = (() => { try { return new URL(link.url).hostname; } catch { return ""; } })();
  const missing = link.status === 404 || link.status === 410;
  card.href = link.url;
  card.querySelector(".site").textContent = (link.found_by ? tr("related") + tr("sep") : "") + (link.site || host);
  card.querySelector(".ttl").textContent = missing ? tr("notFound")(link.status) : (link.title || link.url);
  card.querySelector(".ttl").lang = missing ? "ja" : "vi";   // the "not found" notice is Japanese, the headline Vietnamese
  card.querySelector(".desc").textContent = missing ? link.url : (link.description || "");
  // the image, then the site's icon, then text only (the site may move or refuse an image at any time)
  const img = card.querySelector("img");
  const tries = [[link.image, false], [link.icon, true]].filter(([u]) => u);
  const next = () => {
    const t = tries.shift();
    card.classList.toggle("noimg", !t);
    card.classList.toggle("icon", !!t && t[1]);
    img.src = t ? t[0] : "";
  };
  img.onerror = next;
  next();
}
$("card").addEventListener("click", () => audio.pause());

// Tám Radio patch: one sentence per subtitle. A subtitle holding several sentences is shown one sentence at a time,
// each for its share of the line's time (by length).
function capAt(line, t) {
  const parts = (line.show.match(/[^。！？!?]+[。！？!?」』]*/g) || [line.show]).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return line.show;
  const total = parts.reduce((n, x) => n + x.length, 0), f = (t - line.start) / Math.max(0.01, line.end - line.start);
  let acc = 0;
  for (const x of parts) { acc += x.length / total; if (f < acc) return x; }
  return parts[parts.length - 1];
}
// ---------- the clock: everything follows the audio position ----------
function tick(now) {
  const speakingAt = t => !audio.paused && speech.some(([a, b]) => t >= a && t < b);
  spriteFrame(audio.currentTime, now, ep && speakingAt(audio.currentTime), ep?.segments[curPart]?.kind);
  if (ep) {
    const t = audio.currentTime, dur = ep.seconds;
    const part = Math.max(0, ep.segments.findIndex(s => t >= s.start && t < s.end));
    showPart(t >= dur - 0.05 ? ep.segments.length - 1 : part);
    const line = ep.lines_timed.find(l => t >= l.start && t < l.end + 0.3);
    const cap = line ? capAt(line, t) : "";
    if ($("cap").firstChild.textContent !== cap) { $("cap").firstChild.textContent = cap; $("now").textContent = cap; fitCap(); }
    $("bar").firstChild.style.width = (t / dur * 100) + "%";
    if (!seeking) $("seek").value = Math.round(t / dur * 1000);
    $("time").textContent = `${mmss(t)} / ${mmss(dur)}`;
    $("seek").setAttribute("aria-valuetext", `${mmss(t)} / ${mmss(dur)}`);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- controls ----------
let seeking = false;
function toggle() { audio.paused ? audio.play() : audio.pause(); }
$("cover").querySelector(".play").onclick = toggle; $("pp").onclick = toggle;
audio.addEventListener("play", () => { $("cover").hidden = true; $("resume").hidden = true; $("frame").classList.add("playing"); $("ppIcon").innerHTML = PAUSE; });
audio.addEventListener("pause", () => { $("frame").classList.remove("playing"); $("ppIcon").innerHTML = PLAY; });
audio.addEventListener("ended", () => { $("cover").hidden = false; });
// audio is kept for a while only (the script stays): tell the viewer instead of failing silently
audio.addEventListener("error", () => { if (ep) $("loading").textContent = tr("expired"); });
$("seek").addEventListener("input", () => { seeking = true; audio.currentTime = $("seek").value / 1000 * ep.seconds; });
$("seek").addEventListener("change", () => { seeking = false; });
// playback speed (kept in this browser); the browser keeps the voice's pitch
const RATES = [1, 1.25, 1.5, 0.75];
function setRate(r) {
  audio.playbackRate = audio.defaultPlaybackRate = r;
  $("rate").textContent = r + "×"; $("rate").classList.toggle("on", r !== 1);
  $("rate").ariaLabel = `${tr("rate")} ${r}×`;   // the spoken name contains the visible "1×" (label in name)
  try { localStorage.setItem("rate", r); } catch {}
}
$("rate").onclick = () => setRate(RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length] || 1);
// where the viewer stopped, per episode, and the episodes heard to the end (in this browser only)
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify(v)); } catch { return {}; } };
let curName = null, savedAt = 0;
function savePos(force) {
  if (!ep || !curName || (!force && performance.now() - savedAt < 2000)) return;
  savedAt = performance.now();
  const t = audio.currentTime, pos = store("pos"), heard = store("heard");
  const closing = ep.segments.find(s => s.kind === "closing");
  if (closing && t >= closing.start || audio.ended) { delete pos[curName]; heard[ep.date] = 1; }   // heard to the goodbye
  else if (t > 3) pos[curName] = Math.round(t * 10) / 10;
  store("pos", pos); store("heard", heard);
}
audio.addEventListener("timeupdate", () => { if (!audio.paused) savePos(); });
audio.addEventListener("pause", () => { savePos(true); listEpisodes(); });
audio.addEventListener("ended", () => { savePos(true); listEpisodes(); });
$("from0").onclick = () => { audio.currentTime = 0; $("resume").hidden = true; audio.play(); };
// the lock screen, a headset's buttons, a car: previous / next go by topic
function stepPart(d) {
  if (!ep) return;
  const t = audio.currentTime, i = Math.max(0, ep.segments.findIndex(s => t >= s.start && t < s.end));
  // "previous" a few seconds into a topic goes back to its start, like a music player
  const to = d < 0 && t - ep.segments[i].start > 3 ? i : i + d;
  if (ep.segments[to]) jumpTo(to);
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession, on = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  on("previoustrack", () => stepPart(-1)); on("nexttrack", () => stepPart(1));
  on("seekbackward", e => { audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10)); });
  on("seekforward", e => { audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + (e.seekOffset || 10)); });
  on("seekto", e => { audio.currentTime = e.seekTime; });
  const pos = () => { try { if (audio.duration) ms.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate }); } catch {} };
  ["loadedmetadata", "seeked", "ratechange", "play", "pause"].forEach(ev => audio.addEventListener(ev, pos));
}
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
  if (e.code === "KeyM") setMuted(!SOUND.muted);
});

// ---------- the voice through Web Audio (for the mouth) ----------
// Only for a voice on this site: a voice from another site without CORS would play silent through Web Audio.
// The element itself then stays at full volume; on / off and volume are applied by a gain after the analyser.
const VOICE = { ctx: null, an: null, gain: null, buf: null, ref: -30, db: -60 };
function routeVoice() {
  if (VOICE.ctx || !window.AudioContext) return;
  // not on a touch device (a phone or tablet, upright or turned): a locked screen or a closed browser suspends the
  // Web Audio graph while the element plays on, so the episode ran silent; there the audio plays as itself
  // (lock-screen controls) and the mouth flaps
  if (matchMedia("(pointer:coarse)").matches) return;
  if (new URL(audio.currentSrc || audio.src, location.href).origin !== location.origin) return;
  try {
    const ctx = new AudioContext(), src = ctx.createMediaElementSource(audio);
    VOICE.an = ctx.createAnalyser(); VOICE.an.fftSize = 1024; VOICE.buf = new Float32Array(VOICE.an.fftSize);
    VOICE.gain = ctx.createGain();
    src.connect(VOICE.an); VOICE.an.connect(VOICE.gain); VOICE.gain.connect(ctx.destination);
    VOICE.ctx = ctx;
    audio.muted = false; audio.volume = 1;
    applySound();
  } catch {}
}
audio.addEventListener("play", () => { routeVoice(); VOICE.ctx?.resume(); });
// 0 closed / 1 half / 2 open from the loudness now, against this voice's own loud level (it adapts to any voice)
function voiceLevel() {
  if (!VOICE.an) return null;
  VOICE.an.getFloatTimeDomainData(VOICE.buf);
  let e = 0; for (const v of VOICE.buf) e += v * v;
  const now = 10 * Math.log10(e / VOICE.buf.length + 1e-12);
  VOICE.db += (now - VOICE.db) * (now > VOICE.db ? .6 : .3);   // rises quickly, falls slowly: no flutter
  VOICE.ref = Math.max(VOICE.db, VOICE.ref - .02);   // follows the loud parts, sinks slowly in the quiet
  const db = VOICE.db;
  return db < VOICE.ref - 22 ? 0 : db < VOICE.ref - 5 ? 1 : 2;
}

// ---------- sound on / off and volume (remembered in this browser) ----------
const SOUND_KEY = "monoradio.sound";
const SOUND = { muted: false, volume: 1 };
function applySound() {
  if (VOICE.gain) VOICE.gain.gain.value = SOUND.muted ? 0 : SOUND.volume;
  else { audio.muted = SOUND.muted; audio.volume = SOUND.volume; }
}
const ICON_ON = '<path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>', ICON_OFF = '<path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.6 8.4 15.2 9.8 17.4 12l-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4-2.2-2.2 2.2-2.2-1.4-1.4-2.2 2.2z"/>';
function showSound() {
  applySound();
  const off = SOUND.muted || SOUND.volume === 0;
  $("muteIcon").innerHTML = off ? ICON_OFF : ICON_ON;
  $("mute").setAttribute("aria-label", off ? "音声をオン（M）" : "音声をオフ（M）");
  $("frame").classList.toggle("muted", off);
  $("vol").value = SOUND.muted ? 0 : SOUND.volume;
  try { localStorage.setItem(SOUND_KEY, JSON.stringify(SOUND)); } catch {}
}
function setMuted(m) { SOUND.muted = m; if (!m && SOUND.volume === 0) SOUND.volume = 0.6; showSound(); }
$("mute").onclick = () => setMuted(!SOUND.muted);
$("mutedBadge").onclick = () => setMuted(false);
$("vol").addEventListener("input", () => { SOUND.volume = +$("vol").value; SOUND.muted = SOUND.volume === 0; showSound(); });
try { const s = JSON.parse(localStorage.getItem(SOUND_KEY) || "null"); if (s) { SOUND.volume = s.volume ?? 1; SOUND.muted = !!s.muted; } } catch {}
showSound();

// ---------- episodes ----------
async function load(date) {
  const name = `${date}-ja`;   // file names keep the language (episodes/<date>-ja.json, audio/<date>-ja.mp3)
  savePos(true);   // the episode being left: where it stopped
  ep = await (await fetch(`episodes/${name}.json`, { cache: "no-cache" })).json();
  safeLinks(ep);
  setOutfit(ep.outfit).catch(e => console.warn("outfit", e));   // Tám Radio: the day's outfit
  listEpisodes(); wxRender();
  // speech intervals; short pauses inside a part count as speaking, so her mouth does not flicker shut
  speech = [];
  for (const l of ep.lines_timed) {
    const last = speech[speech.length - 1];
    if (last && l.start - last[1] < 0.45) last[1] = l.end; else speech.push([l.start, l.end]);
  }
  curPart = -1;
  // an episode can be remade under the same name: the made_at stamp keeps the browser from playing a cached older voice
  curName = name;
  audio.src = (ep.audio || `audio/${name}.mp3`) + `?v=${encodeURIComponent(ep.made_at || "")}`;
  $("sdate").querySelector("span").textContent = dateJp(date);
  $("eplist").querySelectorAll("[data-date]").forEach(b => b.setAttribute("aria-selected", b.dataset.date === date));
  const k = EPS.findIndex(e => e.date === date);   // EPS is newest first
  $("epPrev").disabled = k < 0 || k >= EPS.length - 1; $("epNext").disabled = k <= 0;
  // sources: the briefing's own URL (flagged when it does not open), and the related article the card shows instead
  const srcOf = n => n.source_link || (n.link && !n.link.found_by ? n.link : n.url ? { url: n.url } : null);
  const linkLine = (l, label) => { const bad = l.status === 404 || l.status === 410, host = (() => { try { return new URL(l.url).hostname; } catch { return l.url; } })();
    return `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><small>${label}<span lang="vi">${esc(l.site || host)}</span>${bad ? tr("sep") + "⚠ " + tr("notFound")(l.status) : l.title ? tr("sep") + `<span lang="vi">${esc(l.title)}</span>` : ""}</small></a>`; };
  // the news to read: headline (jumps the player there), the points, the sources, the picture
  $("links").innerHTML = `<h2 class="sec" id="topicsH">${tr("news")}</h2>` + ep.news.map((n, j) => {
    const src = srcOf(n), img = n.link?.image && n.link.status !== 404;
    return `<article class="item" aria-label="${esc(n.label)}"><button class="jump" data-seg="${newsSeg(j)}" title="${tr("jump")}"><span class="d">${String(j + 1).padStart(2, "0")}</span><b>${esc(n.label)}</b><i>${mmss(ep.segments[newsSeg(j)]?.start || 0)}</i></button>`
      + (img ? `<a class="pic" href="${esc(n.link.url)}" target="_blank" rel="noopener noreferrer" aria-hidden="true" tabindex="-1"><img src="${esc(n.link.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-drop-parent></a>` : "")
      + `<ul class="pts">${n.points.map((x, k) => `<li><b>${esc(x)}</b></li>`).join("")}</ul>`
      + `<div class="srcs">${src ? linkLine(src, tr("source") + tr("colon")) : ""}${n.link?.found_by ? linkLine(n.link, tr("related") + tr("colon")) : ""}</div></article>`;
  }).join("");
  $("toc").innerHTML = ep.news.map((n, j) =>
    `<button data-seg="${newsSeg(j)}">${String(j + 1).padStart(2, "0")}<span>${esc(n.label)}</span></button>`).join("");
  document.querySelectorAll("#eps a").forEach(a => a.classList.toggle("cur", a.dataset.date === date));
  $("loading").textContent = "";
  $("cover").hidden = false;
  // stopped partway last time: the play button goes on from there
  const back = store("pos")[name];
  $("resume").hidden = !(back > 3 && back < ep.seconds - 3);
  if (!$("resume").hidden) {
    $("resume").querySelector("span").textContent = tr("resumeAt")(mmss(back)); $("from0").textContent = tr("from0");
    const go = () => { audio.currentTime = back; };
    if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, { once: true });
  }
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title, artist: STATION.name, album: dateJp(ep.date) });
  // the newest episode keeps the plain address, so a bookmark or a reload of the top page always opens the newest;
  // only an older episode carries its #<date>
  history.replaceState(null, "", date === EPS[0]?.date ? location.pathname + location.search : `#${date}`);
  // the share button shows when this episode has a share page (made at publish time); station.json "share"
  // turns the probe on
  SHARE = new URL(`share/${name}.html`, location.href).href;
  $("share").hidden = true;
  if (STATION.share) fetch(SHARE, { method: "HEAD", cache: "no-cache" }).then(r => { if (r.ok && SHARE.includes(name)) $("share").hidden = false; }).catch(() => {});
}
// share: a small menu - the phone's share sheet (where there is one), copy the link (no embed code)
let SHARE = "";
const shareMenu = on => { $("shareMenu").hidden = !on; $("share").setAttribute("aria-expanded", on); };
$("share").onclick = () => {
  $("shareMenu").querySelector("[data-act=native]").hidden = !navigator.share;
  shareMenu($("shareMenu").hidden);
};
$("shareMenu").onclick = async e => {
  const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
  shareMenu(false);
  const label = $("share").querySelector("span");
  try {
    if (act === "native") { await navigator.share({ title: `${ep.title} | ${STATION.name}`, url: SHARE }); return; }
    await navigator.clipboard.writeText(SHARE);
    label.textContent = tr("copied"); setTimeout(() => { label.textContent = tr("share"); }, 1800);
  } catch {}
};
document.addEventListener("click", e => { if (!e.target.closest(".sharewrap")) shareMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") shareMenu(false); });
// station.json: the switches and settings the script reads (see loadStation)
let STATION = { name: "Tám Radio" };
// the episode lists (the picker in the header, the list at the bottom)
function listEpisodes() {
  const heard = store("heard"), pos = store("pos");
  const seen = e => heard[e.date] ? [tr("heard"), "done"] : (() => { const t = pos[`${e.date}-ja`];
    return t ? [tr("partway")(mmss(t)), "part"] : null; })();
  $("eps").innerHTML = EPS.map(e => { const s = seen(e);
    return `<a href="#${e.date}" data-date="${e.date}"><time class="d" datetime="${e.date}">${esc(dateJp(e.date))}</time><span>${esc(info(e).title)}</span>${s ? `<span class="seen ${s[1]}">${s[0]}</span>` : ""}<span class="len">${mmss(info(e).seconds)}</span></a>`; }).join("");
  $("eps").querySelectorAll("a").forEach(a => a.onclick = ev => { ev.preventDefault(); audio.pause(); load(a.dataset.date); scrollTo({ top: 0, behavior: "smooth" }); });
  $("eplist").innerHTML = `<div class="hd" role="presentation" aria-hidden="true">EPISODES</div>` + EPS.map(e => { const d = new Date(e.date + "T00:00:00");
    return `<button role="option" data-date="${e.date}" aria-selected="${e.date === ep?.date}"><span class="dt">${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}<small>${"SUN MON TUE WED THU FRI SAT".split(" ")[d.getDay()]}</small></span><span class="tt">${esc(info(e).title)}</span><span class="ln">${mmss(info(e).seconds)}${(s => s ? `<small class="${s[1]}">${s[0]}</small>` : "")(seen(e))}</span></button>`; }).join("");
  document.querySelectorAll("#eps a").forEach(a => a.classList.toggle("cur", a.dataset.date === ep?.date));
}
// ---------- today's weather (station.json "weather": true) ----------
// where: a city guessed from the browser's time zone, until the viewer picks a city or their own area from the list
// (the browser asks for the location only then; the choice is kept in this browser). Forecast: Open-Meteo (no key; CC BY 4.0, credited)
const WX_CITY = [   // [id, lat, lon, name, the time zones it stands for (the first guess)] — Tám Radio: Vietnam only
  ["hanoi", 21.03, 105.85, "ハノイ", ["Asia/Ho_Chi_Minh", "Asia/Saigon"]], ["danang", 16.05, 108.22, "ダナン"],
  ["hochiminh", 10.78, 106.70, "ホーチミン"],
];
const wxCity = c => ({ id: c[0], lat: c[1], lon: c[2], name: c[3] });
const WX_ICON = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  part: '<path d="M8.5 3v1.6M3 8.5h1.6M4.6 4.6l1.1 1.1M12.4 4.6l-1.1 1.1"/><path d="M5.6 10.6a3.2 3.2 0 0 1 6-1.8"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 9 20z"/>',
  cloud: '<path d="M7 19h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 19z"/>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
  snow: '<path d="M7 15h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8 18.5h.01M12 20h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01" stroke-width="2.4"/>',
  storm: '<path d="M7 15h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
};
// WMO weather codes -> an icon and words
function wxKind(code, day = 1) {
  const W = ["快晴", "晴れ", "晴れ時々くもり", "くもり", "霧", "霧雨", "雨", "雪", "にわか雨", "にわか雪", "雷雨"];
  const k = code === 0 ? [day ? "sun" : "moon", 0] : code === 1 ? [day ? "sun" : "moon", 1] : code === 2 ? ["part", 2] : code === 3 ? ["cloud", 3]
    : code <= 48 ? ["fog", 4] : code <= 57 ? ["rain", 5] : code <= 67 ? ["rain", 6] : code <= 77 ? ["snow", 7]
    : code <= 82 ? ["rain", 8] : code <= 86 ? ["snow", 9] : ["storm", 10];
  return { icon: `<svg viewBox="0 0 24 24" aria-hidden="true">${WX_ICON[k[0]]}</svg>`, words: W[k[1]] || "" };   // the words carry the meaning
}
const WX = { at: null, data: null, place: null, msg: null };
// the place chosen in this browser ({id} a city, {lat, lon} the viewer's area), else the city of the browser's time zone
function wxPlace() {
  let mine = null; try { mine = JSON.parse(localStorage.getItem("wx") || "null"); } catch {}
  const c = WX_CITY.find(c => c && c[0] === mine?.id);
  if (c) return wxCity(c);
  if (mine?.id) return wxCity(WX_CITY[0]);   // a city id that is no longer in the list: Hanoi
  if (mine?.lat != null) return { lat: mine.lat, lon: mine.lon, mine: true };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone, g = WX_CITY.find(c => [].concat(c?.[4] || []).includes(tz));   // a zone may come under an alias (Asia/Saigon)
  return g ? wxCity(g) : null;
}
const wxSave = v => { try { localStorage.setItem("wx", JSON.stringify(v)); } catch {} };
async function wxLoad() {
  if (!STATION.weather) return;
  WX.place = wxPlace(); $("wx").hidden = false;
  if (WX.place) {
    const q = `latitude=${WX.place.lat}&longitude=${WX.place.lon}&timezone=auto&forecast_days=1&forecast_hours=13`
      + "&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";
    try { WX.data = await (await fetch("https://api.open-meteo.com/v1/forecast?" + q)).json(); WX.at = Date.now(); } catch { WX.data = null; }
  }
  wxRender();
}
function wxRender() {
  const el = $("wx").querySelector(".body"), d = WX.data, p = WX.place;
  if (!STATION.weather) return;
  const place = p ? (p.mine ? tr("wxHere") : p.name) : tr("wxChoose");
  const head = `<header class="hd">WEATHER<button class="place" aria-haspopup="listbox" aria-expanded="${$("wx").classList.contains("open")}" aria-controls="wxlist"><span>${esc(place)}</span><i></i></button></header>`;
  const foot = `<footer class="ft"><span>${WX.msg ? `<i>${WX.msg}</i>` : ""}</span><span>Open-Meteo</span></footer>`;
  wxList();
  if (!d?.current) { el.innerHTML = `${head}<p class="msg">${tr("wxPrompt")}</p>${foot}`; return; }
  const now = wxKind(d.current.weather_code, d.current.is_day), r = n => Math.round(n), dl = d.daily;
  const hrs = [3, 6, 9, 12].filter(i => d.hourly?.time?.[i]).map(i => {
    const k = wxKind(d.hourly.weather_code[i], d.hourly.is_day[i]);
    return `<li><time datetime="${esc(d.hourly.time[i])}">${d.hourly.time[i].slice(11, 16)}</time>${k.icon}<span class="sr-only">${k.words}</span>${r(d.hourly.temperature_2m[i])}°</li>`;
  }).join("");
  el.innerHTML = `${head}
    <div class="now">${now.icon}<div><p class="t">${r(d.current.temperature_2m)}<small>°C</small></p><p class="c">${now.words}</p></div></div>
    <dl class="hl"><div><dt>${tr("wxHi")}</dt><dd class="hi">${r(dl.temperature_2m_max[0])}°</dd></div><div><dt>${tr("wxLo")}</dt><dd class="lo">${r(dl.temperature_2m_min[0])}°</dd></div>${
      dl.precipitation_probability_max?.[0] != null ? `<div><dt>${tr("wxRain")}</dt><dd>${dl.precipitation_probability_max[0]}%</dd></div>` : ""}</dl>
    <ol class="hrs">${hrs}</ol>${foot}`;
}
// the place list: "your area" first (only then does the browser ask for the location), then the cities
const PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
function wxList() {
  const p = WX.place, opt = c => `<button role="option" data-wx="${c[0]}" aria-selected="${p?.id === c[0]}">${esc(c[3])}</button>`;
  $("wxlist").innerHTML = `<button role="option" class="here" data-wx="here" aria-selected="${!!p?.mine}">${PIN}${tr("wxUseHere")}</button>`
    + `<div class="gh" role="presentation" aria-hidden="true">ベトナム</div>` + WX_CITY.map(opt).join("");
}
function wxOpen(on) {
  $("wx").classList.toggle("open", on); $("wx").querySelector(".place")?.setAttribute("aria-expanded", on);
  if (on) ($("wxlist").querySelector("[aria-selected=true]") || $("wxlist").querySelector("button"))?.focus({ preventScroll: true });
}
$("wx").addEventListener("click", e => {
  if (e.target.closest(".place")) return wxOpen(!$("wx").classList.contains("open"));
  const b = e.target.closest("[data-wx]"); if (!b) return;
  wxOpen(false); $("wx").querySelector(".place")?.focus();
  if (b.dataset.wx !== "here") { wxSave({ id: b.dataset.wx }); WX.msg = null; return wxLoad(); }
  // the viewer's area, rounded to about 1 km and kept in this browser only
  if (!navigator.geolocation) { WX.msg = tr("wxNoGeo"); return wxRender(); }
  navigator.geolocation.getCurrentPosition(pos => {
    const round = v => Math.round(v * 100) / 100;
    wxSave({ lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) }); WX.msg = null; wxLoad();
  }, () => { WX.msg = tr("wxNoGeo"); wxRender(); }, { maximumAge: 3600e3, timeout: 15000 });
});
$("wxlist").addEventListener("keydown", e => {
  const opts = [...$("wxlist").querySelectorAll("button")], i = opts.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  else if (e.key === "Escape") { wxOpen(false); $("wx").querySelector(".place")?.focus(); }
  else return;
  e.preventDefault(); e.stopPropagation();
});
document.addEventListener("click", e => { if (!e.target.closest("#wx")) wxOpen(false); });
setInterval(() => { if (WX.at && Date.now() - WX.at > 30 * 60e3) wxLoad(); }, 60e3);
// the logo, name, tagline and credits are written in index.html and app.css; station.json gives what the script needs
// (weather, share, audio.keep_days, schedule.timezone, name for the media controls)
async function loadStation() {
  try { STATION = { ...STATION, ...(await (await fetch("station.json", { cache: "no-cache" })).json()) }; } catch {}
}
async function init() {
  // the show plays even if the character cannot be drawn
  await Promise.all([loadStation(), loadCharacter().catch(e => console.warn("character", e))]);
  wxLoad();
  let r = 1; try { r = +localStorage.getItem("rate") || 1; } catch {}
  setRate(RATES.includes(r) ? r : 1);
  $("loading").textContent = tr("loading");
  let eps = [];
  try { eps = await (await fetch("episodes.json", { cache: "no-cache" })).json(); } catch {}
  // Tám Radio patch: episodes whose audio has expired (older than station.json audio.keep_days) are not listed
  const keep = STATION.audio?.keep_days;
  if (keep) {
    const tz = STATION.schedule?.timezone || "Asia/Ho_Chi_Minh";
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (keep - 1));
    const firstISO = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-${String(first.getDate()).padStart(2, "0")}`;
    eps = eps.filter(e => e.date >= firstISO);
  }
  if (!eps.length) { setOutfit(OUTFITS?.default).catch(() => {}); $("loading").textContent = tr("empty"); $("cover").hidden = true; return; }
  $("sdate").disabled = eps.length < 2;
  EPS = eps; $("epPrev").hidden = $("epNext").hidden = eps.length < 2;
  const want = location.hash.slice(1);   // #<date>
  // Tám Radio patch: a link to an episode that is not (or no longer) on the site goes to the 404 page
  if (/^\d{4}-\d{2}-\d{2}$/.test(want || "") && !eps.some(e => e.date === want)) { location.replace("404.html"); return; }
  load(eps.some(e => e.date === want) ? want : eps[0].date);
}
init();
