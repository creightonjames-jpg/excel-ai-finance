import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, "us-central1");
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
}
const call = (name, data) => httpsCallable(fns, name)(data || {}).then((r) => r.data);
const SITE = (location.origin + location.pathname).replace(/index\.html$/, "").replace(/\/$/, "");

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === "text") n.textContent = attrs[k];
    else if (k === "html") n.innerHTML = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach((c) => c && n.append(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}
function show(id) { ["screen-loading", "screen-signin", "screen-password", "screen-app"].forEach((s) => ($("#" + s).hidden = s !== id)); }
function msg(box, text, kind) { box.textContent = text; box.className = "msg " + (kind || "no"); box.hidden = !text; }
function errText(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-email")) return "That email and password don't match. Check for typos, or ask your course administrator to reset your password.";
  if (c.includes("user-disabled")) return "Your access is turned off. Contact your course administrator.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  if (c.includes("network")) return "Can't reach the server. Check your connection and try again.";
  return (e && e.message) ? e.message.replace(/^Firebase:\s*/, "").replace(/\s*\(.*\)\.?$/, "") : "Something went wrong. Please try again.";
}

/* ---------------- theme (light by default) ---------------- */
function setTheme(t) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark"); else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("theme", t); } catch (e) {}
  const b = $("#themeBtn"); b.textContent = t === "dark" ? "Light" : "Dark"; b.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
}
setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
$("#themeBtn").addEventListener("click", () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));

/* ---------------- state ---------------- */
let ME = null;        // { uid, name, email, role }
let DATA = null;      // course data
let P = { done: {}, step: {}, quiz: {}, check: {}, finalScore: null, toured: false };
let certName = "";
let saveTimer = null, booted = false, pwMode = "first";

function saveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    updateDoc(doc(db, "users", ME.uid), { progress: P, certName }).catch(() => {});
  }, 600);
}

/* ---------------- auth flow ---------------- */
let seq = 0;
async function enter(user) {
  const my = ++seq;
  show("screen-loading");
  try {
    const r = await call("getCourse");
    await user.getIdToken(true); // pick up admin role if just granted
    if (my !== seq) return;
    ME = { uid: user.uid, name: r.profile.name, email: r.profile.email, role: r.profile.role };
    if (r.profile.mustChangePassword) { openPassword("first"); return; }
    const snap = await getDoc(doc(db, "users", user.uid));
    if (my !== seq) return;
    DATA = r.data;
    const d = snap.exists() ? snap.data() : {};
    P = Object.assign({ done: {}, step: {}, quiz: {}, check: {}, finalScore: null, toured: false }, d.progress || {});
    certName = d.certName || ME.name || "";
    if (booted) { show("screen-app"); route(); } else boot(r.html);
  } catch (e) {
    if (my !== seq) return;
    await signOut(auth);
    show("screen-signin");
    msg($("#siMsg"), e && e.message ? e.message : "We couldn't open your course. Please try again.");
  }
}
onAuthStateChanged(auth, (user) => {
  if (!user) { seq++; ME = null; booted = false; $("#content").innerHTML = ""; show("screen-signin"); setTimeout(() => $("#siEmail").focus(), 50); return; }
  enter(user);
});

$("#signinForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("#siEmail").value.trim(), pass = $("#siPass").value;
  if (!email || !pass) { msg($("#siMsg"), "Enter your email and password."); return; }
  $("#siBtn").disabled = true; msg($("#siMsg"), "");
  try { await signInWithEmailAndPassword(auth, email, pass); $("#siPass").value = ""; }
  catch (e) { msg($("#siMsg"), errText(e)); }
  finally { $("#siBtn").disabled = false; }
});

/* ---------------- password screen ---------------- */
function openPassword(mode) {
  pwMode = mode;
  $("#pwTitle").textContent = mode === "first" ? "Choose your password" : "Change your password";
  $("#pwIntro").textContent = mode === "first" ? `Welcome${ME && ME.name ? ", " + ME.name.split(" ")[0] : ""}! Replace your starter password with one only you know.` : "Pick a new password for your account.";
  $("#pwCancel").hidden = mode === "first";
  $("#pw1").value = ""; $("#pw2").value = ""; msg($("#pwMsg"), ""); checkRules();
  show("screen-password"); setTimeout(() => $("#pw1").focus(), 50);
}
function checkRules() {
  const a = $("#pw1").value, b = $("#pw2").value;
  const r = { len: a.length >= 10, mix: /[A-Za-z]/.test(a) && /\d/.test(a), same: a.length > 0 && a === b };
  $$("#pwRules li").forEach((li) => li.classList.toggle("met", !!r[li.dataset.r]));
  return r.len && r.mix && r.same;
}
$("#pw1").addEventListener("input", checkRules); $("#pw2").addEventListener("input", checkRules);
$("#pwCancel").addEventListener("click", () => show("screen-app"));
$("#pwSignout").addEventListener("click", () => signOut(auth));
$("#pwForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!checkRules()) { msg($("#pwMsg"), "Your new password needs to meet all three rules."); return; }
  const pw = $("#pw1").value;
  $("#pwBtn").disabled = true; msg($("#pwMsg"), "");
  try {
    await call("changeMyPassword", { password: pw });
    const email = auth.currentUser.email;
    await signInWithEmailAndPassword(auth, email, pw);
    if (pwMode === "first") { await enter(auth.currentUser); toast("Password saved. Welcome!"); }
    else { show("screen-app"); toast("Password updated."); }
  } catch (e) { msg($("#pwMsg"), errText(e)); }
  finally { $("#pwBtn").disabled = false; }
});

/* ---------------- account menu ---------------- */
const acctBtn = $("#acctBtn"), acctMenu = $("#acctMenu");
acctBtn.addEventListener("click", (e) => { e.stopPropagation(); acctMenu.hidden = !acctMenu.hidden; acctBtn.setAttribute("aria-expanded", String(!acctMenu.hidden)); });
document.addEventListener("click", (e) => { if (!acctMenu.hidden && !acctMenu.contains(e.target)) { acctMenu.hidden = true; acctBtn.setAttribute("aria-expanded", "false"); } });
$("#changePwBtn").addEventListener("click", () => { acctMenu.hidden = true; openPassword("change"); });
$("#signoutBtn").addEventListener("click", () => { acctMenu.hidden = true; signOut(auth); });
$("#adminLink").addEventListener("click", () => { acctMenu.hidden = true; });

/* mobile menu */
function setMenu(open) { $("#side").classList.toggle("open", open); $("#scrim").hidden = !open; $("#menuBtn").setAttribute("aria-expanded", String(open)); }
$("#menuBtn").addEventListener("click", () => setMenu(!$("#side").classList.contains("open")));
$("#scrim").addEventListener("click", () => setMenu(false));

function toast(text) {
  const t = el("div", { class: "msg ok", text, style: "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:90;box-shadow:var(--shadow)" });
  document.body.append(t); setTimeout(() => t.remove(), 2600);
}

/* ---------------- boot the course ---------------- */
function boot(html) {
  booted = true;
  const content = $("#content");
  content.innerHTML = html;
  $$("[data-view]", content).forEach((v) => { v.classList.add("view"); v.hidden = true; });
  content.append(el("section", { "data-view": "admin", class: "view", hidden: "" }));

  $("#whoName").textContent = ME.name || ""; $("#whoEmail").textContent = ME.email || "";
  acctBtn.textContent = (ME.name || ME.email || "?").trim().charAt(0).toUpperCase();
  $("#adminLink").hidden = ME.role !== "admin";
  $$("[data-firstname]").forEach((n) => (n.textContent = firstName()));

  buildVideos(); buildLibrary(); buildPrompts(); buildQuizzes(); buildChecklist(); buildCert(); wireDownloads();
  buildResources(); buildPlayers(); buildNav();
  refreshProgress();
  show("screen-app");
  route();
  if (!P.toured) openTour();
}

const MODS = () => DATA.mods;
const firstName = () => (ME.name || "there").trim().split(" ")[0];
const modNum = (id) => MODS().findIndex((m) => m.id === id) + 1;
const RES_VIEWS = ["resources", "library", "checklist", "videos", "certificate"];

/* sidebar: Home, the seven modules with their status, then Resources */
function buildNav() {
  const nc = $("#navCourse"); nc.innerHTML = "";
  nc.append(el("a", { href: "#home", "data-nav": "home" }, [el("span", { class: "dot" }, [el("span", { text: "⌂" })]), "Home"]));
  MODS().forEach((m, i) => nc.append(el("a", { href: "#" + m.id, "data-nav": m.id, "data-mod": m.id }, [
    el("span", { class: "dot" }, [el("span", { text: String(i + 1) })]),
    el("span", {}, [m.name, el("span", { class: "sub", "data-sub": m.id })])
  ])));
  $$(".nav a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
}
function nextMod() { return MODS().find((m) => !P.done[m.id]); }
function modStatus(m) {
  if (P.done[m.id]) return "Done";
  const cur = nextMod();
  if (cur && cur.id === m.id) return (P.step[m.id] || 0) > 0 ? "In progress" : "Up next";
  return (P.step[m.id] || 0) > 0 ? "In progress" : m.min + " min";
}
function refreshProgress() {
  const n = MODS().filter((m) => P.done[m.id]).length;
  $("#pLabel").textContent = `${n} of 7 done`; $("#pFill").style.width = (n / 7 * 100) + "%";
  $$("[data-mod]").forEach((a) => a.classList.toggle("done", !!P.done[a.dataset.mod]));
  $$("[data-sub]").forEach((s) => (s.textContent = modStatus(MODS().find((m) => m.id === s.dataset.sub))));

  // home: progress ring + one clear next step
  const ring = $("[data-ring]");
  if (ring) { ring.style.setProperty("--p", Math.round(n / 7 * 100)); $("[data-ring-text]").innerHTML = `${n}/7<small>modules</small>`; }
  const next = nextMod(), c = $("[data-continue]");
  if (c) {
    if (next) {
      const i = modNum(next.id), s = P.step[next.id] || 0, total = PLAYERS[next.id] ? PLAYERS[next.id].n : 0, started = s > 0;
      $("[data-next-eyebrow]").textContent = n === 0 && !started ? "Start here" : started ? "Pick up where you left off" : "Next up";
      $("[data-next-title]").textContent = `Module ${i}: ${next.name}`;
      $("[data-next-meta]").textContent = `${next.min} minutes` + (started && total ? ` · step ${Math.min(s + 1, total)} of ${total}` : "");
      c.textContent = (started ? "Continue" : n === 0 ? "Start Module 1" : `Start Module ${i}`) + " →";
      c.href = "#" + next.id;
    } else {
      $("[data-next-eyebrow]").textContent = "All seven modules done";
      $("[data-next-title]").textContent = "Take the final check";
      $("[data-next-meta]").textContent = "Score 80% or higher to get your certificate.";
      c.textContent = "Take the final check →"; c.href = "#certificate";
    }
  }
  const list = $("[data-mods]");
  if (list) {
    list.innerHTML = "";
    MODS().forEach((m, i) => list.append(el("a", { class: "mod" + (P.done[m.id] ? " done" : "") + (next && next.id === m.id ? " current" : ""), href: "#" + m.id }, [
      el("span", { class: "num", text: P.done[m.id] ? "✓" : String(i + 1) }),
      el("span", { class: "t", text: m.name }),
      el("span", { class: "s", text: P.done[m.id] ? "Done" : modStatus(m) === "In progress" ? "In progress" : m.min + " min" })
    ])));
  }
}

/* ---------------- step-by-step modules ---------------- */
const PLAYERS = {};
function buildPlayers() {
  MODS().forEach((m) => {
    const sec = $(`[data-view="${m.id}"]`); if (!sec) return;
    const head = $(".mhead", sec); if (head) head.remove();
    const steps = [];
    Array.from(sec.children).forEach((node) => {
      let kind = null, title = null;
      if (node.classList.contains("lesson")) { kind = "Learn"; const h = $("h2", node); title = h ? h.textContent.trim() : "Learn"; }
      else if (node.classList.contains("callout")) { kind = "Learn"; title = "Before you start"; }
      else if (node.classList.contains("watch")) { if (!node.children.length) { node.remove(); return; } kind = "Watch"; title = "Watch"; }
      else if (node.classList.contains("tryit")) { kind = "Your turn"; title = "Your turn"; }
      else if (node.classList.contains("quiz")) { kind = "Check"; title = "Check yourself"; }
      if (!kind) return;
      const box = el("div", { class: "stepbox", hidden: "" }, [el("span", { class: "kind", text: kind })]);
      node.replaceWith(box); box.append(node);
      steps.push({ kind, title, box });
    });
    const i = modNum(m.id), n = steps.length;
    const count = el("span", { class: "count" });
    const dots = el("div", { class: "steps-dots" }), labels = el("div", { class: "step-labels", "aria-hidden": "true" });
    steps.forEach((s, k) => {
      const b = el("button", { type: "button", "aria-label": `Go to step ${k + 1}: ${s.title}` });
      b.addEventListener("click", () => go(k)); dots.append(b);
      labels.append(el("span", { text: s.title }));
    });
    const bar = el("div", { class: "stepbar" }, [el("div", { class: "row1" }, [el("span", { class: "mt", text: `Module ${i}: ${m.name}` }), count]), dots, labels]);
    const backBtn = el("button", { type: "button", class: "btn" }), mid = el("span", { class: "mid" }), nextBtn = el("button", { type: "button", class: "btn primary big" });
    const pager = el("div", { class: "pager" }, [backBtn, mid, nextBtn]);
    const nm = MODS()[i]; // next module (undefined after M7)
    const doneCard = el("div", { class: "card done-card", hidden: "" }, [
      el("div", { class: "tick", text: "✓" }),
      el("h1", { text: `Module ${i} complete` }),
      el("p", { class: "lead", text: "Nice work. Your progress is saved." }),
      el("div", { class: "actions" }, [
        nm ? el("a", { class: "btn primary big", href: "#" + nm.id, text: `Start Module ${i + 1} →` }) : el("a", { class: "btn primary big", href: "#certificate", text: "Take the final check →" }),
        el("a", { class: "btn", href: "#home", text: "Back to home" })
      ])
    ]);
    const redo = el("button", { type: "button", class: "btn ghost small", text: `Review Module ${i} again` });
    redo.addEventListener("click", () => go(0)); doneCard.append(redo);
    const player = el("div", { class: "player" }, [bar]);
    steps.forEach((s) => player.append(s.box));
    player.append(pager);
    sec.append(player, doneCard);

    function render() {
      let s = P.step[m.id] == null ? (P.done[m.id] ? n : 0) : P.step[m.id];
      const finished = s >= n;
      player.hidden = finished; doneCard.hidden = !finished;
      if (finished) return;
      s = Math.max(0, s);
      steps.forEach((st, k) => (st.box.hidden = k !== s));
      count.textContent = `Step ${s + 1} of ${n}`;
      $$("button", dots).forEach((b, k) => { b.className = k < s ? "done" : k === s ? "on" : ""; if (k === s) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
      $$("span", labels).forEach((l, k) => (l.className = k === s ? "on" : ""));
      backBtn.textContent = s > 0 ? "← Back" : "← Home"; backBtn.className = s > 0 ? "btn" : "btn ghost";
      mid.textContent = s < n - 1 ? "Next: " + steps[s + 1].title : "";
      nextBtn.textContent = s < n - 1 ? "Next →" : "Finish module";
    }
    function go(k) {
      P.step[m.id] = k;
      if (k >= n) P.done[m.id] = true;
      saveProgress(); render(); refreshProgress(); window.scrollTo(0, 0);
    }
    backBtn.addEventListener("click", () => { const s = P.step[m.id] || 0; if (s > 0) go(s - 1); else location.hash = "#home"; });
    nextBtn.addEventListener("click", () => go((P.step[m.id] || 0) + 1));
    PLAYERS[m.id] = { n, render };
  });
}

/* ---------------- resources hub ---------------- */
function buildResources() {
  const count = DATA.library.reduce((a, g) => a + g.items.length, 0);
  const tile = (href, ic, t, d) => el("a", { class: "tile", href }, [el("b", { text: ic }), el("strong", { text: t }), el("span", { text: d })]);
  const sec = el("section", { "data-view": "resources", class: "view", hidden: "" }, [
    el("header", { class: "mhead" }, [el("h1", { text: "Resources" }), el("p", { class: "lead", text: "Handy tools you can come back to anytime." })]),
    el("div", { class: "tiles" }, [
      tile("#library", "✎", "Prompt library", `${count} copy-ready prompts for everyday finance work`),
      tile("#checklist", "☑", "Before you send it", "A quick checklist for any AI-assisted work"),
      tile("#videos", "▶", "Videos and links", "Every course video and the official guides"),
      tile("#certificate", "★", "Final check and certificate", "Finish all seven modules, then score 80% or higher")
    ])
  ]);
  $("#content").append(sec);
}

/* ---------------- welcome tour (first visit only) ---------------- */
let tourAt = 0;
const TOUR = () => [
  ["👋", `Welcome, ${firstName()}`, "This course shows you how to use Claude with Excel for everyday finance work. It takes about 90 minutes, and you can stop and pick up anytime."],
  ["📚", "Seven short modules", "Each module walks you through a few short screens: learn the idea, watch a video, try it yourself, then a quick check. Use Next and Back to move along."],
  ["💾", "Your progress is saved", "Your place is saved to your account, so you can switch computers or come back later. Finish all seven and pass the final check to get your certificate."]
];
function paintTour() {
  const t = TOUR()[tourAt], last = tourAt === TOUR().length - 1;
  const body = $("#tourBody"); body.innerHTML = "";
  body.append(el("div", { class: "big", text: t[0], "aria-hidden": "true" }), el("h1", { id: "tourTitle", text: t[1], style: "font-size:1.5rem" }), el("p", { class: "lead", text: t[2], style: "font-size:1.05rem" }));
  const d = $("#tourDots"); d.innerHTML = ""; TOUR().forEach((_, i) => d.append(el("i", { class: i === tourAt ? "on" : "" })));
  $("#tourNext").textContent = last ? "Let's start" : "Next";
}
function openTour() { tourAt = 0; paintTour(); $("#tour").hidden = false; setTimeout(() => $("#tourNext").focus(), 50); }
function closeTour() { $("#tour").hidden = true; P.toured = true; saveProgress(); }
$("#tourNext").addEventListener("click", () => { if (tourAt < TOUR().length - 1) { tourAt++; paintTour(); } else closeTour(); });
$("#tourSkip").addEventListener("click", closeTour);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#tour").hidden) closeTour(); });

/* routing */
function route() {
  if (!booted) return;
  let id = (location.hash || "#home").slice(1);
  if (id === "admin" && ME.role !== "admin") id = "home";
  if (!$(`[data-view="${id}"]`)) id = "home";
  $$("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== id));
  const navId = RES_VIEWS.includes(id) ? "resources" : id;
  $$(".nav a").forEach((a) => (a.dataset.nav === navId ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (PLAYERS[id]) PLAYERS[id].render();
  window.scrollTo(0, 0);
  if (id === "admin") renderAdmin();
  if (id === "certificate") refreshCert();
}
window.addEventListener("hashchange", route);

/* videos: one recommended video up front, the rest tucked away */
function vCard(v) {
  return el("a", { class: "vid", href: "https://www.youtube.com/watch?v=" + v.id, target: "_blank", rel: "noopener" }, [
    el("span", { class: "play", "aria-hidden": "true" }),
    el("span", { class: "tx" }, [el("span", { class: "tt", text: v.title }), el("span", { class: "mt", text: [v.channel, v.len].filter(Boolean).join(" · ") + (v.why ? ". " + v.why : "") })])
  ]);
}
function buildVideos() {
  $$("[data-videos]").forEach((box) => {
    const list = DATA.videos[box.dataset.videos] || []; if (!list.length) return;
    const must = list.find((v) => v.must) || list[0], rest = list.filter((v) => v !== must);
    box.append(el("h2", { text: "Watch" }), vCard(must));
    if (rest.length) {
      const d = el("details", { class: "more" }, [el("summary", { text: `More videos (${rest.length})` })]);
      const vl = el("div", { class: "vlist" });
      rest.forEach((v) => vl.append(el("a", { href: "https://www.youtube.com/watch?v=" + v.id, target: "_blank", rel: "noopener" }, [el("span", { text: v.title + " (" + v.channel + ")" }), el("span", { text: v.len || "" })])));
      d.append(vl); box.append(d);
    }
  });
  const all = $("[data-allvideos]"); if (!all) return;
  MODS().forEach((m, i) => {
    const vids = DATA.videos[m.id] || [];
    const c = el("div", { class: "card" }, [el("h3", { text: `Module ${i + 1}: ${m.name}` })]);
    const vl = el("div", { class: "vlist" });
    vids.forEach((v) => vl.append(el("a", { href: "https://www.youtube.com/watch?v=" + v.id, target: "_blank", rel: "noopener" }, [el("span", { text: v.title + " (" + v.channel + ")" }), el("span", { text: v.len || "" })])));
    c.append(vl); all.append(c);
  });
  all.style.display = "grid"; all.style.gap = "14px";
}

/* prompts: highlight [placeholders], add copy buttons */
function hl(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\[([^\]]+)\]/g, '<span class="ph">[$1]</span>'); }
function buildLibrary() {
  const box = $("[data-library]"); if (!box) return;
  box.style.display = "grid"; box.style.gap = "22px";
  DATA.library.forEach((g) => {
    const sec = el("div", { style: "display:grid;gap:10px" }, [el("h2", { text: g.cat })]);
    g.items.forEach((it) => sec.append(el("div", { class: "prompt" }, [el("pre", { "data-label": it.title, html: hl(it.text) })])));
    box.append(sec);
  });
}
function buildPrompts() {
  $$(".prompt").forEach((p) => {
    const pre = $("pre", p); if (!pre) return;
    if (!pre.dataset.label) pre.innerHTML = hl(pre.textContent);
    const lbl = $(".label", p);
    const bar = el("div", { class: "bar" }, [el("span", { class: "label", text: pre.dataset.label || (lbl ? lbl.textContent : "Prompt") })]);
    if (lbl) lbl.remove();
    const b = el("button", { type: "button", class: "btn small", text: "Copy" });
    b.addEventListener("click", () => {
      const done = () => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); };
      navigator.clipboard.writeText(pre.textContent).then(done, () => { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = "Press Ctrl+C"; });
    });
    bar.append(b); p.prepend(bar);
  });
}

/* quizzes with answers shuffled consistently */
function order(n, key) {
  let h = 2166136261; for (let c = 0; c < key.length; c++) { h ^= key.charCodeAt(c); h = Math.imul(h, 16777619) >>> 0; }
  const a = [...Array(n).keys()];
  for (let k = n - 1; k > 0; k--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h ^ (h >>> 13)) >>> 0; const r = h % (k + 1); [a[k], a[r]] = [a[r], a[k]]; }
  return a;
}
function finalScore() {
  const r = P.quiz.final, qs = DATA.quiz.final; if (!r || !r.a) return null;
  const k = Object.keys(r.a); if (k.length < qs.length) return null;
  return Math.round(k.filter((i) => r.a[i] === qs[i].a).length / qs.length * 100);
}
function renderQuiz(box) {
  const id = box.dataset.quiz, qs = DATA.quiz[id]; if (!qs) return;
  box.innerHTML = "";
  box.append(el("h2", { text: id === "final" ? "Final check" : "Check yourself" }));
  const rec = P.quiz[id] || (P.quiz[id] = { a: {} });
  if (!rec.a) rec.a = {};
  const score = el("div", { class: "qscore" });
  const upd = () => {
    const ans = Object.keys(rec.a).length, right = Object.keys(rec.a).filter((k) => rec.a[k] === qs[k].a).length;
    score.innerHTML = "";
    score.append(el("span", { text: ans < qs.length ? `${ans} of ${qs.length} answered` : `You got ${right} of ${qs.length} (${Math.round(right / qs.length * 100)}%)` }));
    if (ans) {
      const r = el("button", { type: "button", class: "btn small", text: "Try again" });
      r.addEventListener("click", () => { P.quiz[id] = { a: {} }; if (id === "final") P.finalScore = null; saveProgress(); renderQuiz(box); if (id === "final") refreshCert(); });
      score.append(r);
    }
  };
  qs.forEach((q, i) => {
    const card = el("div", { class: "q" }, [el("div", { class: "qt", text: `${i + 1}. ${q.q}` })]);
    const opts = el("div", { class: "opts" }), fb = el("div", { class: "fb", hidden: "" });
    const paint = () => {
      const pick = rec.a[i]; if (pick === undefined) return;
      $$(".opt", opts).forEach((b) => { const j = +b.dataset.j; b.disabled = true; if (j === q.a) b.classList.add("right"); else if (j === pick) b.classList.add("wrong"); });
      fb.hidden = false; fb.className = "fb " + (pick === q.a ? "ok" : "no");
      fb.innerHTML = ""; fb.append(el("strong", { text: pick === q.a ? "Correct. " : "Not quite. " }), q.why);
    };
    order(q.opts.length, id + ":" + i).forEach((j, pos) => {
      const b = el("button", { type: "button", class: "opt", "data-j": String(j) }, [el("span", { class: "k", text: "ABCD"[pos] }), el("span", { text: q.opts[j] })]);
      b.addEventListener("click", () => { rec.a[i] = j; if (id === "final") P.finalScore = finalScore(); saveProgress(); paint(); upd(); if (id === "final") refreshCert(); });
      opts.append(b);
    });
    card.append(opts, fb); box.append(card); paint();
  });
  box.append(score); upd();
}
function buildQuizzes() { $$("[data-quiz]").forEach(renderQuiz); }

/* checklist */
function buildChecklist() {
  const st = $("[data-ck-status]"), boxes = $$("[data-ck]");
  const upd = () => { const n = boxes.filter((c) => c.checked).length; st.textContent = `${n} of ${boxes.length} checked` + (n === boxes.length ? ". Ready to send." : ""); st.className = "status" + (n === boxes.length ? " ok" : ""); };
  boxes.forEach((c) => { c.checked = !!P.check[c.dataset.ck]; c.addEventListener("change", () => { P.check[c.dataset.ck] = c.checked; saveProgress(); upd(); }); });
  $("[data-ck-reset]").addEventListener("click", () => { P.check = {}; boxes.forEach((c) => (c.checked = false)); saveProgress(); upd(); });
  upd();
}

/* certificate */
function buildCert() {
  const inp = $("[data-cert-name]"); inp.value = certName;
  inp.addEventListener("input", () => { certName = inp.value; saveProgress(); drawCert(); });
}
function refreshCert() {
  const mods = MODS().filter((m) => P.done[m.id]).length, sc = finalScore();
  const ok = mods === 7 && sc !== null && sc >= 80, miss = [];
  if (mods < 7) miss.push(`mark ${7 - mods} more module${7 - mods === 1 ? "" : "s"} complete`);
  if (sc === null) miss.push("finish the final check");
  else if (sc < 80) miss.push(`score 80% on the final check (you have ${sc}%)`);
  const lk = $("[data-cert-locked]");
  lk.textContent = ok ? "" : "To unlock: " + miss.join(" and ") + "."; lk.hidden = ok;
  $("[data-cert-open]").hidden = !ok;
  if (ok) drawCert();
}
function drawCert() {
  const c = $("[data-cert-canvas]"), x = c.getContext("2d"), W = c.width, H = c.height;
  const green = "#1F6B4F", ink = "#1A2620", muted = "#5E6B64";
  x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#EEF1ED"; x.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 80) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
  for (let gy = 0; gy < H; gy += 40) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
  x.strokeStyle = green; x.lineWidth = 6; x.strokeRect(40, 40, W - 80, H - 80); x.lineWidth = 1.5; x.strokeRect(60, 60, W - 120, H - 120);
  x.textAlign = "center";
  x.fillStyle = muted; x.font = "600 26px Archivo, Arial, sans-serif"; x.fillText("CERTIFICATE OF COMPLETION", W / 2, 190);
  x.fillStyle = green; x.font = "800 64px Archivo, Arial, sans-serif"; x.fillText("Claude + Excel for Finance", W / 2, 290);
  x.fillStyle = ink; x.font = "400 30px 'Source Sans 3', Arial, sans-serif"; x.fillText("This certifies that", W / 2, 400);
  const nm = (certName || ME.name || "").trim() || "Your Name";
  x.font = "700 74px 'Source Sans 3', Arial, sans-serif";
  const w = Math.min(x.measureText(nm).width + 80, W - 260);
  x.fillStyle = "#FFF0A8"; x.fillRect(W / 2 - w / 2, 440, w, 110);
  x.fillStyle = ink; x.fillText(nm, W / 2, 520, W - 300);
  x.font = "400 30px 'Source Sans 3', Arial, sans-serif";
  x.fillText("has completed the self-paced course on using Claude AI with Excel", W / 2, 630);
  x.fillText("for financial analysis, modeling, and reporting.", W / 2, 676);
  x.fillStyle = green; x.font = "700 30px Archivo, Arial, sans-serif"; x.fillText(`Final check score: ${finalScore()}%`, W / 2, 770);
  x.fillStyle = muted; x.font = "500 24px Archivo, Arial, sans-serif";
  x.fillText("Completed " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), W / 2, 830);
}

/* downloads */
function saveBlob(blob, name) { const u = URL.createObjectURL(blob); const a = el("a", { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
function wireDownloads() {
  $$("[data-dl]").forEach((b) => b.addEventListener("click", async () => {
    const st = b.parentElement.querySelector("[data-dl-status]");
    const set = (t, k) => { if (st) { st.textContent = t; st.className = "status " + (k || ""); } };
    try {
      if (b.dataset.dl === "workbook") {
        set("Preparing…"); b.disabled = true;
        const r = await call("getWorkbook");
        const bin = atob(r.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        saveBlob(new Blob([u], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), r.filename);
        set("Downloaded.", "ok");
      } else if (b.dataset.dl === "certificate") {
        drawCert(); $("[data-cert-canvas]").toBlob((bl) => { saveBlob(bl, "Claude_Excel_Finance_Certificate.png"); set("Downloaded.", "ok"); }, "image/png");
      }
    } catch (e) { set("Download failed. Please try again.", "no"); }
    finally { b.disabled = false; }
  }));
}

/* ---------------- admin ---------------- */
function inviteText(u) {
  const first = (u.name || "").split(" ")[0] || "there";
  return `Hi ${first},\n\nYou're invited to Claude + Excel for Finance, a self-paced course (about 90 minutes).\n\nSign in: ${SITE}\nEmail: ${u.email}\nStarter password: ${u.password}\n\nYou'll choose your own password the first time you sign in.`;
}
function resetText(u) {
  const first = (u.name || "").split(" ")[0] || "there";
  return `Hi ${first},\n\nI've reset your password for Claude + Excel for Finance.\n\nSign in: ${SITE}\nEmail: ${u.email}\nTemporary password: ${u.password}\n\nYou'll choose a new password when you sign in.`;
}
function copyBtn(textFn) {
  const b = el("button", { type: "button", class: "btn small", text: "Copy" });
  b.addEventListener("click", () => navigator.clipboard.writeText(textFn()).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); }, () => {}));
  return b;
}
function fmtDate(iso) { if (!iso) return "Never"; const d = new Date(iso); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

async function renderAdmin() {
  const v = $('[data-view="admin"]');
  v.innerHTML = "";
  v.append(el("header", { class: "mhead" }, [el("p", { class: "eyebrow", text: "Admin" }), el("h1", { text: "Manage learners" }), el("p", { class: "lead", text: "Add learners, reset passwords, and see progress. Nothing is emailed automatically. Copy the invite text and send it yourself." })]));

  // add form
  const form = el("form", { class: "card", novalidate: "" });
  form.innerHTML = `<h3>Add a learner</h3>
    <div class="addform">
      <label class="field"><span>Name</span><input type="text" id="adName" autocomplete="off" required></label>
      <label class="field"><span>Email</span><input type="email" id="adEmail" autocomplete="off" required></label>
      <label class="field"><span>Starter password (optional)</span><input type="text" id="adPw" autocomplete="off" placeholder="Auto if left blank"></label>
      <button class="btn primary" type="submit" id="adBtn">Add learner</button>
    </div>
    <div id="adMsg" class="msg no" hidden></div>
    <div id="adOut"></div>`;
  v.append(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = $("#adName").value.trim(), email = $("#adEmail").value.trim(), password = $("#adPw").value.trim();
    if (!name || !email) { msg($("#adMsg"), "Enter a name and email."); return; }
    $("#adBtn").disabled = true; msg($("#adMsg"), "");
    try {
      const u = await call("adminCreateUser", { name, email, password: password || undefined });
      $("#adName").value = ""; $("#adEmail").value = ""; $("#adPw").value = "";
      const t = inviteText(u);
      const out = $("#adOut"); out.innerHTML = "";
      out.append(el("div", { class: "invite" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("strong", { text: `${u.name} is ready. Send them this invite:` }), copyBtn(() => t)]), el("pre", { text: t })]));
      loadUsers(table);
    } catch (e) { msg($("#adMsg"), errText(e)); }
    finally { $("#adBtn").disabled = false; }
  });

  // list
  const card = el("div", { class: "card" });
  const head = el("div", { class: "row", style: "justify-content:space-between" }, [el("h3", { text: "Learners" })]);
  const refresh = el("button", { type: "button", class: "btn small", text: "Refresh" });
  head.append(refresh); card.append(head);
  const out2 = el("div"); card.append(out2);
  const table = el("div", { class: "tbl" }); card.append(table);
  refresh.addEventListener("click", () => loadUsers(table));
  v.append(card);
  v._out = out2;
  loadUsers(table);
}

async function loadUsers(table) {
  table.innerHTML = '<p class="hint" style="padding:14px">Loading…</p>';
  let users;
  try { users = (await call("adminListUsers")).users; }
  catch (e) { table.innerHTML = ""; table.append(el("p", { class: "msg no", text: errText(e) })); return; }
  const t = el("table", { class: "users" });
  t.innerHTML = "<thead><tr><th>Learner</th><th>Status</th><th>Progress</th><th>Last sign-in</th><th></th></tr></thead>";
  const tb = el("tbody");
  users.forEach((u) => {
    const status = !u.active ? el("span", { class: "pill off", text: "Access off" }) : u.mustChangePassword ? el("span", { class: "pill pend", text: "Not signed in yet" }) : el("span", { class: "pill on", text: "Active" });
    const role = u.role === "admin" ? el("span", { class: "pill adm", text: "Admin", style: "margin-left:6px" }) : null;
    const prog = `${u.modulesDone} of 7` + (u.finalScore !== null ? ` · final ${u.finalScore}%` : "");
    const act = el("div", { class: "uact" });
    const isMe = u.uid === ME.uid;
    const confirmThen = (label, run) => {
      const b = el("button", { type: "button", class: "btn small", text: label });
      b.addEventListener("click", () => {
        const c = el("span", { class: "confirm" }, [el("span", { text: "Are you sure?" })]);
        const yes = el("button", { type: "button", class: "btn small primary", text: "Yes" });
        const no = el("button", { type: "button", class: "btn small ghost", text: "Cancel" });
        no.addEventListener("click", () => c.replaceWith(b));
        yes.addEventListener("click", async () => { yes.disabled = true; try { await run(); } catch (e) { toast(errText(e)); c.replaceWith(b); } });
        c.append(yes, no); b.replaceWith(c);
      });
      return b;
    };
    act.append(confirmThen("Reset password", async () => {
      const r = await call("adminResetPassword", { uid: u.uid });
      const txt = resetText(r);
      const out = el("div", { class: "invite" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("strong", { text: `New temporary password for ${r.name}:` }), copyBtn(() => txt)]), el("pre", { text: txt })]);
      table.before(out);
      await loadUsers(table);
    }));
    if (!isMe) {
      act.append(confirmThen(u.active ? "Turn off access" : "Turn on access", async () => { await call("adminSetActive", { uid: u.uid, active: !u.active }); toast(u.active ? "Access turned off." : "Access turned on."); await loadUsers(table); }));
      act.append(confirmThen(u.role === "admin" ? "Remove admin" : "Make admin", async () => { await call("adminSetAdmin", { uid: u.uid, admin: u.role !== "admin" }); toast("Role updated."); await loadUsers(table); }));
    }
    tb.append(el("tr", {}, [
      el("td", {}, [el("span", { class: "nm", text: u.name || "(no name)" }), el("span", { class: "em", text: u.email })]),
      el("td", {}, [status, role]),
      el("td", { text: prog }),
      el("td", { text: fmtDate(u.lastSignIn) }),
      el("td", {}, [act])
    ]));
  });
  t.append(tb);
  table.innerHTML = ""; table.append(t);
  if (!users.length) table.append(el("p", { class: "hint", style: "padding:14px", text: "No learners yet." }));
}
