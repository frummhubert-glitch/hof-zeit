'use strict';
/* Hof-Zeiterfassung – eine App, zwei Modi:
   'ma' = Mitarbeiter (erfassen + Wochendatei senden)
   'bl' = Betriebsleitung (Wochendateien einlesen + auswerten)
   Die Daten liegen lokal auf dem Gerät (localStorage). Ist ein Zugangscode hinterlegt,
   werden sie zusätzlich online abgeglichen (siehe „Online-Abgleich“). */

const KEY = 'zeiterfassung.v1';
const QUICK_COUNT = 6;
const DEFAULT_ACTS = [
  'Füttern', 'Melken', 'Stallarbeit', 'Ernte', 'Bodenbearbeitung', 'Maschinenpflege / Werkstatt',
  'Pflügen', 'Grubbern', 'Aussaat', 'Düngung', 'Pflanzenschutz', 'Mähen', 'Grünland / Futterbergung', 'Tierkontrolle / Tierpflege',
  'Transport / Fahrten', 'Hofarbeiten / Aufräumen', 'Zaunbau / Weidepflege', 'Forstarbeit',
  'Büro / Dokumentation', 'Sonstiges'
];
// Acker- und futterbauliche Tätigkeiten: hier kann ein Feldstück angegeben werden
const DEFAULT_FIELD_ACTS = ['Ernte', 'Bodenbearbeitung', 'Pflügen', 'Grubbern', 'Aussaat', 'Düngung', 'Pflanzenschutz', 'Mähen', 'Grünland / Futterbergung'];
const NEW_ACTS_V2 = ['Pflügen', 'Grubbern', 'Mähen'];
const TYPE_LABEL = { arbeit: 'Arbeit', urlaub: 'Urlaub', krank: 'Krank' };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const CSV_HEAD = ['Mitarbeiter', 'Datum', 'Art', 'Beginn', 'Ende', 'Pause_Min', 'Stunden', 'Taetigkeiten', 'Notiz', 'Erfasst_am', 'Status', 'Aenderungen', 'Pausen', 'Feldstuecke'];
const CSV_MIN_COLS = 9; // ältere Dateien ohne Änderungsprotokoll
const REASON_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // ab 2 Tagen nach Ersterfassung ist ein Grund Pflicht

/* ---------- Hilfsfunktionen ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const deDate = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const dayLabel = s => `${WD[parseISO(s).getDay()]}, ${deDate(s)}`;
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return `${MON[mo - 1]} ${y}`; };
const fmtH = h => h.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sign = h => (Math.abs(h) < 0.005 ? '' : h > 0 ? '+' : '') + fmtH(Math.abs(h) < 0.005 ? 0 : h); // Saldo mit Vorzeichen
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => iso(new Date());
// Wochen: gekennzeichnet durch das Datum ihres Montags
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = s => addDays(s, -((parseISO(s).getDay() + 6) % 7));
// Kalenderwoche nach ISO: die Woche gehört zu dem Jahr, in dem ihr Donnerstag liegt
const weekNo = ws => {
  const thu = parseISO(addDays(ws, 3)), y = thu.getFullYear();
  return { y, w: Math.floor(Math.round((thu - new Date(y, 0, 1)) / 86400000) / 7) + 1 };
};
const weekLabel = ws => `KW ${weekNo(ws).w} · ${deDate(ws).slice(0, 6)}–${deDate(addDays(ws, 6))}`;
const weekId = ws => `${weekNo(ws).y}-KW${pad(weekNo(ws).w)}`;
const BREAKS = [['fruehstueck', 'Frühstück'], ['mittag', 'Mittagessen'], ['brotzeit', 'Brotzeit'], ['sonstige', 'Sonstige Pause']];
const cloneBreaks = b => Object.fromEntries(BREAKS.map(([k]) => {
  const x = (b && b[k]) || {};
  return [k, { from: x.from || '', to: x.to || '' }];
}));
const MAIN_BREAKS = BREAKS.slice(0, 3); // Frühstück, Mittagessen, Brotzeit
const breakLabel = k => BREAKS.find(b => b[0] === k)[1];
const nowHM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
const spanMin = (from, to) => {
  const [a, b] = from.split(':').map(Number), [c, d] = to.split(':').map(Number);
  let m = (c * 60 + d) - (a * 60 + b);
  if (m < 0) m += 1440;
  return m;
};
const breakSum = b => BREAKS.reduce((sum, [k]) => sum + (b && b[k] && b[k].from && b[k].to ? spanMin(b[k].from, b[k].to) : 0), 0);
const breaksText = b => BREAKS.filter(([k]) => b && b[k] && b[k].from && b[k].to).map(([k, l]) => `${l} ${b[k].from}–${b[k].to}`).join(', ');
const actsText = e => (e.acts || []).map(a => e.fields && e.fields[a] ? `${a} (${e.fields[a]})` : a).join(', ');
const fieldsText = e => Object.entries(e.fields || {}).map(([a, f]) => `${a}: ${f}`).join(' | ');
const nowTs = () => new Date().toISOString();
const fmtTs = ts => { const d = new Date(ts); return isNaN(d) ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const needsReason = e => Date.now() - Date.parse(e.created) > REASON_AFTER_MS;

function hours(e) {
  if (e.type !== 'arbeit' || !e.start || !e.end) return 0;
  // spanMin rechnet auch über Mitternacht (z. B. Ernte)
  return Math.max(0, spanMin(e.start, e.end) - (Number(e.pause) || 0)) / 60;
}

function stats(entries) {
  const s = { hours: 0, workDays: new Set(), urlaub: new Set(), krank: new Set(), byAct: {}, byField: {} };
  for (const e of entries) {
    if (e.deleted) continue;
    const who = (e.name || '') + '|' + e.date;
    if (e.type === 'arbeit') {
      const h = hours(e);
      s.hours += h;
      s.workDays.add(who);
      const acts = e.acts && e.acts.length ? e.acts : ['Ohne Angabe'];
      for (const a of acts) {
        s.byAct[a] = (s.byAct[a] || 0) + h / acts.length;
        const fld = e.fields && e.fields[a];
        if (fld) s.byField[fld + '|' + a] = (s.byField[fld + '|' + a] || 0) + h / acts.length;
      }
    } else if (e.type === 'urlaub') s.urlaub.add(who);
    else if (e.type === 'krank') s.krank.add(who);
  }
  return s;
}

// Soll-Arbeitszeit eines Mitarbeiters: eigene Vorgabe, sonst die allgemeine
const targetOf = name => { const t = state.targets.emp[name]; return t && t.h > 0 ? t : state.targets.default; };

// Überstunden-Konto: je Zeitraum (Woche oder Monat) Ist + Gutschrift − Soll, fortlaufend summiert.
// Minusstunden gehen damit automatisch vom Guthaben ab. Der laufende Zeitraum zählt noch nicht mit.
function overtime(entries, target, todayStr) {
  if (!target || !(target.h > 0)) return null;
  const perWeek = target.per === 'week';
  // shortcut: Urlaubs-/Krankheitstag = 1/5 des Wochen-Solls (5-Tage-Woche), bei anderem Modell Tage je Woche einstellbar machen
  const dayCredit = (perWeek ? target.h : target.h * 12 / 52) / 5;
  const keyOf = d => perWeek ? weekStart(d) : d.slice(0, 7);
  const current = keyOf(todayStr);
  const periods = {};
  for (const e of entries) {
    if (e.deleted) continue;
    const p = periods[keyOf(e.date)] ||= { ist: 0, days: new Set() };
    if (e.type === 'arbeit') p.ist += hours(e); else p.days.add(e.date);
  }
  let saldo = 0;
  const rows = Object.keys(periods).sort().map(k => {
    const p = periods[k], credit = p.days.size * dayCredit, diff = p.ist + credit - target.h, open = k >= current;
    if (!open) saldo += diff;
    return { k, ist: p.ist, credit, diff, open, saldo };
  });
  return { rows, saldo };
}

// Resturlaub im Kalenderjahr: Jahresanspruch minus eingetragene Urlaubstage (auch künftige)
const vacOf = name => (state.targets.emp[name] || {}).vac || state.targets.default.vac || 0;
function vacation(entries, days, year) {
  if (!(days > 0)) return null;
  const used = new Set(entries.filter(e => !e.deleted && e.type === 'urlaub' && e.date.startsWith(year)).map(e => e.date)).size;
  return { days, used, left: days - used };
}
const fmtDays = n => String(n).replace('.', ',');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------- Zustand ---------- */
function blank() {
  return {
    role: null, name: '', activities: DEFAULT_ACTS.slice(), fieldActs: DEFAULT_FIELD_ACTS.slice(), fieldNames: [], usage: {}, entries: [], imports: {}, fixes: {}, sent: {}, clock: null, device: '',
    targets: { default: { h: 0, per: 'week' }, emp: {} }, // Soll-Arbeitszeit: allgemein und abweichend je Mitarbeiter
    last: { start: '07:00', end: '16:00', pause: 30 },
    cloud: { code: '', pushed: {}, since: '', live: [], ok: '', err: '' } // Online-Abgleich
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      const st = Object.assign(blank(), s);
      for (const e of st.entries) if (!e.created) e.created = nowTs();
      if (!s.fieldActs) { // ältere Version: neue Feld-Tätigkeiten ergänzen
        for (const a of NEW_ACTS_V2) if (!st.activities.includes(a)) st.activities.push(a);
        st.fieldActs = st.fieldActs.filter(a => st.activities.includes(a));
      }
      if (st.clock && !st.clock.breaks) st.clock.breaks = cloneBreaks(); // Stempelzeit aus Version 1.3
      if (Object.values(st.imports).some(x => !x.week)) { // ältere Version: eingelesene Daten lagen je Monat
        const old = Object.values(st.imports);
        st.imports = {};
        for (const x of old) Object.assign(st.imports, groupImports(x.entries, x.importedAt));
      }
      return st;
    }
  } catch { /* defekte Daten ignorieren */ }
  return blank();
}
function save() { persist(); if (state.role === 'ma') queueSync(); }
function persist() {
  // shortcut: alles in einem localStorage-Schlüssel (ca. 5 MB), bei vollem Speicher alte Wochen entfernen oder auf IndexedDB umstellen
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Speichern fehlgeschlagen – Speicher voll. Bitte alte Wochen unter „Einlesen“ entfernen.'); }
}

// Eingelesene Einträge je Mitarbeiter, Woche und Monat ablegen. Der Monat gehört zum Schlüssel,
// damit eine alte Monatsdatei nicht die Tage des Nachbarmonats derselben Woche ersetzt.
function groupImports(entries, importedAt) {
  const sets = {};
  for (const e of entries) {
    const week = weekStart(e.date), month = e.date.slice(0, 7);
    (sets[`${e.name}|${week}|${month}`] ||= { name: e.name, week, month, importedAt, entries: [] }).entries.push(e);
  }
  return sets;
}

let state = load();
const ui = { tab: null, week: weekStart(today()), blMonth: '', blEmp: '', emp: '', pick: false };
let form = newForm();

function newForm(date) {
  const c = state.clock; // laufende Stempelzeit hat Vorrang vor den zuletzt genutzten Zeiten
  const d = date || (c ? c.date : today());
  const stamped = c && c.date === d;
  const br = stamped ? c.breaks : state.last.breaks;
  return {
    id: null, date: d, to: d, type: 'arbeit', start: stamped ? c.start : state.last.start, end: stamped ? (c.end || '') : state.last.end,
    pause: breakSum(br), breaks: cloneBreaks(br), legacyPause: 0, fields: {}, newAct: false, acts: [], note: '', skipWe: true, reason: ''
  };
}

/* ---------- CSV (Wochendatei) ---------- */
function csvField(v) {
  v = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // Schutz vor Formeln in Excel
  return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// Beschreibung eines Eintrags (für das Änderungsprotokoll: „vorher …")
function describe(e) {
  const t = entryText(e);
  return [deDate(e.date), t.head, t.sub].filter(Boolean).join(' · ');
}

// Ersterfassung, Status und Änderungsprotokoll – für eigene und für eingelesene Einträge
function meta(e) {
  if (e.log !== undefined) return { created: e.createdTxt || '', status: e.status || '', log: e.log };
  const parts = (e.changes || []).map(c => `${fmtTs(c.at)}: vorher ${c.before}${c.reason ? ` – Grund: ${c.reason}` : ''}`);
  if (e.deleted) parts.push(`${fmtTs(e.deleted.at)}: gelöscht${e.deleted.reason ? ` – Grund: ${e.deleted.reason}` : ''}`);
  return { created: e.created ? fmtTs(e.created) : '', status: e.deleted ? 'gelöscht' : parts.length ? 'geändert' : '', log: parts.join(' || ') };
}

// Auffälligkeit für die Betriebsleitung: geändert, gelöscht oder nachgetragen
const flagOf = e => e.status || (e.kept ? 'von früherem Gerät' : e.late ? 'nachgetragen' : '');
// Offene Stempelzeit gilt erst 16 Stunden nach Arbeitsbeginn als vergessen (Erntenächte gehen über Mitternacht)
const staleClock = k => !!k && Date.now() - new Date(`${k.date}T${k.start || '00:00'}`).getTime() > 16 * 3600000;

function toCSV(entries) {
  const rows = entries.slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''))
    .map(e => [
      e.name, deDate(e.date), TYPE_LABEL[e.type],
      e.type === 'arbeit' ? e.start : '', e.type === 'arbeit' ? e.end : '',
      e.type === 'arbeit' ? (Number(e.pause) || 0) : '',
      e.type === 'arbeit' && !e.deleted ? fmtH(hours(e)) : '',
      (e.acts || []).join(' | '), e.note || '',
      meta(e).created, meta(e).status, meta(e).log, breaksText(e.breaks), fieldsText(e)
    ].map(csvField).join(';'));
  return '﻿' + [CSV_HEAD.join(';'), ...rows].join('\r\n') + '\r\n';
}

function splitCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseCSV(text) {
  // Excel speichert oft nicht in UTF-8: Umlaute wären kaputt und „gelöscht“ würde nicht mehr erkannt
  if (text.includes('�')) throw new Error('Umlaute sind beschädigt – wurde die Datei in Excel gespeichert? Bitte die Originaldatei aus WhatsApp einlesen.');
  const rows = splitCSV(text.replace(/^﻿/, ''));
  if (!rows.length || rows[0][0].trim() !== 'Mitarbeiter' || rows[0].length < CSV_MIN_COLS) {
    throw new Error('kein gültiges Format');
  }
  const unq = v => (v || '').replace(/^'(?=[=+\-@\t\r])/, '').trim();
  const typeOf = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [v.toLowerCase(), k]));
  const out = [];
  for (const r of rows.slice(1)) {
    if (r.length < 3 || !r.some(x => x.trim())) continue;
    const name = unq(r[0]);
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(r[1].trim());
    const date = m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : (/^\d{4}-\d{2}-\d{2}$/.test(r[1].trim()) ? r[1].trim() : null);
    const type = typeOf[(r[2] || '').trim().toLowerCase()];
    if (!name || !date || iso(parseISO(date)) !== date || !type) continue; // auch 99.99. oder 31.02. verwerfen
    const e = { id: uid(), name, date, type, acts: [], note: unq(r[8]) };
    if (type === 'arbeit') {
      const t = /^\d{1,2}:\d{2}$/;
      if (!t.test((r[3] || '').trim()) || !t.test((r[4] || '').trim())) continue;
      e.start = r[3].trim().padStart(5, '0');
      e.end = r[4].trim().padStart(5, '0');
      e.pause = Math.max(0, parseInt(r[5], 10) || 0);
      e.acts = (r[7] || '').split('|').map(unq).filter(Boolean);
      e.breaks = cloneBreaks();
      for (const [k, l] of BREAKS) {
        const bm = new RegExp(l + ' (\\d{2}:\\d{2})–(\\d{2}:\\d{2})').exec(r[12] || '');
        if (bm) e.breaks[k] = { from: bm[1], to: bm[2] };
      }
      e.fields = {};
      for (const part of (r[13] || '').split('|').map(unq).filter(Boolean)) {
        const act = e.acts.filter(a => part.startsWith(a + ': ')).sort((x, y) => y.length - x.length)[0];
        if (act) e.fields[act] = part.slice(act.length + 2).trim();
      }
    }
    e.createdTxt = unq(r[9]);
    // nachgetragen: erst mehr als 2 Tage nach dem Arbeitstag erfasst
    const cm = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(e.createdTxt);
    e.late = !!cm && parseISO(`${cm[3]}-${cm[2]}-${cm[1]}`) - parseISO(date) > REASON_AFTER_MS;
    e.status = unq(r[10]).toLowerCase();
    e.log = unq(r[11]);
    if (e.status === 'gelöscht') e.deleted = true;
    out.push(e);
  }
  if (!out.length) throw new Error('keine Einträge gefunden');
  return out;
}

function fileNameFor(name, month) {
  const safe = name.trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'Mitarbeiter';
  return `Zeiterfassung_${safe}_${month}.csv`;
}

const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// Android-App: Datei im App-Cache ablegen und über das Teilen-Menü (z. B. WhatsApp) versenden
async function nativeShare(file, title) {
  try {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    const res = await Filesystem.writeFile({ path: file.name, data: await file.text(), directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title, dialogTitle: `${file.name} senden oder speichern`, files: [res.uri] });
    return true;
  } catch (err) {
    if (!/cancel/i.test(String(err && err.message))) toast('Datei konnte nicht geteilt werden: ' + (err && err.message));
  }
}

function download(file) {
  if (isNative()) return nativeShare(file, file.name);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function weekEntries(week) {
  return state.entries.filter(e => weekStart(e.date) === week).map(e => ({ ...e, name: state.name }));
}

async function exportWeek(shareIt) {
  if (!state.name.trim()) { toast('Bitte zuerst den Namen in den Einstellungen eintragen.'); return; }
  const week = ui.week;
  const entries = weekEntries(week);
  if (!entries.length) { toast('In dieser Woche ist noch nichts erfasst.'); return; }
  const file = new File([toCSV(entries)], fileNameFor(state.name, weekId(week)), { type: 'text/csv' });
  // Sendezeitpunkt merken: spätere Änderungen in dieser Woche lösen den Hinweis „erneut senden“ aus
  const sent = () => { state.sent[week] = nowTs(); save(); render(); };
  if (isNative()) { if (await nativeShare(file, `Zeiterfassung ${state.name} – ${weekLabel(week)}`)) sent(); return; }
  if (shareIt && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Zeiterfassung ${weekLabel(week)}`, text: `Zeiterfassung ${state.name} – ${weekLabel(week)}` });
      sent();
    } catch (err) {
      if (err.name !== 'AbortError') { download(file); sent(); toast('Teilen nicht möglich – Datei wurde heruntergeladen.'); }
    }
  } else {
    download(file);
    sent();
    toast(shareIt ? 'Teilen wird hier nicht unterstützt – Datei wurde heruntergeladen.' : 'Datei wurde heruntergeladen.');
  }
}

/* ---------- Online-Abgleich ---------- */
// Supabase-Projekt. Adresse und Schlüssel sind öffentlich; geschützt wird über den Zugangscode,
// den die Datenbank bei jedem Aufruf prüft (siehe supabase.sql).
const CLOUD_URL = 'https://bbrbvqlaczguyxwyglqn.supabase.co';
const CLOUD_KEY = 'sb_publishable_iROZcSiPVMIrVBxk5pOrkA_Vo4BJtcH';
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h; };

async function rpc(fn, args) {
  let r;
  try {
    r = await fetch(`${CLOUD_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: CLOUD_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  } catch { throw new Error('keine Verbindung'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `Fehler ${r.status}`);
  return r.status === 204 ? null : r.json();
}

// Mitarbeiter: Wochen (im Format der Wochendatei) und Stempelstand, die sich seit dem letzten Abgleich geändert haben
function pushPlan() {
  const weeks = {}, hashes = {};
  for (const w of new Set(state.entries.map(e => weekStart(e.date)))) {
    const csv = toCSV(weekEntries(w)), h = hash(csv);
    if (state.cloud.pushed[w] !== h) { weeks[w] = csv; hashes[w] = h; }
  }
  const ch = hash(state.name + JSON.stringify(state.clock));
  if (state.cloud.pushed.clock !== ch) hashes.clock = ch;
  return { weeks, hashes };
}

// Betriebsleitung: abgerufene Wochen wie eingelesene Dateien übernehmen. Liefert true, wenn sich etwas geändert hat.
function applyPull(res) {
  const c = state.cloud;
  let changed = false;
  for (const row of res.weeks) {
    try {
      for (const [key, set] of Object.entries(groupImports(parseCSV(row.csv), today()))) {
        // Im Normalbetrieb verschwindet nie eine Zeile (Gelöschtes bleibt markiert stehen). Fehlt eine,
        // wurde die App beim Mitarbeiter neu installiert: die bisherigen Zeilen behalten.
        const idOf = e => e.date + '|' + e.createdTxt, have = new Set(set.entries.map(idOf));
        for (const e of (state.imports[key] || { entries: [] }).entries) if (!have.has(idOf(e))) set.entries.push({ ...e, kept: true });
        state.imports[key] = set;
      }
      changed = true;
    } catch { /* unlesbare Woche überspringen */ }
    if (!(c.since >= row.updated_at)) c.since = row.updated_at;
  }
  // Online umbenannte oder gelöschte Mitarbeiter auch hier entfernen; eingelesene Dateien bleiben unberührt
  const names = new Set(res.staff.map(s => s.name));
  for (const [key, set] of Object.entries(state.imports)) {
    if (names.has(set.name)) set.cloud = true;
    else if (set.cloud) { delete state.imports[key]; changed = true; }
  }
  if (JSON.stringify(res.staff) !== JSON.stringify(c.live)) { c.live = res.staff; changed = true; }
  return changed;
}

let syncing = false;
function queueSync() { clearTimeout(queueSync.t); queueSync.t = setTimeout(sync, 1500); }

// Gleicht ab, sobald ein Zugangscode hinterlegt ist. Ohne Netz bleibt alles lokal und wird später nachgeholt.
async function sync() {
  const c = state.cloud;
  if (!CLOUD_URL || !c.code || !state.role || syncing) return;
  syncing = true;
  let changed = false;
  try {
    if (state.role === 'bl') changed = applyPull(await rpc('zeit_pull', { p_code: c.code, p_since: c.since || null }));
    else {
      const p = pushPlan();
      if (Object.keys(p.hashes).length) {
        state.device ||= uid() + uid(); // bindet den Namen an dieses Gerät
        await rpc('zeit_push', { p_code: c.code, p_name: state.name, p_weeks: p.weeks, p_clock: state.clock, p_dev: state.device });
        Object.assign(c.pushed, p.hashes);
      }
    }
    c.ok = nowTs(); c.err = '';
  } catch (err) { c.err = err.message; }
  syncing = false;
  persist();
  // nicht mitten in eine Eingabe oder einen aufgeklappten Bereich hinein neu zeichnen
  if (changed && ui.tab === 'auswertung' && !$('#view input:focus, #view details[open]')) render();
  // während des Abgleichs Gespeichertes gleich nachschieben
  if (state.role === 'ma' && !c.err && Object.keys(pushPlan().hashes).length) queueSync();
}

function cloudCard() {
  if (!CLOUD_URL) return '';
  const c = state.cloud, bl = state.role === 'bl';
  const status = !c.code ? 'Nicht eingerichtet.' : c.err ? `Abgleich fehlgeschlagen: ${c.err}` : c.ok ? `Zuletzt abgeglichen: ${fmtTs(c.ok)}` : 'Noch nicht abgeglichen.';
  return `<section class="card">
      <h3>Online-Abgleich</h3>
      <p class="hint">${bl ? 'Holt die Einträge und den Stempelstand der Mitarbeiter automatisch ab – ohne Wochendatei.'
        : 'Überträgt Ihre Einträge und den Stempelstand automatisch an die Betriebsleitung. Ohne Netz wird es später nachgeholt.'}</p>
      <label class="fld">Zugangscode ${bl ? 'Betriebsleitung' : 'Mitarbeiter'}
        <input type="${bl ? 'password' : 'text'}" data-change="cloudCode" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(c.code)}"></label>
      <p class="${c.err ? 'flag' : 'hint'}">${esc(status)}</p>
      ${c.code ? '<button type="button" data-action="sync">Jetzt abgleichen</button>' : ''}
    </section>`;
}

// Betriebsleitung: wer heute eingestempelt ist, Pause macht oder den Tag schon gespeichert hat
function liveCard() {
  const c = state.cloud, d = today(), rows = {};
  if (!c.code) return '';
  for (const e of importSets().flatMap(s => s.entries)) if (e.date === d && !e.deleted) rows[e.name] = `Erfasst: ${entryText(e).head}`;
  for (const s of c.live) {
    const k = s.clock;
    if (!k || k.date !== d) continue;
    const run = k.running && BREAKS.find(b => b[0] === k.running);
    rows[s.name] = k.end ? `Gestempelt ${k.start}–${k.end} Uhr, noch nicht gespeichert`
      : run ? `${run[1]} seit ${((k.breaks || {})[run[0]] || {}).from} Uhr` : `Arbeitet seit ${k.start} Uhr`;
  }
  const names = Object.keys(rows).sort((a, b) => a.localeCompare(b));
  return `<section class="card">
      <h2>Heute</h2>
      ${names.length ? `<ul class="entries">${names.map(n => `<li class="entry"><div class="e-main"><strong>${esc(n)}</strong><span>${esc(rows[n])}</span></div></li>`).join('')}</ul>`
        : '<p class="hint">Heute ist noch niemand eingestempelt.</p>'}
      <p class="${c.err ? 'flag' : 'hint'}">${esc(c.err ? `Abgleich fehlgeschlagen: ${c.err}` : `Stand: ${fmtTs(c.ok)} · wird jede Minute aktualisiert`)}</p>
    </section>`;
}

/* ---------- Ansichten: gemeinsam ---------- */
function entryText(e) {
  if (e.type === 'arbeit') {
    return {
      head: `${e.start}–${e.end} · ${fmtH(hours(e))} Std.`,
      sub: [actsText(e), breaksText(e.breaks) || (e.pause ? `Pause ${e.pause} Min.` : ''), e.note].filter(Boolean).join(' · ')
    };
  }
  return { head: TYPE_LABEL[e.type], sub: e.note || '' };
}

function entryRow(e) {
  const t = entryText(e);
  return `<li class="entry ${e.type}">
    <div class="e-main"><strong>${esc(t.head)}</strong>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}${e.changes && e.changes.length ? '<span class="flag">nachträglich geändert</span>' : ''}</div>
    <div class="e-act">
      <button type="button" class="small" data-action="edit" data-id="${e.id}">Ändern</button>
      <button type="button" class="small danger" data-action="del" data-id="${e.id}" aria-label="Eintrag löschen">Löschen</button>
    </div></li>`;
}

function tiles(list) {
  return `<div class="tiles">${list.map(([v, l]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
}

function viewStart() {
  return `<section class="card">
    <img class="hero" src="icons/logo.svg" alt="" width="104" height="104">
    <h2>Willkommen</h2>
    <p class="hint">Wie wird die App auf diesem Gerät genutzt? Das lässt sich später in den Einstellungen ändern.</p>
    <label class="fld">Ihr Name (für Mitarbeiter)
      <input type="text" id="startName" autocomplete="name" placeholder="Vorname Nachname" value="${esc(state.name)}"></label>
    <button type="button" class="role-btn" data-action="role" data-v="ma"><b>Mitarbeiter</b><span>Arbeitszeit, Urlaub und Krankheit erfassen</span></button>
    <button type="button" class="role-btn" data-action="role" data-v="bl"><b>Betriebsleitung</b><span>Wochendateien einlesen und auswerten</span></button>
  </section>`;
}

/* ---------- Ansichten: Mitarbeiter ---------- */
function quickActs() {
  return state.activities
    .map((a, i) => ({ a, i, n: state.usage[a] || 0 }))
    .sort((x, y) => y.n - x.n || x.i - y.i)
    .slice(0, QUICK_COUNT).map(x => x.a);
}

// Feldstück-Eingabe für jede gewählte acker-/futterbauliche Tätigkeit
function fieldInputs(f) {
  const fa = f.acts.filter(a => state.fieldActs.includes(a));
  if (!fa.length) return '';
  return `<h3>Feldstück</h3>
    <p class="hint">Optional – auf welchem Feldstück wurde gearbeitet? Mehrere mit Komma trennen.</p>
    ${fa.map(a => `<label class="fld">${esc(a)}
      <input type="text" list="fieldNames" maxlength="60" data-fa="${esc(a)}" value="${esc(f.fields[a] || '')}" placeholder="Feldstück" autocomplete="off"></label>`).join('')}
    <datalist id="fieldNames">${state.fieldNames.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`;
}

// Welcher Stempel-Schritt ist als Nächstes dran?
// in = Einstempeln, pause = Pause Start, pauseEnd = Pause Ende, end = Ende Arbeitszeit, done = fertig gestempelt
function stampStep(c) {
  if (!c) return 'in';
  if (c.end) return 'done';
  if (c.running) return 'pauseEnd';
  // Sind die drei festen Pausen eingetragen (oder ist keine Pause mehr frei), bleibt nur das Arbeitsende
  const mainDone = MAIN_BREAKS.every(([k]) => c.breaks[k].from && c.breaks[k].to);
  return mainDone || BREAKS.every(([k]) => c.breaks[k].from) ? 'end' : 'pause';
}

// Stempeln: trägt die aktuelle Uhrzeit für Arbeitsbeginn, Pausen und Arbeitsende ein
function stampHTML() {
  const c = state.clock, step = stampStep(c);
  const free = c ? BREAKS.filter(([k]) => !c.breaks[k].from) : [];
  const btn = (action, text, cls, v = '') => `<button type="button" class="${cls}" data-action="${action}" data-v="${v}">${esc(text)}</button>`;
  const since = c ? `Eingestempelt seit ${c.start} Uhr (${deDate(c.date)}).` : '';
  let buttons = '', info;
  if (step === 'in') {
    buttons = btn('stamp', 'Einstempeln', 'primary');
    info = 'Trägt die aktuelle Uhrzeit als Arbeitsbeginn ein. Alle Zeiten lassen sich auch von Hand eintragen.';
  } else if (step === 'done') {
    info = `Gestempelt am ${deDate(c.date)}: ${c.start}–${c.end} Uhr. Bitte Tätigkeiten wählen und speichern.`;
  } else if (step === 'pauseEnd') {
    buttons = btn('pauseEnd', 'Pause Ende', 'primary');
    info = `${breakLabel(c.running)} läuft seit ${c.breaks[c.running].from} Uhr.`;
  } else if (ui.pick) {
    buttons = free.map(([k, l]) => btn('pausePick', l, 'chip', k)).join('') + btn('pauseCancel', 'Abbrechen', 'ghost');
    info = 'Welche Pause beginnt jetzt?';
  } else if (step === 'end') {
    buttons = btn('workEnd', 'Ende Arbeitszeit', 'primary') + (free.length ? btn('pausePick', `${free[0][1]} Start`, '', free[0][0]) : '');
    info = since;
  } else {
    buttons = btn('pauseStart', 'Pause Start', 'primary') + btn('workEnd', 'Ende Arbeitszeit', '');
    info = since;
  }
  return `<div class="stamp">
      ${buttons ? `<div class="btn-row">${buttons}</div>` : ''}
      <p class="hint">${esc(info)}</p>
      ${c && !c.end && staleClock(c) ? `<p class="flag">Am ${deDate(c.date)} wurde nicht ausgestempelt – bitte das Arbeitsende von Hand eintragen und speichern.</p>` : ''}
      ${c ? '<button type="button" class="small ghost" data-action="unstamp">Stempelzeit verwerfen</button>' : ''}
    </div>`;
}

// Stempelzeit speichern (übersteht das Schließen der App) und ins Formular übernehmen
function stamped(msg) {
  const c = state.clock;
  ui.pick = false;
  save();
  form = { ...form, date: c.date, to: c.date, start: c.start, end: c.end || '', breaks: cloneBreaks(c.breaks), legacyPause: 0 };
  syncPause();
  render();
  toast(msg);
}

// Von Hand geänderte Zeiten auch in der laufenden Stempelzeit festhalten
function mirrorClock() {
  const c = state.clock;
  if (!c || form.id || form.date !== c.date) return;
  c.start = form.start;
  c.breaks = cloneBreaks(form.breaks);
  if (c.running && (!c.breaks[c.running].from || c.breaks[c.running].to)) c.running = null;
  if (form.end) c.end = form.end; else delete c.end;
  save();
  const box = $('.stamp'); if (box) box.outerHTML = stampHTML();
}

function viewErfassen() {
  const f = form;
  const seg = `<div class="seg" role="group" aria-label="Art des Eintrags">${Object.entries(TYPE_LABEL).map(([v, l]) =>
    `<button type="button" data-action="type" data-v="${v}" aria-pressed="${f.type === v}">${l}</button>`).join('')}</div>`;
  let body;
  if (f.type === 'arbeit') {
    const quick = quickActs();
    const shown = quick.concat(f.acts.filter(a => !quick.includes(a)));
    const rest = state.activities.filter(a => !shown.includes(a));
    body = `${f.id ? '' : stampHTML()}
      <label class="fld">Datum<input type="date" data-f="date" value="${esc(f.date)}"></label>
      <div class="row2">
        <label class="fld">Beginn<input type="time" data-f="start" value="${esc(f.start)}"></label>
        <label class="fld">Ende<input type="time" data-f="end" value="${esc(f.end)}"></label>
      </div>
      <h3>Pausen</h3>
      <div class="breaks">
        <span></span><span class="hint">Beginn</span><span class="hint">Ende</span>
        ${BREAKS.map(([k, l]) => `<span>${l}</span>
          <input type="time" aria-label="${l} Beginn" data-b="${k}" data-p="from" value="${esc(f.breaks[k].from)}">
          <input type="time" aria-label="${l} Ende" data-b="${k}" data-p="to" value="${esc(f.breaks[k].to)}">`).join('')}
      </div>
      ${f.legacyPause ? `<p class="hint">Bisher erfasste Pause ohne Uhrzeiten: ${f.legacyPause} Min. Sie bleibt erhalten, solange oben keine Pausen eingetragen werden.</p>` : ''}
      <button type="button" class="small ghost" data-action="clearBreaks">Pausen leeren</button>
      <p class="calc">Pause: <span id="pauseSum">${f.pause} Min.</span><br>Arbeitszeit: <strong id="calc">${fmtH(hours(f))} Std.</strong></p>
      <h3>Was wurde gemacht?</h3>
      <p class="hint">Schnellauswahl – mehrere Tätigkeiten möglich</p>
      <div class="chips">${shown.map(a =>
        `<button type="button" class="chip" data-action="act" data-v="${esc(a)}" aria-pressed="${f.acts.includes(a)}">${esc(a)}</button>`).join('')}</div>
      <label class="fld">Weitere Tätigkeit
        <select data-change="addAct"><option value="">Aus Liste wählen …</option>${rest.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
      ${f.newAct ? `<div class="newact">
          <label class="fld">Neue Tätigkeit<input type="text" id="newAct" maxlength="40" placeholder="z. B. Walzen"></label>
          <label class="check"><input type="checkbox" id="newActField"> Arbeit auf einem Feldstück (Acker- oder Futterbau)</label>
          <div class="btn-row">
            <button type="button" data-action="addActivity">Anlegen und auswählen</button>
            <button type="button" class="ghost" data-action="cancelNewAct">Abbrechen</button>
          </div>
        </div>` : '<button type="button" class="small ghost" data-action="newAct">＋ Eigene Tätigkeit anlegen</button>'}
      ${fieldInputs(f)}
      <label class="fld">Notiz (optional)<textarea data-f="note" rows="2" maxlength="300">${esc(f.note)}</textarea></label>`;
  } else {
    body = f.id
      ? `<label class="fld">Datum<input type="date" data-f="date" value="${esc(f.date)}"></label>`
      : `<div class="row2">
          <label class="fld">Von<input type="date" data-f="date" value="${esc(f.date)}"></label>
          <label class="fld">Bis<input type="date" data-f="to" value="${esc(f.to)}"></label>
        </div>
        <label class="check"><input type="checkbox" data-f="skipWe" ${f.skipWe ? 'checked' : ''}> Samstag und Sonntag auslassen</label>`;
    body += `<label class="fld">Notiz (optional)<textarea data-f="note" rows="2" maxlength="300">${esc(f.note)}</textarea></label>`;
  }
  if (f.id) {
    const old = state.entries.find(x => x.id === f.id);
    body += old && needsReason(old)
      ? `<label class="fld">Grund der nachträglichen Änderung (Pflicht)<textarea data-f="reason" rows="2" maxlength="300">${esc(f.reason)}</textarea></label>
         <p class="hint">Dieser Eintrag wurde vor mehr als 2 Tagen erfasst (${esc(fmtTs(old.created))}). Die Änderung wird der Betriebsleitung mit Begründung angezeigt.</p>`
      : '<p class="hint">Nachträgliche Änderungen werden der Betriebsleitung angezeigt.</p>';
  }
  return `<section class="card">
      <h2>${f.id ? 'Eintrag bearbeiten' : 'Zeit erfassen'}</h2>
      ${seg}${body}
      <div class="btn-row">
        <button type="button" class="primary" data-action="save">${f.id ? 'Änderung speichern' : 'Speichern'}</button>
        ${f.id ? '<button type="button" class="ghost" data-action="cancelEdit">Abbrechen</button>' : ''}
      </div>
    </section>
    <section class="card" id="dayList">${dayListHTML()}</section>`;
}

function dayListHTML() {
  const list = state.entries.filter(e => !e.deleted && e.date === form.date).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return `<h3>Erfasst am ${esc(dayLabel(form.date))}</h3>` +
    (list.length ? `<ul class="entries">${list.map(entryRow).join('')}</ul>` : '<p class="hint">Für diesen Tag ist noch nichts erfasst.</p>');
}

function viewWoche() {
  const inWeek = e => weekStart(e.date) === ui.week;
  const list = state.entries.filter(e => !e.deleted && inWeek(e))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  const s = stats(list);
  const month = addDays(ui.week, 3).slice(0, 7); // Monat, in dem der größere Teil der Woche liegt
  const monthHours = stats(state.entries.filter(e => e.date.startsWith(month))).hours;
  const sentAt = state.sent[ui.week];
  const stale = sentAt && state.entries.some(e => inWeek(e) &&
    [e.created, e.deleted && e.deleted.at, ...(e.changes || []).map(c => c.at)].some(t => t > sentAt));
  const sentInfo = !sentAt ? '' : stale
    ? `<p class="flag">Seit dem letzten Senden (${esc(fmtTs(sentAt))}) wurde in dieser Woche etwas geändert – bitte die Wochendatei erneut senden.</p>`
    : `<p class="hint">Zuletzt gesendet: ${esc(fmtTs(sentAt))}</p>`;
  let rows = '', lastDate = '';
  for (const e of list) {
    if (e.date !== lastDate) { rows += `<li class="day-head">${esc(dayLabel(e.date))}</li>`; lastDate = e.date; }
    rows += entryRow(e);
  }
  return `<section class="card">
      <div class="month-nav">
        <button type="button" data-action="week" data-v="-1" aria-label="Vorherige Woche">‹</button>
        <h2>${esc(weekLabel(ui.week))}</h2>
        <button type="button" data-action="week" data-v="1" aria-label="Nächste Woche">›</button>
      </div>
      ${tiles([[fmtH(s.hours), 'Arbeitsstunden'], [s.workDays.size, 'Arbeitstage'], [s.urlaub.size, 'Urlaubstage'], [s.krank.size, 'Krankheitstage']])}
      <p class="hint">Im ${esc(monthLabel(month))} bisher: ${fmtH(monthHours)} Arbeitsstunden.</p>
    </section>
    <section class="card">
      <h3>Wochendatei</h3>
      <p class="hint">Erstellt eine Datei mit allen Einträgen dieser Woche (Montag bis Sonntag). Im Teilen-Menü WhatsApp wählen und an die Betriebsleitung senden – am besten am Ende jeder Woche.</p>
      ${!CLOUD_URL || !state.cloud.code ? '' : state.cloud.err ? `<p class="flag">Online-Abgleich fehlgeschlagen: ${esc(state.cloud.err)}. Bitte die Wochendatei senden.</p>`
        : '<p class="hint">Online-Abgleich aktiv: Die Einträge werden automatisch übertragen, die Datei ist nur noch der Ausweichweg.</p>'}
      ${sentInfo}
      <div class="btn-row">
        <button type="button" class="primary" data-action="share">Wochendatei senden</button>
        ${isNative() ? '' : '<button type="button" class="ghost" data-action="download">Nur herunterladen</button>'}
      </div>
    </section>
    <section class="card">
      <h3>Einträge</h3>
      ${list.length ? `<ul class="entries">${rows}</ul>` : '<p class="hint">In dieser Woche ist noch nichts erfasst.</p>'}
    </section>`;
}

// Verlauf des Überstunden-Kontos je Woche bzw. Monat (Betriebsleitung und Mitarbeiter)
function ledgerHTML(o, t) {
  return `<div class="table-wrap"><table>
      <thead><tr><th>Zeitraum</th><th class="num">Ist</th><th class="num">Urlaub/Krank</th><th class="num">Soll</th><th class="num">Differenz</th><th class="num">Saldo</th></tr></thead>
      <tbody>${o.rows.map(r => `<tr><td>${esc(t.per === 'week' ? weekLabel(r.k) : monthLabel(r.k))}</td><td class="num">${fmtH(r.ist)}</td>
        <td class="num">${fmtH(r.credit)}</td><td class="num">${fmtH(t.h)}</td>
        <td class="num">${r.open ? 'läuft' : sign(r.diff)}</td><td class="num">${sign(r.saldo)}</td></tr>`).join('')}</tbody></table></div>`;
}

// Mitarbeiter: eigener Stand der Über- oder Minusstunden, gerechnet aus den Einträgen auf diesem Handy
function viewKonto() {
  const t = state.targets.default, o = overtime(state.entries, t, today()), year = today().slice(0, 4);
  const vac = vacCard(vacation(state.entries, t.vac, year), year);
  if (!o) {
    return `<section class="card"><h2>Überstunden</h2>
      <p class="hint">Noch keine Soll-Arbeitszeit hinterlegt. Bitte unter „Einstellungen“ eintragen, wie viele Stunden pro Woche oder Monat vereinbart sind.</p>
      <button type="button" class="primary" data-action="tab" data-v="einst">Zu den Einstellungen</button></section>${vac}`;
  }
  const s = Math.abs(o.saldo) < 0.005 ? 0 : o.saldo, open = o.rows.find(r => r.open), per = t.per === 'week' ? 'Woche' : 'Monat';
  return `<section class="card">
      <h2>Überstunden</h2>
      <div class="saldo ${s < 0 ? 'minus' : ''}"><b>${sign(s)} Std.</b><span>${s > 0 ? 'Überstunden' : s < 0 ? 'Minusstunden' : 'Ausgeglichen'}</span></div>
      ${tiles([[fmtH(t.h), `Soll pro ${per}`], [fmtH(open ? open.ist + open.credit : 0), t.per === 'week' ? 'Laufende Woche' : 'Laufender Monat']])}
      <p class="hint">Stand aus allen abgeschlossenen ${t.per === 'week' ? 'Wochen' : 'Monaten'} auf diesem Handy; Minusstunden sind verrechnet. Je Urlaubs- oder Krankheitstag zählt ein Fünftel des Wochen-Solls. Verbindlich ist die Auswertung der Betriebsleitung.</p>
    </section>
    ${vac}
    <section class="card">
      <h3>Verlauf</h3>
      ${o.rows.length ? ledgerHTML(o, t) : '<p class="hint">Noch keine Einträge vorhanden.</p>'}
    </section>`;
}

// Eingabezeile für eine Soll-Arbeitszeit; v = Mitarbeitername, leer = allgemeine Vorgabe
function vacCard(v, year) {
  return !v ? '' : `<section class="card">
      <h3>Urlaub ${year}</h3>
      ${tiles([[fmtDays(v.left), 'Resturlaub (Tage)'], [v.used, 'Urlaubstage eingetragen'], [fmtDays(v.days), 'Anspruch im Jahr']])}
      ${v.left < 0 ? '<p class="flag">Es ist mehr Urlaub eingetragen als der Jahresanspruch.</p>' : ''}
      <p class="hint">Jeder für ${year} eingetragene Urlaubstag wird automatisch abgezogen, auch ein künftiger. Resturlaub aus dem Vorjahr ist nicht eingerechnet.</p>
    </section>`;
}

function targetRow(label, t, v) {
  return `<div class="row3">
      <label class="fld">${esc(label)}<input type="number" min="0" step="0.5" inputmode="decimal" data-change="target" data-v="${esc(v)}" value="${t && t.h ? t.h : ''}" placeholder="Stunden"></label>
      <label class="fld">pro<select data-change="targetPer" data-v="${esc(v)}">
        <option value="week" ${!t || t.per === 'week' ? 'selected' : ''}>Woche</option><option value="month" ${t && t.per === 'month' ? 'selected' : ''}>Monat</option></select></label>
      <label class="fld">Urlaubstage/Jahr<input type="number" min="0" step="0.5" inputmode="decimal" data-change="targetVac" data-v="${esc(v)}" value="${t && t.vac ? t.vac : ''}" placeholder="Tage"></label>
    </div>`;
}

function viewEinstellungen() {
  const roleCard = `${cloudCard()}<section class="card">
      <h3>Modus</h3>
      <p class="hint">Aktuell: ${state.role === 'bl' ? 'Betriebsleitung' : 'Mitarbeiter'}. Die Daten liegen nur auf diesem Gerät und bleiben beim Wechsel erhalten.</p>
      <button type="button" data-action="switchRole">Zu ${state.role === 'bl' ? 'Mitarbeiter' : 'Betriebsleitung'} wechseln</button>
    </section>
    <p class="hint version">Hof-Zeiterfassung · Version ${APP_VERSION}</p>`;
  if (state.role === 'bl') {
    const names = [...new Set(importSets().map(s => s.name))].sort((a, b) => a.localeCompare(b));
    const row = targetRow;
    return `<section class="card">
      <h3>Soll-Arbeitszeit</h3>
      <p class="hint">Grundlage für Überstunden und Minusstunden in der Auswertung. Leer = keine Berechnung. Je Urlaubs- oder Krankheitstag wird ein Fünftel des Wochen-Solls gutgeschrieben.</p>
      ${row('Alle Mitarbeiter (Stunden)', state.targets.default, '')}
      <h3>Abweichend je Mitarbeiter</h3>
      ${names.length ? names.map(n => row(n, state.targets.emp[n] || { h: 0, per: state.targets.default.per }, n)).join('')
        : '<p class="hint">Mitarbeiter erscheinen hier, sobald Dateien eingelesen sind.</p>'}
      <p class="hint">Leer gelassen gilt die Vorgabe für alle Mitarbeiter.</p>
    </section>
    ${!names.length ? '' : `<section class="card"><details>
      <summary>Mitarbeiter verwalten</summary>
      <p class="hint">„Gerät freigeben“: wenn ein Mitarbeiter ein neues Handy hat oder die App neu installiert hat und der Abgleich seinen Namen ablehnt. „Daten löschen“ entfernt alle Zeiten der Person endgültig – online und auf diesem Gerät.</p>
      <ul class="act-list">${names.map(n => `<li><span>${esc(n)}</span><span class="e-act">
        ${CLOUD_URL && state.cloud.code ? `<button type="button" class="small" data-action="staffRelease" data-v="${esc(n)}">Gerät freigeben</button>` : ''}
        <button type="button" class="small danger" data-action="staffDelete" data-v="${esc(n)}">Daten löschen</button></span></li>`).join('')}</ul>
    </details></section>`}${roleCard}`;
  }
  return `<section class="card">
      <h3>Name</h3>
      <label class="fld">Erscheint in der Wochendatei
        <input type="text" data-change="name" autocomplete="name" value="${esc(state.name)}"></label>
      <p class="hint">Bitte möglichst nicht ändern: Unter einem neuen Namen erscheinen Sie bei der Betriebsleitung als zweite Person.</p>
    </section>
    <section class="card">
      <h3>Soll-Arbeitszeit</h3>
      ${targetRow('Vereinbarte Stunden', state.targets.default, '')}
      <p class="hint">Grundlage für den Reiter „Überstunden“. Bitte die Werte eintragen, die mit der Betriebsleitung vereinbart sind. Von den Urlaubstagen wird jeder eingetragene Urlaubstag automatisch abgezogen.</p>
    </section>
    <section class="card"><details id="acts" ${ui.acts ? 'open' : ''}>
      <summary>Tätigkeiten (${state.activities.length})</summary>
      <p class="hint">Die ${QUICK_COUNT} am häufigsten genutzten Tätigkeiten erscheinen automatisch in der Schnellauswahl.</p>
      <div class="add-row">
        <input type="text" id="newAct" maxlength="40" placeholder="Neue Tätigkeit" aria-label="Neue Tätigkeit">
        <button type="button" data-action="addActivity">Hinzufügen</button>
      </div>
      <label class="check"><input type="checkbox" id="newActField"> Neue Tätigkeit ist Arbeit auf einem Feldstück</label>
      <p class="hint">Haken „Feld“: Bei dieser Tätigkeit kann ein Feldstück angegeben werden.</p>
      <ul class="act-list">${state.activities.map(a =>
        `<li><span>${esc(a)}</span><label class="check small-check"><input type="checkbox" data-change="fieldAct" data-v="${esc(a)}" ${state.fieldActs.includes(a) ? 'checked' : ''}> Feld</label><button type="button" class="small danger" data-action="removeActivity" data-v="${esc(a)}" aria-label="${esc(a)} entfernen">Entfernen</button></li>`).join('')}</ul>
    </details></section>${roleCard}`;
}

/* ---------- Ansichten: Betriebsleitung ---------- */
function importSets() {
  const sets = Object.entries(state.imports).map(([key, v]) => ({ key, ...v }));
  // Nachträge der Betriebsleitung zählen nur, solange der Mitarbeiter den Tag nicht selbst erfasst hat
  const real = new Set(sets.flatMap(s => s.entries.filter(e => !e.deleted).map(e => e.name + '|' + e.date)));
  for (const [key, f] of Object.entries(state.fixes)) {
    if (f.skip || real.has(key)) continue;
    const i = key.lastIndexOf('|'), name = key.slice(0, i), date = key.slice(i + 1);
    sets.push({ key: 'fix|' + key, fix: true, name, week: weekStart(date), month: date.slice(0, 7), importedAt: '',
      entries: [{ id: key, name, date, type: 'arbeit', acts: [], note: '', fix: true, status: 'von der Betriebsleitung nachgetragen', log: '', createdTxt: '', ...f }] });
  }
  return sets
    .sort((a, b) => b.week.localeCompare(a.week) || b.month.localeCompare(a.month) || a.name.localeCompare(b.name));
}

// Betriebsleitung: Tage, an denen das Ein- oder Ausstempeln offenbar vergessen wurde.
// Ausstempeln: Stempelzeit von einem früheren Tag ist noch offen. Einstempeln: Werktag (Mo–Fr) der letzten 14 Tage ohne Eintrag.
function stampHints() {
  const d0 = today(), real = new Set(), weeks = new Set(), clockDays = new Set(), first = {}, last = {}, out = [];
  for (const s of importSets()) {
    if (s.fix) continue;
    weeks.add(s.name + '|' + s.week);
    for (const e of s.entries) {
      if (!e.deleted) real.add(e.name + '|' + e.date);
      if (!(first[e.name] <= e.date)) first[e.name] = e.date;
      if (!(last[e.name] >= e.date)) last[e.name] = e.date;
    }
  }
  const open = key => !real.has(key) && !state.fixes[key];
  for (const s of state.cloud.live) {
    const k = s.clock;
    if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k.date)) continue;
    clockDays.add(s.name + '|' + k.date);
    if (!(last[s.name] >= k.date)) last[s.name] = k.date;
    if (staleClock(k) && open(s.name + '|' + k.date)) out.push({ name: s.name, date: k.date, clock: k });
  }
  for (const name of Object.keys(first)) {
    if (last[name] < addDays(d0, -14)) continue; // seit über 14 Tagen nichts mehr: vermutlich nicht mehr im Betrieb
    for (let i = 1; i <= 14; i++) {
      const d = addDays(d0, -i), wd = parseISO(d).getDay();
      if (d < first[name] || wd === 0 || wd === 6 || !open(name + '|' + d) || clockDays.has(name + '|' + d)) continue;
      // ohne Online-Abgleich nur Wochen prüfen, deren Datei schon eingelesen ist
      if (state.cloud.code || weeks.has(name + '|' + weekStart(d))) out.push({ name, date: d });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function hintCard() {
  const hints = stampHints();
  if (!hints.length) return '';
  return `<section class="card">
      <h2><span class="flag">Stempel-Hinweise (${hints.length})</span></h2>
      <p class="hint">Vergessenes Aus- oder Einstempeln (Montag bis Freitag, letzte 14 Tage). Eine hier eingetragene Zeit zählt in der Auswertung, bis der Mitarbeiter den Tag selbst erfasst.</p>
      <ul class="entries">${hints.map(({ name, date, clock: k }) => `<li class="entry changed"><div class="e-main">
        <strong>${esc(name)} · ${esc(dayLabel(date))}</strong>
        <span>${esc(!k ? 'Kein Eintrag – Einstempeln vergessen?' : k.end ? `Gestempelt ${k.start}–${k.end} Uhr, aber nicht gespeichert` : `Eingestempelt um ${k.start} Uhr, nicht ausgestempelt`)}</span>
        <div class="row2">
          <label class="fld">Beginn<input type="time" data-fx="start" aria-label="Beginn ${esc(name)}, ${esc(dayLabel(date))}" value="${esc(k ? k.start : '')}"></label>
          <label class="fld">Ende<input type="time" data-fx="end" aria-label="Ende ${esc(name)}, ${esc(dayLabel(date))}" value="${esc((k && k.end) || '')}"></label>
        </div>
        <div class="btn-row">
          <button type="button" data-action="fix" data-v="${esc(name + '|' + date)}">Zeit eintragen</button>
          ${k ? '' : `<button type="button" class="ghost" data-action="fixSkip" data-v="${esc(name + '|' + date)}">Kein Arbeitstag</button>`}
        </div>
      </div></li>`).join('')}</ul>
    </section>`;
}

function viewImport() {
  const byName = {};
  for (const s of importSets().filter(s => !s.fix)) (byName[s.name] ||= []).push(s);
  const names = Object.keys(byName).sort((a, b) => a.localeCompare(b));
  // Eine Woche über den Monatswechsel liegt in zwei Teilen vor
  const part = s => addDays(s.week, 6).slice(0, 7) !== s.week.slice(0, 7) ? ` · Teil ${monthLabel(s.month)}` : '';
  const list = names.map(n => {
    const flags = byName[n].reduce((sum, s) => sum + s.entries.filter(flagOf).length, 0);
    return `<details><summary>${esc(n)} · ${new Set(byName[n].map(s => s.week)).size} Wochen${flags ? ` <span class="flag">&nbsp;· ${flags} auffällig</span>` : ''}</summary>
      <ul class="entries">${byName[n].map(s => `<li class="entry">
          <div class="e-main"><strong>${esc(weekLabel(s.week) + part(s))}</strong><span>${s.entries.length} ${s.entries.length === 1 ? 'Eintrag' : 'Einträge'} · eingelesen am ${esc(deDate(s.importedAt))}</span>${s.entries.some(flagOf) ? `<span class="flag">${s.entries.filter(flagOf).length} nachträglich geändert, gelöscht oder nachgetragen</span>` : ''}</div>
          <div class="e-act"><button type="button" class="small danger" data-action="delImport" data-v="${esc(s.key)}">Entfernen</button></div>
        </li>`).join('')}</ul></details>`;
  }).join('');
  return `<section class="card">
      <h2>Wochendateien einlesen</h2>
      <p class="hint">Die per WhatsApp erhaltenen Dateien (Zeiterfassung_Name_Jahr-KW.csv) auswählen – mehrere auf einmal möglich. Eine erneut eingelesene Datei ersetzt den bisherigen Stand für diesen Mitarbeiter und diese Woche. Ältere Monatsdateien lassen sich weiterhin einlesen.</p>
      <label class="file-btn">Dateien auswählen
        <input type="file" id="files" multiple accept=".csv,text/csv,text/comma-separated-values,text/plain"></label>
    </section>
    <section class="card">
      <h3>Eingelesene Daten</h3>
      ${list || '<p class="hint">Noch keine Dateien eingelesen.</p>'}
    </section>`;
}

// Betriebsleitung: Seite eines Mitarbeiters – Monatszahlen, Überstunden-Stand und die Tage zum Aufklappen
function viewMitarbeiter(name) {
  const all = importSets().filter(s => s.name === name).flatMap(s => s.entries);
  const months = [...new Set(all.map(e => e.date.slice(0, 7)))].sort().reverse();
  if (ui.blMonth !== 'alle' && !months.includes(ui.blMonth)) ui.blMonth = months[0] || 'alle';
  const list = all.filter(e => ui.blMonth === 'alle' || e.date.startsWith(ui.blMonth))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  const s = stats(list), t = targetOf(name), o = overtime(all, t, today());
  const saldo = o && Math.abs(o.saldo) >= 0.005 ? o.saldo : 0;
  const days = {};
  for (const e of list) (days[e.date] ||= []).push(e);
  const span = l => l ? `<span>${esc(l)}</span>` : '';
  // „Pause gesamt“ lässt sich aufklappen und zeigt dann die einzelnen Pausen mit Uhrzeit
  const pauseHTML = e => {
    const parts = BREAKS.filter(([k]) => e.breaks && e.breaks[k].from && e.breaks[k].to).map(([k, l]) => `${l}: ${e.breaks[k].from}–${e.breaks[k].to} Uhr`);
    return parts.length ? `<details><summary>Pause gesamt: ${e.pause} Min.</summary>${parts.map(span).join('')}</details>`
      : span(e.pause ? `Pause gesamt: ${e.pause} Min. (ohne Uhrzeiten)` : 'Keine Pause');
  };
  const lines = e => e.type !== 'arbeit' ? span(e.note)
    : pauseHTML(e) + span(e.deleted ? '' : `Arbeitszeit: ${fmtH(hours(e))} Std.`) + span(actsText(e)) + span(e.note);
  const dayRows = Object.keys(days).map(d => {
    const live = days[d].filter(e => !e.deleted), h = stats(days[d]).hours;
    const sum = h ? `${fmtH(h)} Std.` : [...new Set(live.map(e => TYPE_LABEL[e.type]))].join(', ') || 'gelöscht';
    return `<details><summary>${esc(dayLabel(d))} · ${esc(sum)}${days[d].some(flagOf) ? ` <span class="flag">&nbsp;· ${days[d].some(e => e.fix) ? 'nachgetragen' : 'geändert'}</span>` : ''}</summary>
      <ul class="entries">${days[d].map(e => `<li class="entry ${e.type}"><div class="e-main">
        <strong>${e.type === 'arbeit' ? `Beginn ${esc(e.start)} Uhr · Ende ${esc(e.end)} Uhr` : TYPE_LABEL[e.type]}</strong>
        ${lines(e)}
        ${flagOf(e) ? `<span class="flag">${esc(flagOf(e))}${e.log ? ': ' + esc(e.log) : ''}</span>` : ''}
        ${e.fix ? `<button type="button" class="small ghost" data-action="unfix" data-v="${esc(e.id)}">Nachtrag entfernen</button>` : ''}
      </div></li>`).join('')}</ul></details>`;
  }).join('');
  return `<section class="card">
      <button type="button" class="small ghost" data-action="emp" data-v="">‹ Zurück zur Auswertung</button>
      <h2>${esc(name)}</h2>
      <label class="fld">Monat<select data-change="blMonth">
        ${months.map(m => `<option value="${m}" ${m === ui.blMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
        <option value="alle" ${ui.blMonth === 'alle' ? 'selected' : ''}>Alle Monate</option></select></label>
      ${tiles([[fmtH(s.hours), 'Arbeitsstunden'], [s.workDays.size, 'Arbeitstage'], [s.workDays.size ? fmtH(s.hours / s.workDays.size) : '–', 'Ø Std./Tag'], [s.urlaub.size, 'Urlaubstage'], [s.krank.size, 'Krankheitstage']])}
    </section>
    <section class="card">
      <h3>Überstunden</h3>
      ${o ? `<div class="saldo ${saldo < 0 ? 'minus' : ''}"><b>${sign(saldo)} Std.</b><span>${saldo > 0 ? 'Überstunden' : saldo < 0 ? 'Minusstunden' : 'Ausgeglichen'} · aktueller Stand</span></div>
        <p class="hint">Fortlaufend über alle abgeschlossenen ${t.per === 'week' ? 'Wochen' : 'Monate'}, unabhängig vom gewählten Monat: Jede Differenz zum Soll (${fmtH(t.h)} Std./${t.per === 'week' ? 'Woche' : 'Monat'}) wird zum Stand addiert oder davon abgezogen.</p>
        <details><summary>Verlauf</summary>${ledgerHTML(o, t)}</details>`
        : '<p class="hint">Keine Soll-Arbeitszeit hinterlegt. Sie lässt sich unter „Einstellungen“ eintragen.</p>'}
    </section>
    ${vacCard(vacation(all, vacOf(name), today().slice(0, 4)), today().slice(0, 4))}
    <section class="card">
      <h3>Tage</h3>
      <p class="hint">Einen Tag antippen für Arbeitsbeginn, Arbeitsende und Pausenzeiten.</p>
      ${dayRows || '<p class="hint">Keine Einträge im gewählten Zeitraum.</p>'}
    </section>`;
}

function viewAuswertung() {
  if (ui.emp) return viewMitarbeiter(ui.emp);
  const sets = importSets();
  if (!sets.length) {
    return `${liveCard()}${hintCard()}<section class="card"><h2>Auswertung</h2>
      <p class="hint">Noch keine Daten vorhanden. Bitte zuerst unter „Einlesen“ die Wochendateien der Mitarbeiter auswählen.</p>
      <button type="button" class="primary" data-action="tab" data-v="import">Zum Einlesen</button></section>`;
  }
  const months = [...new Set(sets.map(s => s.month))].sort().reverse();
  if (ui.blMonth !== 'alle' && !months.includes(ui.blMonth)) ui.blMonth = months[0];
  const inMonth = sets.filter(s => ui.blMonth === 'alle' || s.month === ui.blMonth);
  const names = [...new Set(inMonth.map(s => s.name))].sort((a, b) => a.localeCompare(b));
  if (ui.blEmp && !names.includes(ui.blEmp)) ui.blEmp = '';
  const entries = inMonth.filter(s => !ui.blEmp || s.name === ui.blEmp).flatMap(s => s.entries)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || (a.start || '').localeCompare(b.start || ''));
  const total = stats(entries);

  const empRows = names.filter(n => !ui.blEmp || n === ui.blEmp).map(n => {
    const s = stats(entries.filter(e => e.name === n));
    return `<tr><td><button type="button" class="small" data-action="emp" data-v="${esc(n)}">${esc(n)} ›</button></td><td class="num">${fmtH(s.hours)}</td><td class="num">${s.workDays.size}</td>
      <td class="num">${s.workDays.size ? fmtH(s.hours / s.workDays.size) : '–'}</td><td class="num">${s.urlaub.size}</td><td class="num">${s.krank.size}</td></tr>`;
  }).join('');

  const acts = Object.entries(total.byAct).sort((a, b) => b[1] - a[1]);
  const max = acts.length ? acts[0][1] : 1;
  const bars = acts.map(([a, h]) => `<div>
      <div class="bar-label"><span>${esc(a)}</span><span>${fmtH(h)} Std. · ${total.hours ? Math.round(h / total.hours * 100) : 0} %</span></div>
      <div class="bar"><i style="width:${Math.max(2, h / max * 100).toFixed(1)}%"></i></div></div>`).join('');

  const detail = entries.map(e => `<tr><td>${esc(dayLabel(e.date))}</td><td>${esc(e.name)}</td><td>${TYPE_LABEL[e.type]}${flagOf(e) ? ` <span class="flag">(${esc(flagOf(e))})</span>` : ''}</td>
      <td>${e.type === 'arbeit' ? `${esc(e.start)}–${esc(e.end)}` : ''}</td><td class="num">${e.type === 'arbeit' && !e.deleted ? fmtH(hours(e)) : ''}</td>
      <td class="wrap">${esc([actsText(e), breaksText(e.breaks), e.note].filter(Boolean).join(' · '))}</td></tr>`).join('');

  const fieldRows = Object.entries(total.byField).map(([k, h]) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1), h]; })
    .sort((a, b) => a[0].localeCompare(b[0]) || b[2] - a[2]);
  const fieldCard = fieldRows.length ? `<section class="card">
      <h3>Stunden nach Feldstück</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Feldstück</th><th>Tätigkeit</th><th class="num">Stunden</th></tr></thead>
        <tbody>${fieldRows.map(([f, a, h]) => `<tr><td>${esc(f)}</td><td>${esc(a)}</td><td class="num">${fmtH(h)}</td></tr>`).join('')}</tbody></table></div>
    </section>` : '';
  // Überstunden: unabhängig vom Monatsfilter über alle eingelesenen Daten fortlaufend gerechnet
  const perTxt = t => `${fmtH(t.h)} Std./${t.per === 'week' ? 'Woche' : 'Monat'}`;
  const ot = names.filter(n => !ui.blEmp || n === ui.blEmp)
    .map(n => ({ n, t: targetOf(n), o: overtime(sets.filter(s => s.name === n).flatMap(s => s.entries), targetOf(n), today()) }))
    .filter(x => x.o);
  const otCard = `<section class="card">
      <h3>Überstunden</h3>
      ${!ot.length ? '<p class="hint">Keine Soll-Arbeitszeit hinterlegt. Sie lässt sich unter „Einstellungen“ eintragen.</p>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Soll</th><th class="num">Saldo</th><th class="num">Laufender Zeitraum</th><th class="num">Resturlaub</th></tr></thead>
        <tbody>${ot.map(({ n, t, o }) => {
          const open = o.rows.find(r => r.open);
          const v = vacation(sets.filter(s => s.name === n).flatMap(s => s.entries), vacOf(n), today().slice(0, 4));
          return `<tr><td>${esc(n)}</td><td>${perTxt(t)}</td><td class="num"><strong>${sign(o.saldo)}</strong></td>
            <td class="num">${open ? `${fmtH(open.ist + open.credit)} von ${fmtH(t.h)}` : '–'}</td>
            <td class="num">${v ? `${fmtDays(v.left)} von ${fmtDays(v.days)}` : '–'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="hint">Saldo über alle eingelesenen abgeschlossenen Wochen bzw. Monate, unabhängig vom gewählten Monat. Minusstunden werden mit Überstunden verrechnet.</p>
      ${ui.blEmp ? `<details><summary>Verlauf ${esc(ui.blEmp)}</summary>${ledgerHTML(ot[0].o, ot[0].t)}</details>`
        : '<p class="hint">Für den Verlauf je Woche bzw. Monat oben einen Mitarbeiter auswählen.</p>'}`}
    </section>`;
  const changedList = entries.filter(flagOf);
  const changedCard = changedList.length ? `<section class="card"><details>
      <summary><span class="flag">Nachträgliche Änderungen (${changedList.length})</span></summary>
      <p class="hint">Einträge, die nach dem ersten Speichern geändert oder gelöscht wurden – ab 2 Tagen nach der Ersterfassung mit Pflicht-Grund. „Nachgetragen“ heißt: erst mehr als 2 Tage nach dem Arbeitstag erfasst.</p>
      <ul class="entries">${changedList.map(e => `<li class="entry changed"><div class="e-main">
        <strong>${esc(e.name)} · ${esc(dayLabel(e.date))} · ${esc(flagOf(e))}</strong>
        <span>${e.deleted ? 'Gelöschter Eintrag' : 'Aktueller Stand'}: ${esc([entryText(e).head, entryText(e).sub].filter(Boolean).join(' · '))}</span>
        ${e.log.split(' || ').filter(Boolean).map(l => `<span>${esc(l)}</span>`).join('')}
        ${e.createdTxt ? `<span>Ersterfassung: ${esc(e.createdTxt)}</span>` : ''}
      </div></li>`).join('')}</ul>
    </details></section>` : '';

  return `${liveCard()}${hintCard()}<section class="card">
      <h2>Auswertung</h2>
      <div class="row2">
        <label class="fld">Monat<select data-change="blMonth">
          ${months.map(m => `<option value="${m}" ${m === ui.blMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
          <option value="alle" ${ui.blMonth === 'alle' ? 'selected' : ''}>Alle Monate</option></select></label>
        <label class="fld">Mitarbeiter<select data-change="blEmp">
          <option value="">Alle</option>${names.map(n => `<option ${n === ui.blEmp ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      </div>
      ${tiles([[fmtH(total.hours), 'Arbeitsstunden'], [total.workDays.size, 'Arbeitstage'], [total.urlaub.size, 'Urlaubstage'], [total.krank.size, 'Krankheitstage']])}
    </section>
    ${changedCard}
    <section class="card">
      <h3>Je Mitarbeiter</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th class="num">Stunden</th><th class="num">Arbeitstage</th><th class="num">Ø Std./Tag</th><th class="num">Urlaub</th><th class="num">Krank</th></tr></thead>
        <tbody>${empRows}</tbody></table></div>
    </section>
    ${otCard}
    <section class="card">
      <h3>Stunden nach Tätigkeit</h3>
      ${bars ? `<div class="bars">${bars}</div>` : '<p class="hint">Keine Arbeitszeiten im gewählten Zeitraum.</p>'}
      <p class="hint">Sind an einem Eintrag mehrere Tätigkeiten angegeben, wird die Zeit gleichmäßig aufgeteilt (grobe Näherung).</p>
    </section>
    ${fieldCard}
    <section class="card">
      <details><summary>Alle Einträge (${entries.length})</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Art</th><th>Zeit</th><th class="num">Std.</th><th>Tätigkeiten / Pausen / Notiz</th></tr></thead>
          <tbody>${detail}</tbody></table></div></details>
      <button type="button" data-action="exportAll">Auswahl als CSV speichern (für Excel)</button>
    </section>`;
}

/* ---------- Rendern ---------- */
const APP_VERSION = '1.9';
const icon = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  erfassen: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  woche: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  konto: icon('<path d="M12 4v8M8 8h8M8 18h8"/>'),
  einst: icon('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  auswertung: icon('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
  import: icon('<path d="M12 3v11m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/>')
};
const TABS = {
  ma: [['erfassen', 'Erfassen'], ['woche', 'Woche'], ['konto', 'Überstunden'], ['einst', 'Einstellungen']],
  bl: [['auswertung', 'Auswertung'], ['import', 'Einlesen'], ['einst', 'Einstellungen']]
};
const VIEWS = { erfassen: viewErfassen, woche: viewWoche, konto: viewKonto, einst: viewEinstellungen, auswertung: viewAuswertung, import: viewImport };

function render() {
  const a = document.activeElement, keep = a && a.closest && a.closest('#view, #nav') ? focusSel(a) : '';
  const tabs = TABS[state.role];
  if (tabs && !tabs.some(t => t[0] === ui.tab)) ui.tab = tabs[0][0];
  $('#top').innerHTML = `<img src="icons/logo.svg" alt="" width="44" height="44"><div><h1>Hof-Zeiterfassung</h1><p>${esc(!state.role ? 'Einrichtung' : state.role === 'bl' ? 'Betriebsleitung' : (state.name || 'Mitarbeiter'))}</p></div>`;
  $('#nav').innerHTML = tabs ? tabs.map(([id, l]) =>
    `<button type="button" data-action="tab" data-v="${id}" ${id === ui.tab ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${l}</span></button>`).join('') : '';
  $('#view').innerHTML = tabs ? VIEWS[ui.tab]() : viewStart();
  const el = keep && $(keep);
  if (el) el.focus({ preventScroll: true });
}
// Selektor, mit dem sich ein Bedienelement nach dem Neuzeichnen wiederfinden lässt
function focusSel(a) {
  if (a.id) return '#' + CSS.escape(a.id);
  return Object.entries(a.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${CSS.escape(v)}"]`).join('');
}

/* ---------- Aktionen ---------- */
// Übernimmt eine Bearbeitung und protokolliert sie. Liefert false, wenn ein Pflicht-Grund fehlt.
function applyEdit(e) {
  const old = state.entries.find(x => x.id === e.id);
  if (!old) return false;
  // Verschieben in eine andere Woche (oder über den Monatswechsel) würde in der alten,
  // evtl. schon gesendeten Datei keine Spur hinterlassen
  if (weekStart(old.date) !== weekStart(e.date) || old.date.slice(0, 7) !== e.date.slice(0, 7)) {
    toast('Verschieben in eine andere Woche oder einen anderen Monat geht nicht – bitte den Eintrag löschen und neu anlegen.');
    return false;
  }
  e.created = old.created;
  e.changes = (old.changes || []).slice();
  const before = describe(old);
  if (before !== describe(e)) {
    const reason = (form.reason || '').trim();
    if (needsReason(old) && !reason) {
      toast('Bitte einen Grund für die nachträgliche Änderung angeben.');
      const r = $('[data-f=reason]'); if (r) r.focus();
      return false;
    }
    e.changes.push({ at: nowTs(), before, reason });
  }
  state.entries = state.entries.map(x => x.id === e.id ? e : x);
  return true;
}

// Pausensumme aus den drei Pausen berechnen und Anzeige aktualisieren
function syncPause() {
  const any = BREAKS.some(([k]) => form.breaks[k].from || form.breaks[k].to);
  form.pause = any ? breakSum(form.breaks) : (form.legacyPause || 0);
  const p = $('#pauseSum'); if (p) p.textContent = `${form.pause} Min.`;
  const c = $('#calc'); if (c) c.textContent = `${fmtH(hours(form))} Std.`;
}

function pickFields(f) {
  return Object.fromEntries(f.acts
    .filter(a => state.fieldActs.includes(a) && (f.fields[a] || '').trim())
    .map(a => [a, f.fields[a].trim().replace(/\|/g, '/')]));
}

function saveEntry() {
  const f = form;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return toast('Bitte ein Datum wählen.');
  if (f.type === 'arbeit') {
    if (!f.start || !f.end) return toast('Bitte Beginn und Ende eintragen.');
    if (f.start === f.end) return toast('Beginn und Ende sind gleich.');
    const half = BREAKS.find(([k]) => !f.breaks[k].from !== !f.breaks[k].to);
    if (half) return toast(`Bitte bei ${half[1]} Beginn und Ende eintragen.`);
    const zero = BREAKS.find(([k]) => f.breaks[k].from && f.breaks[k].from === f.breaks[k].to);
    if (zero) return toast(`Bei ${zero[1]} sind Beginn und Ende gleich.`);
    // Pausen müssen in der Arbeitszeit liegen und dürfen sich nicht überschneiden (Minuten ab Arbeitsbeginn)
    const span = spanMin(f.start, f.end);
    const used = BREAKS.filter(([k]) => f.breaks[k].from).map(([k, l]) => {
      const a = spanMin(f.start, f.breaks[k].from);
      return { l, a, b: a + spanMin(f.breaks[k].from, f.breaks[k].to) };
    }).sort((x, y) => x.a - y.a);
    const outside = used.find(x => x.b > span);
    if (outside) return toast(`${outside.l} liegt außerhalb der Arbeitszeit.`);
    const clash = used.find((x, i) => i && x.a < used[i - 1].b);
    if (clash) return toast(`${clash.l} überschneidet sich mit einer anderen Pause.`);
    syncPause();
    const pause = f.pause;
    const e = { id: f.id || uid(), date: f.date, type: 'arbeit', start: f.start, end: f.end, pause, breaks: cloneBreaks(f.breaks), fields: pickFields(f), acts: f.acts.slice(), note: f.note.trim() };
    if (hours(e) <= 0) return toast('Die Pause ist länger als die Arbeitszeit.');
    if (!f.acts.length) return toast('Bitte mindestens eine Tätigkeit auswählen.');
    if (f.id) { if (!applyEdit(e)) return; }
    else {
      e.created = nowTs();
      state.entries.push(e);
      if (state.clock && state.clock.date === e.date) state.clock = null; // Stempelzeit ist mit diesem Eintrag verbraucht
      for (const a of e.acts) state.usage[a] = (state.usage[a] || 0) + 1;
    }
    state.last = { start: e.start, end: e.end, breaks: e.breaks };
    for (const v of Object.values(e.fields)) if (!state.fieldNames.includes(v)) state.fieldNames.unshift(v);
    state.fieldNames = state.fieldNames.slice(0, 60);
    toast(`Gespeichert: ${fmtH(hours(e))} Std.`);
  } else if (f.id) {
    if (!applyEdit({ id: f.id, date: f.date, type: f.type, note: f.note.trim() })) return;
    toast('Änderung gespeichert.');
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.to) || f.to < f.date) return toast('„Bis“ darf nicht vor „Von“ liegen.');
    const end = parseISO(f.to);
    let n = 0, guard = 0;
    for (let d = parseISO(f.date); d <= end && guard < 92; d.setDate(d.getDate() + 1), guard++) {
      if (f.skipWe && (d.getDay() === 0 || d.getDay() === 6)) continue;
      const date = iso(d);
      if (state.entries.some(x => !x.deleted && x.date === date && x.type === f.type)) continue;
      state.entries.push({ id: uid(), date, type: f.type, note: f.note.trim(), created: nowTs() });
      n++;
    }
    if (!n) return toast('Keine neuen Tage eingetragen (Wochenende oder bereits vorhanden).');
    toast(`${TYPE_LABEL[f.type]}: ${n} ${n === 1 ? 'Tag' : 'Tage'} eingetragen.`);
  }
  save();
  ui.week = weekStart(f.date);
  form = newForm(f.date);
  render();
}

// Betriebsleitung: Gerätebindung lösen oder alle Daten eines Mitarbeiters löschen (online und hier)
async function staffAdmin(name, del) {
  if (del && !confirm(`Alle Zeiten von ${name} endgültig löschen – online und auf diesem Gerät? Das lässt sich nicht rückgängig machen.`)) return;
  try {
    if (CLOUD_URL && state.cloud.code) await rpc('zeit_release', { p_code: state.cloud.code, p_name: name, p_delete: del });
  } catch (err) { return toast('Nicht möglich: ' + err.message); }
  if (del) {
    for (const [k, set] of Object.entries(state.imports)) if (set.name === name) delete state.imports[k];
    for (const k of Object.keys(state.fixes)) if (k.startsWith(name + '|')) delete state.fixes[k];
    delete state.targets.emp[name];
    state.cloud.live = state.cloud.live.filter(x => x.name !== name);
  }
  save(); render();
  toast(del ? `Daten von ${name} gelöscht.` : `${name} kann sich jetzt mit einem neuen Gerät anmelden.`);
}

async function importFiles(files) {
  let ok = 0, count = 0, changed = 0; const bad = [];
  for (const file of files) {
    try {
      const entries = parseCSV(await file.text());
      Object.assign(state.imports, groupImports(entries, today())); // ersetzt den Stand je Mitarbeiter und Woche
      ui.blMonth = entries[entries.length - 1].date.slice(0, 7);
      ok++; count += entries.length; changed += entries.filter(flagOf).length;
    } catch (err) { bad.push(`${file.name}: ${err.message}`); }
  }
  save();
  ui.blEmp = '';
  if (ok && !bad.length) ui.tab = 'auswertung';
  render();
  toast([ok ? `${ok} ${ok === 1 ? 'Datei' : 'Dateien'} eingelesen (${count} ${count === 1 ? 'Eintrag' : 'Einträge'}).` : '', changed ? `Achtung: ${changed} ${changed === 1 ? 'Eintrag' : 'Einträge'} nachträglich geändert oder nachgetragen.` : '', ...bad].filter(Boolean).join(' '));
}

const actions = {
  tab(b) { ui.tab = b.dataset.v; ui.emp = ''; render(); window.scrollTo(0, 0); },
  emp(b) { ui.emp = b.dataset.v; render(); window.scrollTo(0, 0); }, // Seite eines Mitarbeiters öffnen, leer = zurück
  role(b) {
    const name = $('#startName').value.trim();
    if (b.dataset.v === 'ma' && !name) { toast('Bitte zuerst den Namen eintragen.'); $('#startName').focus(); return; }
    state.name = name; state.role = b.dataset.v; ui.tab = null; save(); render();
  },
  switchRole() { state.role = state.role === 'bl' ? 'ma' : 'bl'; ui.tab = null; save(); render(); },
  type(b) { form.type = b.dataset.v; render(); },
  act(b) {
    const a = b.dataset.v;
    form.acts = form.acts.includes(a) ? form.acts.filter(x => x !== a) : form.acts.concat(a);
    render();
  },
  save: saveEntry,
  stamp() {
    if (state.clock) return;
    state.clock = { date: today(), start: nowHM(), breaks: cloneBreaks(), running: null };
    stamped(`Eingestempelt um ${state.clock.start} Uhr.`);
  },
  pauseStart() { ui.pick = true; render(); },
  pauseCancel() { ui.pick = false; render(); },
  pausePick(b) {
    const c = state.clock, k = b.dataset.v;
    if (!c || c.end || c.running || c.breaks[k].from) return;
    c.breaks[k] = { from: nowHM(), to: '' };
    c.running = k;
    stamped(`${breakLabel(k)} begonnen um ${c.breaks[k].from} Uhr.`);
  },
  pauseEnd() {
    const c = state.clock;
    if (!c || !c.running) return;
    const k = c.running, t = nowHM();
    c.running = null;
    if (c.breaks[k].from === t) { // unter einer Minute: nicht als Pause eintragen
      c.breaks[k] = { from: '', to: '' };
      return stamped(`${breakLabel(k)} war kürzer als eine Minute und wurde nicht eingetragen.`);
    }
    c.breaks[k].to = t;
    stamped(`${breakLabel(k)} beendet um ${t} Uhr.`);
  },
  workEnd() {
    const c = state.clock;
    if (!c || c.running) return;
    c.end = nowHM();
    stamped(`Arbeitsende ${c.end} Uhr – bitte Tätigkeiten wählen und speichern.`);
  },
  unstamp() { state.clock = null; ui.pick = false; save(); form = newForm(); render(); },
  clearBreaks() { form.breaks = cloneBreaks(); form.legacyPause = 0; form.pause = 0; mirrorClock(); render(); },
  cancelEdit() { form = newForm(form.date); render(); },
  edit(b) {
    const e = state.entries.find(x => x.id === b.dataset.id && !x.deleted);
    if (!e) return;
    form = { ...newForm(e.date), ...e, acts: (e.acts || []).slice(), note: e.note || '', to: e.date, reason: '',
      pause: e.pause || 0, breaks: cloneBreaks(e.breaks), legacyPause: breaksText(e.breaks) ? 0 : (e.pause || 0), fields: { ...(e.fields || {}) } };
    ui.tab = 'erfassen'; render(); window.scrollTo(0, 0);
  },
  del(b) {
    const e = state.entries.find(x => x.id === b.dataset.id && !x.deleted);
    if (!e) return;
    const what = `Eintrag vom ${deDate(e.date)} (${entryText(e).head})`;
    let reason = '';
    if (needsReason(e)) {
      const r = prompt(`${what} wurde vor mehr als 2 Tagen erfasst.
Bitte den Grund für das Löschen angeben:`);
      if (r === null) return;
      reason = r.trim();
      if (!reason) return toast('Ohne Grund kann der Eintrag nicht gelöscht werden.');
    } else if (!confirm(`${what} wirklich löschen? Das Löschen wird der Betriebsleitung angezeigt.`)) return;
    e.deleted = { at: nowTs(), reason }; // bleibt für das Änderungsprotokoll erhalten
    if (form.id === e.id) form = newForm(form.date);
    save(); render();
  },
  week(b) { ui.week = addDays(ui.week, 7 * Number(b.dataset.v)); render(); },
  sync() {
    if (syncing) return toast('Der Abgleich läuft gerade – bitte kurz warten.');
    sync().then(() => { render(); toast(state.cloud.err ? `Abgleich fehlgeschlagen: ${state.cloud.err}` : 'Abgeglichen.'); });
  },
  staffRelease(b) { staffAdmin(b.dataset.v, false); },
  staffDelete(b) { staffAdmin(b.dataset.v, true); },
  share() { exportWeek(true); },
  download() { exportWeek(false); },
  newAct() { form.newAct = true; render(); const el = $('#newAct'); if (el) el.focus(); },
  cancelNewAct() { form.newAct = false; render(); },
  addActivity() {
    const v = $('#newAct').value.trim().replace(/\|/g, '/');
    if (!v) return toast('Bitte einen Namen für die Tätigkeit eintragen.');
    if (state.activities.some(a => a.toLowerCase() === v.toLowerCase())) return toast('Diese Tätigkeit gibt es schon.');
    state.activities.push(v);
    if ($('#newActField').checked) state.fieldActs.push(v);
    if (ui.tab === 'erfassen') { form.acts.push(v); form.newAct = false; }
    save(); render(); toast(`„${v}“ angelegt.`);
  },
  removeActivity(b) {
    if (state.activities.length <= 1) return toast('Mindestens eine Tätigkeit muss bleiben.');
    state.activities = state.activities.filter(a => a !== b.dataset.v);
    state.fieldActs = state.fieldActs.filter(a => a !== b.dataset.v);
    delete state.usage[b.dataset.v];
    save(); render();
  },
  // Betriebsleitung trägt für einen Tag mit Stempel-Hinweis die Zeit nach
  fix(b) {
    const li = b.closest('li'), start = li.querySelector('[data-fx=start]').value, end = li.querySelector('[data-fx=end]').value;
    if (!start || !end || start === end) return toast('Bitte Beginn und Ende eintragen.');
    const key = b.dataset.v, live = state.cloud.live.find(s => s.clock && s.name + '|' + s.clock.date === key);
    const breaks = cloneBreaks(live && live.clock.breaks); // gestempelte Pausen übernehmen, angefangene verwerfen
    for (const [k] of BREAKS) if (!breaks[k].from || !breaks[k].to) breaks[k] = { from: '', to: '' };
    const f = { start, end, breaks, pause: breakSum(breaks) };
    if (hours({ type: 'arbeit', ...f }) <= 0) return toast('Die Pausen sind länger als die Arbeitszeit.');
    state.fixes[key] = f; save(); render(); toast('Zeit nachgetragen.');
  },
  fixSkip(b) { state.fixes[b.dataset.v] = { skip: true }; save(); render(); },
  unfix(b) { delete state.fixes[b.dataset.v]; save(); render(); },
  delImport(b) {
    const s = state.imports[b.dataset.v];
    if (!s || !confirm(`Daten von ${s.name} (${weekLabel(s.week)}) entfernen?`)) return;
    delete state.imports[b.dataset.v]; save(); render();
  },
  exportAll() {
    const sets = importSets().filter(s => (ui.blMonth === 'alle' || s.month === ui.blMonth) && (!ui.blEmp || s.name === ui.blEmp));
    const label = [ui.blEmp ? fileNameFor(ui.blEmp, '').replace(/^Zeiterfassung_|_\.csv$/g, '') : 'Alle', ui.blMonth].join('_');
    download(new File([toCSV(sets.flatMap(s => s.entries))], `Auswertung_${label}.csv`, { type: 'text/csv' }));
  }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (b && actions[b.dataset.action]) actions[b.dataset.action](b);
});

document.addEventListener('input', e => {
  const t = e.target, k = t.dataset.f;
  if (t.dataset.fa) { form.fields[t.dataset.fa] = t.value; return; }
  if (t.dataset.b) { form.breaks[t.dataset.b][t.dataset.p] = t.value; syncPause(); mirrorClock(); return; }
  if (!k) return;
  form[k] = t.type === 'checkbox' ? t.checked : t.value;
  if (k === 'start' || k === 'end') mirrorClock();
  if (k === 'date') {
    if (form.to < form.date) { form.to = form.date; const to = $('[data-f=to]'); if (to) to.value = form.to; }
    const dl = $('#dayList'); if (dl && form.date) dl.innerHTML = dayListHTML();
  }
  const calc = $('#calc'); if (calc) calc.textContent = `${fmtH(hours(form))} Std.`;
});

// aufgeklappte Tätigkeitenliste über das Neuzeichnen hinweg offen halten
document.addEventListener('toggle', e => { if (e.target.id === 'acts') ui.acts = e.target.open; }, true);

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'files') { if (t.files.length) importFiles([...t.files]); return; }
  switch (t.dataset.change) {
    case 'addAct': if (t.value && !form.acts.includes(t.value)) { form.acts.push(t.value); render(); } break;
    case 'fieldAct':
      state.fieldActs = t.checked ? state.fieldActs.concat(t.dataset.v) : state.fieldActs.filter(a => a !== t.dataset.v);
      save(); break;
    case 'name': state.name = t.value.trim(); save(); render(); toast('Name gespeichert.'); break;
    case 'target': case 'targetPer': case 'targetVac': {
      const v = t.dataset.v, d = state.targets.default;
      const tg = v ? (state.targets.emp[v] ||= { h: 0, per: d.per }) : d;
      const num = () => Math.max(0, parseFloat(t.value.replace(',', '.')) || 0);
      if (t.dataset.change === 'target') tg.h = num();
      else if (t.dataset.change === 'targetVac') tg.vac = num();
      else tg.per = t.value;
      save(); break;
    }
    case 'cloudCode': // neuer Code = neuer Abgleich von vorn
      state.cloud = { ...blank().cloud, code: t.value.trim().toUpperCase() };
      persist();
      if (state.cloud.code) actions.sync(); else { render(); toast('Online-Abgleich ausgeschaltet.'); }
      break;
    case 'blMonth': ui.blMonth = t.value; render(); break;
    case 'blEmp': ui.blEmp = t.value; render(); break;
  }
});

render();

sync();
setInterval(() => { if (!document.hidden) sync(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
