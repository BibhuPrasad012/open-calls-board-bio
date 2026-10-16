import { firebaseConfig, ADMIN_EMAILS, ALLOWED_EMAIL_DOMAIN } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, query, limit, onSnapshot, getDocs, getDoc, setDoc, updateDoc, deleteDoc, addDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s, el) => (el || document).querySelector(s);
const DAY = 86400000;
const SPAN = 120;
const BASE_TITLE = document.title;
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PROGRESS = [["saved","Saved"],["preparing","Preparing documents"],["submitted","Submitted"],["interview","Interview"],["offer","Offer"],["declined","Not successful"]];
const REMIND_STATUSES = ["saved","preparing"];
const REMIND_CHOICES = [3,7,14,30];
const ALL_FIELDS = "Open to all fields";
const TAGS = [ALL_FIELDS,"Molecular & cell biology","Genetics & genomics","Bioinformatics & computational biology","Neuroscience","Immunology & infection","Microbiology","Cancer biology","Structural biology & biophysics","Ecology & evolution","Plant & agricultural science","Biomedical & clinical research","Synthetic biology & biotechnology","Biomedical engineering","Chemical & process engineering","Electrical & electronic engineering","Mechanical & aerospace engineering","Civil & environmental engineering","Materials science","Computer science & AI","Robotics & control","Energy & sustainability"];
const ICON_BM = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6.5 3.5h11a.5.5 0 0 1 .5.5v16.1a.3.3 0 0 1-.47.25L12 16.4l-5.53 3.95a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ADMINS = (ADMIN_EMAILS || []).map(e => String(e).trim().toLowerCase());
const DOMAIN = String(ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase().replace(/^@/, "");
const SIGN_IN_LABEL = DOMAIN ? "Sign in with your IITGN email" : "Sign in with Google";
function emailAllowed(u){
  if (!u || !u.emailVerified || typeof u.email !== "string") return false;
  return !DOMAIN || u.email.toLowerCase().endsWith("@" + DOMAIN);
}
function wrongDomainMessage(email){
  return (email ? email + " can't be used here. " : "") + "Sign in with your @" + DOMAIN + " account.";
}

const state = {
  positions: new Map(), loaded: false, loadError: null, configured: false,
  wish: {}, wishLoaded: false, wishError: false, remindDays: 14,
  user: null, uid: null, isAdmin: false, authReady: false,
  tab: "all", q: "", field: "any", tag: "any", level: "any", status: "active", sort: "deadline",
  expanded: new Set(), confirmDel: null, seeding: false
};
let app = null, auth = null, db = null, unsubWish = null, pendingSave = null;
const writeChains = new Map();
let renderPending = false, editingId = null, delTimer = null, toastTimer = null;

/* ---------- Small helpers ---------- */
function h(tag, props){
  const el = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.slice(0,2) === "on") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (let i = 2; i < arguments.length; i++){
    const kids = [].concat(arguments[i]);
    for (const kid of kids){
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  return el;
}
function iconEl(svg){ const s = document.createElement("span"); s.innerHTML = svg; return s.firstChild; }
const S = v => (typeof v === "string" ? v : "");
const nowIso = () => new Date().toISOString();
function today0(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function parseYMD(s){
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y,m,d] = s.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  return isNaN(dt) ? null : dt;
}
function ymd(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function fmtFull(d){ return d.toLocaleDateString(undefined, {day:"numeric", month:"short", year:"numeric"}); }
function fmtIso(s){ const d = new Date(s); return isNaN(d) ? "" : fmtFull(d); }
function deadlineDate(p){ return p.deadlineType === "rolling" ? null : parseYMD(p.deadline); }
function daysLeft(p){ const d = deadlineDate(p); return d ? Math.round((d - today0()) / DAY) : null; }
function plural(n, w){ return n + " " + w + (n === 1 ? "" : "s"); }
function firstName(u){ return S(u && u.displayName).trim().split(/\s+/)[0].slice(0, 80); }
function statusOf(p){
  if (p.deadlineType === "rolling") return {key:"rolling", label:"Rolling, apply anytime", days:null};
  const dl = daysLeft(p);
  if (dl == null) return {key:"varies", label:"Dates vary, check the site", days:null};
  const est = p.estimated ? " (est.)" : "";
  if (dl < 0) return {key:"passed", label:"Closed " + plural(-dl, "day") + " ago" + est, days:dl};
  if (dl === 0) return {key:"soon", label:"Closes today" + est, days:0};
  if (dl <= 14) return {key:"soon", label:"Closes in " + plural(dl, "day") + est, days:dl};
  if (dl <= 30) return {key:"month", label:"Closes in " + dl + " days" + est, days:dl};
  return {key:"later", label:"Closes in " + dl + " days" + est, days:dl};
}
function fieldLabel(f){ return f === "Bio" ? "Biology" : f === "Eng" ? "Engineering" : "Biology & engineering"; }
function progressLabel(v){ const x = PROGRESS.find(p => p[0] === v); return x ? x[1] : "Saved"; }
function safeUrl(u){
  try { const x = new URL(u); return (x.protocol === "https:" || x.protocol === "http:") ? x.href : ""; }
  catch(e){ return ""; }
}
function cleanTags(arr){
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const t of arr){
    if (typeof t !== "string") continue;
    const v = t.trim().replace(/\s+/g, " ").slice(0, 40);
    if (v && !out.some(o => o.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}
function normalize(id, d){
  return {
    id, title:S(d.title), host:S(d.host), level:S(d.level), field:["Bio","Eng","Both"].includes(d.field) ? d.field : "Both",
    eligibility:S(d.eligibility), funding:S(d.funding), window:S(d.window), notes:S(d.notes), url:S(d.url),
    deadlineType:["fixed","rolling","varies"].includes(d.deadlineType) ? d.deadlineType : "varies",
    deadline:S(d.deadline), estimated:d.estimated === true, source:S(d.source), tags:cleanTags(d.tags),
    addedBy:S(d.addedBy) || null, addedByName:S(d.addedByName), createdAt:S(d.createdAt),
    updatedBy:S(d.updatedBy) || null, updatedByName:S(d.updatedByName), updatedAt:S(d.updatedAt)
  };
}
function canWish(){ return !!(state.uid && state.wishLoaded && !state.wishError); }
function canEditPositions(){ return !!db && !!state.uid; }
function canDelete(p){ return canEditPositions() && ((p.addedBy && p.addedBy === state.uid) || state.isAdmin); }

function matches(p, ignoreStatus){
  if (state.tab === "wish" && !state.wish[p.id]) return false;
  if (state.field !== "any" && !(p.field === state.field || p.field === "Both")) return false;
  if (state.tag !== "any"){
    const has = p.tags.includes(state.tag) || (state.tag !== ALL_FIELDS && p.tags.includes(ALL_FIELDS));
    if (!has) return false;
  }
  if (state.level === "phd" && !/ph\.?\s?d|dphil|doctor/i.test(p.level)) return false;
  if (state.level === "masters" && !/master|\bmsc\b|\bms\b|mphil/i.test(p.level)) return false;
  if (!ignoreStatus){
    const k = statusOf(p).key;
    if (state.status === "active" && k === "passed") return false;
    if (state.status === "soon" && !(k === "soon" || k === "month")) return false;
    if (state.status === "rolling" && !(k === "rolling" || k === "varies")) return false;
    if (state.status === "passed" && k !== "passed") return false;
  }
  if (state.q){
    const hay = [p.title,p.host,p.level,p.eligibility,p.funding,p.notes,p.window,fieldLabel(p.field),p.tags.join(" ")].join(" ").toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
  }
  return true;
}
function cmpDeadline(a, b){
  const da = daysLeft(a), dbb = daysLeft(b);
  const ga = da == null ? 1 : da < 0 ? 2 : 0, gb = dbb == null ? 1 : dbb < 0 ? 2 : 0;
  if (ga !== gb) return ga - gb;
  if (ga === 0) return da - dbb || a.title.localeCompare(b.title);
  if (ga === 2) return dbb - da || a.title.localeCompare(b.title);
  return a.title.localeCompare(b.title);
}
function cmp(a, b){
  if (state.sort === "az") return a.title.localeCompare(b.title);
  if (state.sort === "recent") return (b.createdAt || "").localeCompare(a.createdAt || "") || cmpDeadline(a, b);
  return cmpDeadline(a, b);
}

/* ---------- Calendar helpers ---------- */
function calDetails(p){
  const parts = [];
  if (p.estimated) parts.push("Estimated date. Confirm it on the official site.");
  const u = safeUrl(p.url); if (u) parts.push(u);
  parts.push("Tracked on " + location.href.split("#")[0]);
  return parts.join("\n");
}
function gcalUrl(p){
  const d = deadlineDate(p); if (!d) return "";
  const n = new Date(d); n.setDate(n.getDate() + 1);
  const f = x => ymd(x).replace(/-/g, "");
  return "https://calendar.google.com/calendar/render?" + new URLSearchParams({action:"TEMPLATE", text:"Deadline: " + p.title, dates:f(d) + "/" + f(n), details:calDetails(p)});
}
function outlookUrl(p){
  const d = deadlineDate(p); if (!d) return "";
  const n = new Date(d); n.setDate(n.getDate() + 1);
  return "https://outlook.live.com/calendar/0/deeplink/compose?" + new URLSearchParams({path:"/calendar/action/compose", rru:"addevent", subject:"Deadline: " + p.title, startdt:ymd(d), enddt:ymd(n), allday:"true", body:calDetails(p)});
}
function icsEscape(s){ return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function icsFold(line){
  const out = []; let rest = line;
  while (rest.length > 73){ out.push(rest.slice(0, 73)); rest = " " + rest.slice(73); }
  out.push(rest);
  return out.join("\r\n");
}
function alarmTrigger(days){ return days <= 1 ? "-PT15H" : "-P" + (days - 1) + "DT15H"; } // 9:00 the morning N days before
function icsFor(items){
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Open calls board//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Application deadlines"];
  for (const p of items){
    const d = deadlineDate(p); if (!d) continue;
    const n = new Date(d); n.setDate(n.getDate() + 1);
    const f = x => ymd(x).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", "UID:" + p.id + "@open-calls", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + f(d), "DTEND;VALUE=DATE:" + f(n),
      icsFold("SUMMARY:" + icsEscape("Deadline: " + p.title)),
      icsFold("DESCRIPTION:" + icsEscape(calDetails(p))));
    const u = safeUrl(p.url); if (u) lines.push(icsFold("URL:" + u));
    const alarms = [...new Set([state.remindDays, 1])];
    for (const a of alarms){
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", icsFold("DESCRIPTION:" + icsEscape(p.title + " closes in " + plural(a, "day"))), "TRIGGER:" + alarmTrigger(a), "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
function downloadFile(name, text, mime){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = h("a", {href:url, download:name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function calLinks(p, cls){
  const g = gcalUrl(p), o = outlookUrl(p);
  if (!g) return null;
  return h("span", {class:cls || "cal-inline"}, "Add to ",
    h("a", {class:"cal-link", href:g, target:"_blank", rel:"noopener noreferrer"}, "Google Calendar"), ", ",
    h("a", {class:"cal-link", href:o, target:"_blank", rel:"noopener noreferrer"}, "Outlook"), " or ",
    h("button", {class:"linkish", type:"button", onclick:() => downloadFile(slug(p.title) + "-deadline.ics", icsFor([p]), "text/calendar")}, "Apple / other (.ics)"));
}
function slug(s){ return S(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "position"; }

/* ---------- Rendering ---------- */
function requestRender(){
  const ae = document.activeElement;
  if (ae && ae.tagName === "TEXTAREA" && ae.closest("#list")){ renderPending = true; return; }
  render();
}
function renderAccount(){
  const box = $("#account"); box.replaceChildren();
  if (!state.configured) return;
  const add = h("button", {class:"btn primary", type:"button", onclick:() => state.uid ? openEditor(null) : signIn(() => openEditor(null))}, "Add a position");
  if (!state.authReady){ box.append(add); return; }
  if (state.user){
    box.append(
      h("span", {class:"who"}, "Signed in as ", h("strong", {text:firstName(state.user) || S(state.user.email) || "you"})),
      h("button", {class:"linkish", type:"button", onclick:() => signOut(auth).then(() => toast("Signed out"))}, "Sign out"),
      add);
  } else {
    box.append(h("button", {class:"btn", type:"button", onclick:() => signIn()}, SIGN_IN_LABEL), add);
  }
}
function render(){
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const all = [...state.positions.values()];
  const wishCount = all.filter(p => state.wish[p.id]).length;
  $("#nAll").textContent = state.loaded ? String(all.length) : "";
  $("#nWish").textContent = state.loaded && state.wishLoaded ? String(wishCount) : "";
  $("#tabAll").setAttribute("aria-pressed", String(state.tab === "all"));
  $("#tabWish").setAttribute("aria-pressed", String(state.tab === "wish"));
  renderAccount();
  renderTagFilter(all);
  renderReminders(all);

  const list = $("#list"), empty = $("#empty"), notice = $("#notice"), hiddenNote = $("#hiddenNote");
  list.replaceChildren(); empty.replaceChildren(); notice.replaceChildren(); hiddenNote.hidden = true;
  $("#count").textContent = "";
  renderWishBar(wishCount);

  if (!state.configured){ renderTimeline([]); list.hidden = true; return; }
  if (state.loadError) notice.append(h("div", {class:"notice"}, "The positions couldn't be loaded. Reload the page to try again."));
  if (state.wishError) notice.append(h("div", {class:"notice"}, "Your wishlist couldn't be loaded, so saving is paused to protect it. Reload the page to try again."));
  if (!state.loaded){
    empty.append(h("div", {class:"empty"}, "Loading positions…"));
    renderTimeline([]); list.hidden = true; return;
  }
  if (state.tab === "wish" && !state.uid){
    notice.append(h("div", {class:"notice"}, "Sign in to keep a personal wishlist. ",
      h("button", {class:"linkish", type:"button", onclick:() => signIn()}, SIGN_IN_LABEL)));
  }

  const items = all.filter(p => matches(p)).sort(cmp);
  renderTimeline(items);
  for (const p of items) list.append(renderRow(p));
  list.hidden = items.length === 0;
  let countTxt = items.length ? "Showing " + plural(items.length, "position") : "";
  if (items.length && state.tag !== "any" && state.tag !== ALL_FIELDS) countTxt += ", including programmes open to all fields";
  $("#count").textContent = countTxt;

  if (!items.length){
    const box = h("div", {class:"empty"});
    if (!all.length){
      box.append(h("strong", {text:"No positions yet"}));
      if (state.isAdmin){
        box.append("Load the starter list of 51 programmes, or add your own.", h("div", {style:"margin-top:12px"},
          h("button", {class:"btn primary", type:"button", disabled:state.seeding, onclick:loadStarter}, state.seeding ? "Loading…" : "Load the starter list")));
      } else box.append("Add the first scholarship or PhD position so others can see it.");
    }
    else if (state.tab === "wish" && state.uid && !state.wishLoaded) box.append(h("strong", {text:"Loading your wishlist…"}));
    else if (state.tab === "wish" && state.uid && !wishCount) box.append(h("strong", {text:"Your wishlist is empty"}), "Select Save on any position to track its deadline here.");
    else if (state.tab === "wish" && !state.uid) box.append(h("strong", {text:"Sign in to see your wishlist"}));
    else box.append(h("strong", {text:"Nothing matches these filters"}), "Clear the search, or choose Any domain or Everything under deadline status.");
    empty.append(box);
  }
  if (state.status === "active"){
    const passed = all.filter(p => matches(p, true) && statusOf(p).key === "passed").length;
    if (passed){
      hiddenNote.replaceChildren(plural(passed, "position") + " with a passed deadline " + (passed === 1 ? "is" : "are") + " hidden. ",
        h("button", {class:"linkish", type:"button", onclick:() => { state.status = "passed"; $("#fStatus").value = "passed"; render(); }}, "Show passed deadlines"));
      hiddenNote.hidden = false;
    }
  }
  if (fk){
    const el = document.querySelector('[data-fk="' + CSS.escape(fk) + '"]');
    if (el) el.focus({preventScroll:true});
  }
}

function renderTagFilter(all){
  const sel = $("#fTag");
  const counts = new Map();
  for (const p of all) for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const extra = [...counts.keys()].filter(t => !TAGS.includes(t)).sort((a,b) => a.localeCompare(b));
  const opts = [["any","Any domain"]];
  for (const t of TAGS.concat(extra)){
    const n = counts.get(t) || 0;
    if (!n && t !== state.tag) continue;
    opts.push([t, t + " (" + n + ")"]);
  }
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig !== sig){
    sel.replaceChildren(...opts.map(o => h("option", {value:o[0]}, o[1])));
    sel.dataset.sig = sig;
  }
  sel.value = state.tag;
}

function renderWishBar(wishCount){
  const bar = $("#wishBar"), acts = $("#wishActions");
  const show = state.tab === "wish" && !!state.uid && state.wishLoaded;
  bar.hidden = !show; acts.replaceChildren();
  if (!show || !wishCount) return;
  acts.append(
    h("button", {class:"btn", type:"button", onclick:exportCalendar}, "Download calendar with reminders (.ics)"),
    h("button", {class:"btn", type:"button", onclick:exportWishlist}, "Download wishlist (CSV)"));
}

function renderReminders(all){
  const box = $("#remind");
  if (!state.uid || !state.wishLoaded || !state.loaded){ box.hidden = true; document.title = BASE_TITLE; return; }
  const saved = all.filter(p => state.wish[p.id]);
  if (!saved.length){ box.hidden = true; document.title = BASE_TITLE; return; }
  const due = saved.filter(p => {
    const d = daysLeft(p);
    return d != null && d >= 0 && d <= state.remindDays && REMIND_STATUSES.includes(state.wish[p.id].status);
  }).sort(cmpDeadline);
  document.title = (due.length ? "(" + due.length + ") " : "") + BASE_TITLE;

  const ae = document.activeElement;
  const hadFocus = ae && ae.id === "remDays";
  const sel = h("select", {id:"remDays", onchange:e => setRemindDays(Number(e.target.value))},
    REMIND_CHOICES.map(n => h("option", {value:String(n), selected:n === state.remindDays}, plural(n, "day"))));
  const label = h("label", {class:"rem-set", for:"remDays"}, "Remind me ", sel, " before");
  const head = h("div", {class:"rem-head"},
    h("h2", {id:"remTitle", text: due.length ? plural(due.length, "deadline") + " coming up on your wishlist" : "Nothing urgent on your wishlist"}),
    label);
  const inner = h("div", {class:"remind-in"}, head);
  if (due.length){
    const ul = h("ul", {class:"rem-list"});
    for (const p of due){
      const st = statusOf(p);
      ul.append(h("li", null,
        h("span", {class:"pill " + (st.days <= 14 ? "soon" : "month"), text:st.label}),
        h("button", {class:"title-btn", type:"button", onclick:() => jumpTo(p.id)}, p.title),
        calLinks(p, "rem-cal")));
    }
    inner.append(ul);
  } else {
    inner.append(h("p", {class:"rem-empty", text:"Nothing you're saving or preparing closes in the next " + plural(state.remindDays, "day") + "."}));
  }
  inner.append(h("p", {class:"rem-foot", text:"These reminders appear whenever you open the site. For alerts on your phone, go to My wishlist and download your deadlines as a calendar file; it includes reminders " + plural(state.remindDays, "day") + " and 1 day before each deadline."}));
  box.replaceChildren(inner);
  box.hidden = false;
  if (hadFocus){ const s = $("#remDays"); if (s) s.focus({preventScroll:true}); }
}

function renderTimeline(items){
  const tl = $("#timeline");
  const track = h("div", {class:"tl-track"});
  tl.replaceChildren(track);
  const start = today0();
  track.append(h("div", {class:"tl-axis"}));
  const m = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while ((m - start) / DAY <= SPAN){
    const off = Math.round((m - start) / DAY);
    const label = m.toLocaleDateString(undefined, {month:"short"}) + (m.getMonth() === 0 ? " " + m.getFullYear() : "");
    track.append(h("div", {class:"tl-month", style:"left:" + (off / SPAN * 100) + "%"}, h("span", {text:label})));
    m.setMonth(m.getMonth() + 1);
  }
  track.append(h("div", {class:"tl-today"}, h("span", {text:"Today"})));

  const dated = items.map(p => ({p, dl:daysLeft(p)})).filter(x => x.dl != null && x.dl >= 0 && x.dl <= SPAN).sort((a,b) => a.dl - b.dl);
  const placed = []; const overflow = {};
  for (const x of dated){
    let lvl = 0;
    while (placed.some(q => q.lvl === lvl && Math.abs(q.dl - x.dl) < 2.4)) lvl++;
    if (lvl > 6){
      const top = placed.filter(q => q.lvl === 6 && Math.abs(q.dl - x.dl) < 2.4).sort((a,b) => a.dl - b.dl)[0];
      const key = top ? top.dl : x.dl;
      overflow[key] = (overflow[key] || 0) + 1; continue;
    }
    placed.push({dl:x.dl, lvl});
    const saved = !!state.wish[x.p.id], soon = x.dl <= 14;
    const d = deadlineDate(x.p);
    const lab = x.p.title + ", closes " + fmtFull(d) + (x.p.estimated ? " (estimated)" : "") + (saved ? ", on your wishlist" : "");
    track.append(h("button", {
      class:"tl-dot" + (saved ? " saved" : "") + (soon ? " soon" : ""), type:"button",
      style:"left:" + (x.dl / SPAN * 100) + "%;bottom:" + (32 + lvl * 15) + "px",
      "aria-label":lab, title:lab, onclick:() => jumpTo(x.p.id)
    }));
  }
  for (const dl in overflow){
    track.append(h("span", {class:"tl-more", style:"left:" + (dl / SPAN * 100) + "%;bottom:" + (32 + 7 * 15) + "px", text:"+" + overflow[dl]}));
  }
  const in30 = items.filter(p => { const d = daysLeft(p); return d != null && d >= 0 && d <= 30; });
  const sv = in30.filter(p => state.wish[p.id]).length;
  let msg;
  if (!state.configured) msg = "";
  else if (!state.loaded) msg = "Loading deadlines…";
  else if (!in30.length) msg = dated.length ? "Nothing closes in the next 30 days. Select a dot to see a position." : "No deadlines in the next four months match your filters.";
  else msg = plural(in30.length, "deadline") + " in the next 30 days" + (state.uid && state.wishLoaded ? ", " + sv + " on your wishlist." : ".");
  $("#tlSummary").textContent = msg;
}

function renderRow(p){
  const st = statusOf(p), saved = !!state.wish[p.id], open = state.expanded.has(p.id);
  const d = deadlineDate(p);
  const when = h("div", {class:"when " + st.key});
  if (p.deadlineType === "rolling") when.append(h("span", {class:"when-word", text:"Rolling"}));
  else if (d){
    when.append(h("span", {class:"when-day", text:String(d.getDate())}),
                h("span", {class:"when-month", text:d.toLocaleDateString(undefined, {month:"short", year:"numeric"})}));
    if (p.estimated) when.append(h("span", {class:"when-est", text:"estimated"}));
  } else when.append(h("span", {class:"when-word", text:"Varies"}));

  const shownTags = p.tags.slice(0, 4);
  const main = h("div", {class:"main"},
    h("h3", null, h("button", {class:"title-btn", type:"button", "aria-expanded":String(open), "aria-controls":"d-" + p.id, "data-fk":"t-" + p.id, onclick:() => toggleOpen(p.id)}, p.title || "Untitled position")),
    h("div", {class:"meta"},
      p.host ? h("span", {text:p.host}) : null,
      p.level ? h("span", {class:"chip", text:p.level}) : null,
      h("span", {class:"chip", text:fieldLabel(p.field)})),
    shownTags.length ? h("div", {class:"meta"},
      shownTags.map(t => h("button", {class:"tagchip", type:"button", "aria-pressed":String(state.tag === t), title:"Show positions in " + t, onclick:() => setTag(state.tag === t ? "any" : t)}, t)),
      p.tags.length > 4 ? h("span", {text:"+" + (p.tags.length - 4) + " more"}) : null) : null,
    h("div", {class:"meta"},
      h("span", {class:"pill " + st.key, text:st.label}),
      saved ? h("span", {class:"mine-chip", text:"Your progress: " + progressLabel(state.wish[p.id].status)}) : null),
    p.funding ? h("p", {class:"fund", text:p.funding}) : null
  );

  const loadingWish = !!state.uid && !state.wishLoaded;
  const saveBtn = h("button", {
    class:"save", type:"button", "aria-pressed":String(saved), "data-fk":"s-" + p.id,
    "aria-label":(saved ? "Remove " : "Save ") + (p.title || "position") + (saved ? " from" : " to") + " your wishlist",
    disabled:loadingWish || state.wishError, title:loadingWish ? "Loading your wishlist…" : null,
    onclick:() => toggleSave(p.id)
  }, iconEl(ICON_BM), h("span", {text:saved ? "Saved" : "Save"}));

  const li = h("li", {class:"row", id:"row-" + p.id}, when, main, h("div", {class:"actions"}, saveBtn));
  if (open) li.append(renderDetails(p));
  return li;
}

function renderDetails(p){
  const box = h("div", {class:"details", id:"d-" + p.id});
  const dl = h("dl", {class:"facts"});
  const add = (k, v) => { if (v) dl.append(h("div", null, h("dt", {text:k}), h("dd", {text:v}))); };
  const d = deadlineDate(p);
  add("Deadline", p.deadlineType === "rolling" ? "Rolling, apply anytime" : d ? fmtFull(d) + (p.estimated ? " (estimated from past cycles; confirm on the official site)" : "") : "Varies or not announced yet");
  add("Domains", p.tags.join(", "));
  add("Who can apply", p.eligibility);
  add("Funding", p.funding);
  add("Application window", p.window);
  add("Notes", p.notes);
  box.append(dl);

  const acts = h("div", {class:"detail-actions"});
  const url = safeUrl(p.url);
  if (url) acts.append(h("a", {class:"btn primary", href:url, target:"_blank", rel:"noopener noreferrer"}, "Open official website"));
  if (canEditPositions()) acts.append(h("button", {class:"btn", type:"button", "data-fk":"e-" + p.id, onclick:() => openEditor(p.id)}, "Edit details"));
  if (canDelete(p)) acts.append(h("button", {class:"btn danger", type:"button", "data-fk":"x-" + p.id, onclick:() => deletePosition(p.id)}, state.confirmDel === p.id ? "Select again to delete" : "Delete"));
  if (d && daysLeft(p) >= 0) acts.append(calLinks(p));
  if (acts.childNodes.length) box.append(acts);

  if (state.wish[p.id]) box.append(renderMine(p));

  const prov = h("p", {class:"prov"});
  if (p.source === "starter") prov.append("From the starter list compiled on 16 Oct 2026.");
  else {
    const when = fmtIso(p.createdAt);
    prov.append("Added by " + (p.addedBy && p.addedBy === state.uid ? "you" : (p.addedByName || "someone")) + (when ? " on " + when : "") + ".");
  }
  if (p.updatedAt){
    const when = fmtIso(p.updatedAt);
    prov.append(" Last edited by " + (p.updatedBy && p.updatedBy === state.uid ? "you" : (p.updatedByName || "someone")) + (when ? " on " + when : "") + ".");
  }
  box.append(prov);
  return box;
}

function renderMine(p){
  const w = state.wish[p.id];
  const sel = h("select", {id:"ps-" + p.id, "data-fk":"p-" + p.id, onchange:e => {
    const cur = state.wish[p.id]; if (!cur) return;
    cur.status = e.target.value;
    const uid = state.uid;
    wishWrite(p.id, () => updateDoc(doc(db, "users", uid, "wishlist", p.id), {status:cur.status}));
    requestRender();
  }}, PROGRESS.map(o => h("option", {value:o[0], selected:w.status === o[0]}, o[1])));
  const ta = h("textarea", {id:"pn-" + p.id, rows:"3", maxlength:"2000", placeholder:"Referees to ask, documents to prepare, questions for the supervisor…", onchange:e => {
    const cur = state.wish[p.id]; if (!cur) return;
    cur.note = e.target.value.slice(0, 2000);
    const uid = state.uid;
    wishWrite(p.id, () => updateDoc(doc(db, "users", uid, "wishlist", p.id), {note:cur.note})).then(ok => { if (ok) toast("Note saved"); });
  }});
  ta.value = w.note || "";
  return h("div", {class:"mine"},
    h("p", {class:"mine-title", text:"Your tracking (only you can see this)"}),
    h("label", {for:"ps-" + p.id}, "Progress"), sel,
    h("label", {for:"pn-" + p.id}, "Private notes"), ta);
}

/* ---------- Actions ---------- */
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}
async function signIn(after){
  if (!auth) return;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters(DOMAIN ? {hd:DOMAIN, prompt:"select_account"} : {prompt:"select_account"});
    const res = await signInWithPopup(auth, provider);
    if (!res || !res.user) return;
    if (!emailAllowed(res.user)){
      pendingSave = null;
      const email = res.user.email;
      await signOut(auth).catch(() => {});
      toast(wrongDomainMessage(email));
      return;
    }
    if (typeof after === "function") after();
  } catch(e){
    pendingSave = null;
    const code = e && e.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    if (code === "auth/popup-blocked") toast("Your browser blocked the sign-in window. Allow pop-ups for this site and try again.");
    else if (code === "auth/unauthorized-domain") toast("This site's address isn't on Firebase's list of authorized domains yet (see step 6 in the README).");
    else if (code === "auth/operation-not-allowed") toast("Google sign-in isn't turned on in Firebase yet (see step 2 in the README).");
    else toast("Sign-in didn't work. Try again.");
  }
}
function toggleOpen(id){ if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id); render(); }
function setTag(t){ state.tag = t; render(); }
function jumpTo(id){
  state.expanded.add(id); render();
  let row = document.getElementById("row-" + id);
  if (!row){
    state.tab = "all"; state.q = ""; state.field = "any"; state.tag = "any"; state.level = "any"; state.status = "all";
    $("#q").value = ""; $("#fField").value = "any"; $("#fLevel").value = "any"; $("#fStatus").value = "all";
    render(); row = document.getElementById("row-" + id);
  }
  if (!row) return;
  row.scrollIntoView({behavior:reduceMotion ? "auto" : "smooth", block:"center"});
  row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
  const b = row.querySelector(".title-btn"); if (b) b.focus({preventScroll:true});
}
function wishWrite(pid, fn){
  const prev = writeChains.get(pid) || Promise.resolve(true);
  const next = prev.then(() => fn()).then(() => true, e => { onWishError(e); return false; });
  writeChains.set(pid, next);
  return next;
}
function onWishError(e){
  const code = e && e.code;
  if (code === "permission-denied") toast("That change to your wishlist was refused. Try signing out and back in.");
  else if (code === "resource-exhausted") toast("The site has reached today's free usage limit. Your change wasn't saved; try again tomorrow.");
  else toast("That change to your wishlist wasn't saved. Check your connection and try again.");
  requestRender();
}
function toggleSave(id){
  if (!state.uid){
    pendingSave = id;
    toast("Sign in to save positions to your wishlist.");
    signIn();
    return;
  }
  if (!canWish()) return;
  const p = state.positions.get(id);
  const uid = state.uid;
  const ref = doc(db, "users", uid, "wishlist", id);
  if (state.wish[id]){
    delete state.wish[id];
    wishWrite(id, () => deleteDoc(ref));
    toast("Removed from your wishlist");
  } else {
    const rec = {status:"saved", note:"", savedAt:nowIso()};
    state.wish[id] = rec;
    wishWrite(id, () => setDoc(ref, rec));
    toast("Saved to your wishlist" + (p && deadlineDate(p) ? ". Its deadline is now filled in on the timeline." : ""));
  }
  render();
}
async function setRemindDays(n){
  if (!REMIND_CHOICES.includes(n)) return;
  state.remindDays = n; render();
  if (!state.uid) return;
  try { await setDoc(doc(db, "users", state.uid), {remindDays:n}); }
  catch(e){ toast("Your reminder setting wasn't saved. It applies until you reload."); }
}
function onWriteError(e, inDlg){
  const code = e && e.code; let msg;
  if (code === "permission-denied") msg = "That change was refused. Make sure you're signed in and every field is filled in correctly.";
  else if (code === "resource-exhausted") msg = "The site has reached today's free usage limit. Try again tomorrow.";
  else if (code === "unavailable") msg = "You seem to be offline. Check your connection and try again.";
  else msg = "The change couldn't be saved just now. Try again in a moment.";
  if (inDlg) $("#dlgErr").textContent = msg; else toast(msg);
  requestRender();
}
async function deletePosition(id){
  if (state.confirmDel !== id){
    state.confirmDel = id; clearTimeout(delTimer);
    delTimer = setTimeout(() => { state.confirmDel = null; requestRender(); }, 5000);
    render(); return;
  }
  state.confirmDel = null; clearTimeout(delTimer);
  try {
    await deleteDoc(doc(db, "positions", id));
    state.expanded.delete(id);
    if (state.wish[id] && canWish()){ const uid = state.uid; delete state.wish[id]; wishWrite(id, () => deleteDoc(doc(db, "users", uid, "wishlist", id))); }
    toast("Position deleted");
  } catch(e){ onWriteError(e); }
}
async function loadStarter(){
  if (!state.isAdmin || state.seeding) return;
  state.seeding = true; render();
  try {
    const res = await fetch("starter-positions.json", {cache:"no-store"});
    if (!res.ok) throw new Error("fetch");
    const list = await res.json();
    const batch = writeBatch(db);
    let n = 0;
    for (const item of list){
      if (!item || typeof item.id !== "string") continue;
      const {id, ...data} = item;
      data.source = "starter"; data.addedBy = null;
      batch.set(doc(db, "positions", id), data);
      if (++n >= 450) break;
    }
    await batch.commit();
    toast("Loaded " + plural(n, "programme") + " from the starter list");
  } catch(e){
    if (e && e.code) onWriteError(e);
    else toast("The starter list file couldn't be read. Check that starter-positions.json was uploaded with the site.");
  } finally { state.seeding = false; render(); }
}

/* ---------- Editor ---------- */
const dlg = $("#dlg");
function buildTagPick(selected){
  const box = $("#tagPick"); box.replaceChildren();
  TAGS.forEach((t, i) => {
    const id = "tg-" + i;
    box.append(h("label", {for:id}, h("input", {type:"checkbox", id, value:t, checked:selected.includes(t)}), t));
  });
  $("#f-tags-other").value = selected.filter(t => !TAGS.includes(t)).join(", ");
}
function readTags(){
  const picked = [...document.querySelectorAll("#tagPick input:checked")].map(i => i.value);
  const other = $("#f-tags-other").value.split(",").map(s => s.trim()).filter(Boolean);
  return cleanTags(picked.concat(other));
}
function syncDateField(){
  const fixed = $("#f-dtype").value === "fixed";
  $("#dateWrap").hidden = !fixed; $("#estWrap").hidden = !fixed;
}
function setSelect(sel, val){
  const el = $(sel);
  [...el.querySelectorAll("option[data-custom]")].forEach(o => o.remove());
  if (val && ![...el.options].some(o => o.value === val)){
    el.prepend(h("option", {value:val, "data-custom":"1"}, val));
  }
  el.value = val || el.options[0].value;
}
function openEditor(id){
  if (!state.uid) return;
  editingId = id || null;
  const p = id ? state.positions.get(id) : null;
  $("#dlgTitle").textContent = p ? "Edit position" : "Add a position";
  $("#dlgSave").textContent = p ? "Save changes" : "Add position";
  $("#f-title").value = p ? p.title : "";
  $("#f-host").value = p ? p.host : "";
  setSelect("#f-level", p ? p.level : "PhD");
  setSelect("#f-field", p ? p.field : "Bio");
  $("#f-dtype").value = p ? p.deadlineType : "fixed";
  $("#f-date").value = p && parseYMD(p.deadline) ? p.deadline : "";
  $("#f-est").checked = p ? p.estimated : false;
  $("#f-url").value = p ? p.url : "";
  $("#f-elig").value = p ? p.eligibility : "";
  $("#f-fund").value = p ? p.funding : "";
  $("#f-window").value = p ? p.window : "";
  $("#f-notes").value = p ? p.notes : "";
  buildTagPick(p ? p.tags : []);
  $("#dlgErr").textContent = "";
  syncDateField();
  dlg.showModal();
  $("#f-title").focus();
}
async function savePosition(){
  if (!state.uid){ $("#dlgErr").textContent = "Sign in to save."; return; }
  const v = id => $(id).value.trim();
  let url = v("#f-url");
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  const dtype = $("#f-dtype").value;
  const tags = readTags();
  const data = {
    title:v("#f-title").slice(0,200), host:v("#f-host").slice(0,120),
    level:$("#f-level").value.slice(0,160), field:$("#f-field").value,
    deadlineType:dtype, deadline:dtype === "fixed" ? $("#f-date").value : "",
    estimated:dtype === "fixed" && $("#f-est").checked,
    url:url.slice(0,500), eligibility:v("#f-elig").slice(0,1000), funding:v("#f-fund").slice(0,1000),
    window:v("#f-window").slice(0,300), notes:v("#f-notes").slice(0,1500), tags
  };
  const missing = [];
  if (!data.title) missing.push("a program or position name");
  if (!data.host) missing.push("a host country or region");
  if (dtype === "fixed" && !parseYMD(data.deadline)) missing.push("the deadline date");
  if (!tags.length) missing.push("at least one domain");
  if (!safeUrl(data.url)) missing.push("an official link");
  if (missing.length){
    const txt = missing.length === 1 ? missing[0] : missing.slice(0,-1).join(", ") + " and " + missing[missing.length-1];
    $("#dlgErr").textContent = "Add " + txt + " to save.";
    return;
  }
  const btn = $("#dlgSave"); btn.disabled = true;
  const now = nowIso(), name = firstName(state.user);
  try {
    if (editingId){
      await updateDoc(doc(db, "positions", editingId), Object.assign({}, data, {updatedBy:state.uid, updatedByName:name, updatedAt:now}));
      dlg.close(); toast("Changes saved");
    } else {
      const ref = await addDoc(collection(db, "positions"), Object.assign({}, data, {addedBy:state.uid, addedByName:name, createdAt:now, source:"community"}));
      dlg.close(); toast("Position added for everyone");
      if (ref && ref.id){ state.expanded.add(ref.id); requestRender(); }
    }
  } catch(e){ onWriteError(e, true); }
  finally { btn.disabled = false; }
}

/* ---------- Exports ---------- */
function csvCell(c){
  let s = String(c == null ? "" : c);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportWishlist(){
  const rows = [["Program","Host","Level","Field","Domains","Deadline","Estimated date","Days left","My progress","My notes","Website"]];
  const items = [...state.positions.values()].filter(p => state.wish[p.id]).sort(cmpDeadline);
  for (const p of items){
    const d = deadlineDate(p), w = state.wish[p.id];
    rows.push([p.title, p.host, p.level, fieldLabel(p.field), p.tags.join("; "),
      p.deadlineType === "rolling" ? "Rolling" : d ? p.deadline : "Varies",
      d && p.estimated ? "Yes" : "", d ? daysLeft(p) : "", progressLabel(w.status), w.note || "", safeUrl(p.url)]);
  }
  downloadFile("my-wishlist.csv", "\ufeff" + rows.map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv");
  toast("Wishlist downloaded");
}
function exportCalendar(){
  const items = [...state.positions.values()].filter(p => state.wish[p.id] && daysLeft(p) != null && daysLeft(p) >= 0).sort(cmpDeadline);
  if (!items.length){ toast("None of your saved positions has an upcoming fixed deadline yet."); return; }
  downloadFile("wishlist-deadlines.ics", icsFor(items), "text/calendar");
  toast("Calendar file downloaded. Open it to add the deadlines and reminders to your calendar.");
}

/* ---------- Firebase wiring ---------- */
function applyWishSnap(snap){
  const next = {};
  snap.forEach(d => {
    const x = d.data(); if (!x) return;
    next[d.id] = {status:PROGRESS.some(p => p[0] === x.status) ? x.status : "saved", note:S(x.note), savedAt:S(x.savedAt)};
  });
  state.wish = next;
}
function afterWishLoaded(){
  if (pendingSave){
    const id = pendingSave; pendingSave = null;
    if (!state.wish[id] && state.positions.has(id)) toggleSave(id);
  }
}
function startWishlist(uid){
  const q = query(collection(db, "users", uid, "wishlist"), limit(1000));
  unsubWish = onSnapshot(q, {includeMetadataChanges:true}, snap => {
    if (state.uid !== uid) return;
    if (!state.wishLoaded && snap.metadata.fromCache) return;
    applyWishSnap(snap);
    if (!state.wishLoaded){ state.wishLoaded = true; state.wishError = false; afterWishLoaded(); }
    requestRender();
  }, () => { if (state.uid === uid && !state.wishLoaded){ state.wishError = true; requestRender(); } });
  const loadOnce = async (tries) => {
    try {
      const snap = await getDocs(q);
      if (state.uid === uid && !state.wishLoaded){ applyWishSnap(snap); state.wishLoaded = true; state.wishError = false; afterWishLoaded(); requestRender(); }
    } catch(e){
      if (tries > 0) setTimeout(() => loadOnce(tries - 1), 800 + Math.random() * 800);
      else if (state.uid === uid && !state.wishLoaded){ state.wishError = true; requestRender(); }
    }
  };
  loadOnce(1);
  getDoc(doc(db, "users", uid)).then(s => {
    const x = s.exists() ? s.data() : null;
    if (state.uid === uid && x && REMIND_CHOICES.includes(x.remindDays)){ state.remindDays = x.remindDays; requestRender(); }
  }).catch(() => {});
}

/* ---------- UI wiring ---------- */
$("#tabAll").addEventListener("click", () => { state.tab = "all"; render(); });
$("#tabWish").addEventListener("click", () => { state.tab = "wish"; render(); });
$("#q").addEventListener("input", e => { state.q = e.target.value.trim(); render(); });
$("#fField").addEventListener("change", e => { state.field = e.target.value; render(); });
$("#fTag").addEventListener("change", e => { state.tag = e.target.value; render(); });
$("#fLevel").addEventListener("change", e => { state.level = e.target.value; render(); });
$("#fStatus").addEventListener("change", e => { state.status = e.target.value; render(); });
$("#fSort").addEventListener("change", e => { state.sort = e.target.value; render(); });
$("#dlgCancel").addEventListener("click", () => dlg.close());
$("#dlgSave").addEventListener("click", savePosition);
$("#f-dtype").addEventListener("change", syncDateField);
dlg.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox"){ e.preventDefault(); savePosition(); }
});
$("#list").addEventListener("focusout", () => {
  if (renderPending){ renderPending = false; setTimeout(render, 0); }
});
setInterval(() => { if (state.loaded) requestRender(); }, 60 * 60 * 1000);

/* ---------- Start ---------- */
state.configured = !!(firebaseConfig && typeof firebaseConfig.apiKey === "string" && firebaseConfig.projectId
  && !/PASTE|YOUR_/i.test(firebaseConfig.apiKey) && !/your-project-id/i.test(firebaseConfig.projectId));

if (!state.configured){
  const s = $("#setup");
  s.textContent = "This site isn't connected to its database yet. Paste your Firebase settings into config.js, following the steps in README.md.";
  s.hidden = false;
  render();
} else {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  render();
  onSnapshot(query(collection(db, "positions"), limit(1000)), snap => {
    const m = new Map();
    snap.forEach(d => { const x = d.data(); if (x) m.set(d.id, normalize(d.id, x)); });
    state.positions = m; state.loaded = true; state.loadError = null;
    requestRender();
  }, err => { state.loadError = (err && err.code) || "unavailable"; state.loaded = true; requestRender(); });

  onAuthStateChanged(auth, u => {
    if (u && !emailAllowed(u)){
      // A non-IITGN account (for example one signed in before the restriction): sign it out.
      signOut(auth).catch(() => {});
      u = null;
    }
    if (unsubWish){ unsubWish(); unsubWish = null; }
    writeChains.clear();
    state.user = u || null; state.uid = u ? u.uid : null;
    state.isAdmin = !!(u && u.email && u.emailVerified && ADMINS.includes(u.email.toLowerCase()));
    state.wish = {}; state.wishLoaded = false; state.wishError = false; state.remindDays = 14;
    state.authReady = true;
    if (u) startWishlist(u.uid); else pendingSave = null;
    render();
  });
}
