'use strict';

const FIELDS = [
  { id: 'title', label: 'Project title', kind: 'input', max: 200, hint: '' },
  { id: 'problem', label: 'Problem statement', kind: 'textarea', max: 5000, hint: 'What problem are you solving, and for whom?' },
  { id: 'approach', label: 'Approach', kind: 'textarea', max: 5000, hint: 'How you tackled it and why.' },
  { id: 'solution', label: 'Solution', kind: 'textarea', max: 5000, hint: 'What you built and how it works.' },
  { id: 'techStack', label: 'Tech stack', kind: 'input', max: 300, hint: 'Languages, frameworks, models and services.' },
  { id: 'impact', label: 'Business impact', kind: 'textarea', max: 5000, hint: 'Who benefits, and how you’d measure it.' },
];

const S = {
  loading: true, me: null, settings: null, criteria: [], phases: [], results: null,
  msg: null, saving: {}, flash: {},
  // team
  submission: null, draft: null, dirty: false, linkErrors: {},
  // judge
  jTeams: [], jSheets: [], phase: null, team: null, scoreDraft: null, scoreDirty: false,
  // admin
  data: null, tab: 'overview', forms: {}, edit: null, confirm: null, creds: null, adminTeam: null, scoreTeam: null,
  login: { username: '', password: '', error: '' },
};

/* ---------------- helpers ---------------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; }
  catch { return null; }
}
function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms); const now = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today, ' + t;
  if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + t;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + t;
}
const fmtNum = (n) => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1));
const maxTotal = () => S.criteria.reduce((a, c) => a + c.max, 0);
const sumScores = (s) => S.criteria.reduce((a, c) => a + (Number.isInteger(s && s[c.id]) ? s[c.id] : 0), 0);
const isComplete = (s) => !!s && S.criteria.length > 0 && S.criteria.every((c) => Number.isInteger(s[c.id]) && s[c.id] >= 1 && s[c.id] <= c.max);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function generatePassword(len = 12) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const out = []; const buf = new Uint32Array(len); crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out.push(A[buf[i] % A.length]);
  return out.join('');
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new Error('Can’t reach the server. Check your connection and try again.'); }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/api/login') { S.me = null; render(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
function setMsg(kind, text) { S.msg = text ? { kind, text } : null; render(); }

/* ---------------- render ---------------- */
let queued = false;
function scheduleRender() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); }
function render() {
  const app = document.getElementById('app');
  const a = document.activeElement; const fid = a && a.id ? a.id : null;
  let sel = null;
  if (fid && 'selectionStart' in a) { try { sel = [a.selectionStart, a.selectionEnd]; } catch { /* ignore */ } }
  app.replaceChildren(view());
  document.getElementById('who').textContent = whoLabel();
  document.getElementById('signout').classList.toggle('hidden', !S.me);
  document.getElementById('brandmark').classList.toggle('spin', S.loading);
  if (fid) {
    const el = document.getElementById(fid);
    if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } } }
  }
}
function whoLabel() {
  if (!S.me) return '';
  if (S.me.role === 'admin') return 'Organiser';
  if (S.me.role === 'judge') return S.me.displayName ? S.me.displayName + ', judging panel' : 'Judging panel';
  return S.me.team ? 'Team ' + S.me.team.codeName : '';
}
function markSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('class', 'mark big spin'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2"/><path class="arc" d="M16 4 A12 12 0 0 1 28 16" fill="none" stroke="var(--agent)" stroke-width="2.5" stroke-linecap="round"/><circle cx="16" cy="16" r="4" fill="var(--person-fill)"/>';
  return svg;
}
function banner() {
  if (!S.msg) return null;
  return h('div', { class: 'banner' + (S.msg.kind === 'error' ? ' bad' : ''), role: S.msg.kind === 'error' ? 'alert' : 'status', text: S.msg.text });
}
function view() {
  if (S.loading) return h('div', { class: 'notice' }, markSvg(), h('h2', { text: 'Opening the hackathon' }));
  if (!S.me) return loginView();
  let body;
  if (S.me.role === 'team') body = teamView();
  else if (S.me.role === 'judge') body = judgeView();
  else body = adminView();
  return h('div', { class: 'stack' }, banner(), body);
}

/* ---------------- login ---------------- */
function loginView() {
  const L = S.login;
  const u = h('input', { id: 'login-user', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', oninput: (e) => { L.username = e.target.value; } });
  u.value = L.username;
  const p = h('input', { id: 'login-pass', type: 'password', autocomplete: 'current-password', oninput: (e) => { L.password = e.target.value; } });
  p.value = L.password;
  const submit = async (e) => {
    e.preventDefault();
    if (S.saving.login) return;
    L.error = ''; S.saving.login = true; render();
    try {
      await api('POST', '/api/login', { username: L.username, password: L.password });
      L.password = ''; S.msg = null;
      await loadAll();
    } catch (err) { L.error = err.message; }
    S.saving.login = false; render();
  };
  return h('form', { class: 'card stack login', onsubmit: submit },
    h('h1', { text: 'Sign in' }),
    h('p', { class: 'muted', text: 'Use the username and password the organiser sent you.' }),
    h('label', { class: 'field', for: 'login-user' }, h('span', { class: 'lbl', text: 'Username' }), u),
    h('label', { class: 'field', for: 'login-pass' }, h('span', { class: 'lbl', text: 'Password' }), p),
    L.error ? h('p', { class: 'err', role: 'alert', text: L.error }) : null,
    h('button', { class: 'btn', type: 'submit', disabled: !!S.saving.login }, S.saving.login ? 'Signing in…' : 'Sign in'));
}

/* ---------------- loading data ---------------- */
async function loadAll() {
  const me = await api('GET', '/api/me');
  S.me = me.user; S.settings = me.settings; S.criteria = me.criteria; S.phases = me.phases;
  if (!S.me) return;
  const jobs = [api('GET', '/api/results').then((r) => { S.results = r; })];
  if (S.me.role === 'team') jobs.push(loadTeam());
  if (S.me.role === 'judge') jobs.push(loadJudge());
  if (S.me.role === 'admin') jobs.push(loadAdmin());
  await Promise.all(jobs);
}
async function loadTeam() {
  const r = await api('GET', '/api/team/submission');
  S.submission = r.submission;
  if (!S.dirty) S.draft = draftFrom(S.submission);
}
async function loadJudge() {
  const [t, s] = await Promise.all([api('GET', '/api/judge/teams'), api('GET', '/api/judge/scores')]);
  S.jTeams = t.teams; S.jSheets = s.sheets;
}
async function loadAdmin() {
  S.data = await api('GET', '/api/admin/data');
  S.settings = S.data.settings; S.results = S.data.results;
}
async function refresh() {
  try {
    const me = await api('GET', '/api/me');
    if (!me.user) { S.me = null; render(); return; }
    S.settings = me.settings;
    S.results = await api('GET', '/api/results');
    if (S.me.role === 'team') await loadTeam();
    if (S.me.role === 'judge') await loadJudge();
    if (S.me.role === 'admin') await loadAdmin();
    render();
  } catch { /* keep current view */ }
}

/* ---------------- shared pieces ---------------- */
function resultsCard(myTeamId) {
  const r = S.results;
  if (!r || !r.published) {
    return h('div', { class: 'card' }, h('h2', { text: 'Results' }),
      h('p', { class: 'muted mt4', text: 'Results will appear here once they’re announced.' }));
  }
  return h('div', { class: 'card' },
    h('div', { class: 'spread' }, h('h2', { text: 'Final results' }), h('span', { class: 'muted small', text: 'Announced ' + fmtTime(r.publishedAt) })),
    h('div', { class: 'mt8' }, r.ranking.map((x) => h('div', { class: 'rank' + (x.teamId === myTeamId ? ' me' : '') },
      h('span', { class: 'n', text: String(x.rank) }),
      h('div', { class: 'grow' },
        h('div', { class: 'name title', text: 'Team ' + x.codeName }),
        x.teamId === myTeamId ? h('div', { class: 'muted small', text: 'Your team' }) : null)))));
}
function submissionView(sub) {
  if (!sub) return h('p', { class: 'muted', text: 'No submission yet.' });
  const links = (sub.links || []).map((l) => {
    const u = safeUrl(l.url);
    return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: l.label || u }) : null;
  }).filter(Boolean);
  return h('div', { class: 'stack' },
    h('h2', { class: sub.title ? null : 'muted', text: sub.title || 'Untitled project' }),
    FIELDS.filter((f) => f.id !== 'title' && sub[f.id]).map((f) => h('div', { class: 'sub-block' }, h('h3', { text: f.label }), h('p', { text: sub[f.id] }))),
    h('div', { class: 'sub-block' }, h('h3', { text: 'Links' }), links.length ? h('div', { class: 'links' }, links) : h('p', { class: 'muted', text: 'No links added.' })),
    sub.updatedAt ? h('p', { class: 'muted small', text: 'Last updated ' + fmtTime(sub.updatedAt) }) : null);
}
function statusLine(open, openText, closedText) {
  return h('span', { class: 'status' }, h('span', { class: 'dot' + (open ? ' open' : '') }), open ? openText : closedText);
}

/* ---------------- team ---------------- */
function draftFrom(d) {
  const o = {};
  FIELDS.forEach((f) => { o[f.id] = (d && d[f.id]) || ''; });
  o.links = d && d.links && d.links.length ? d.links.map((l) => ({ label: l.label || '', url: l.url || '' })) : [{ label: '', url: '' }];
  return o;
}
function teamView() {
  const open = !!(S.settings && S.settings.submissionsOpen);
  const ro = !open;
  if (!S.draft) S.draft = draftFrom(S.submission);
  const d = S.draft;
  const touch = () => { S.dirty = true; S.flash.sub = false; };

  const fields = FIELDS.map((f) => {
    const id = 'f-' + f.id;
    const ctl = f.kind === 'textarea'
      ? h('textarea', { id, readonly: ro, maxlength: String(f.max), oninput: (e) => { d[f.id] = e.target.value; touch(); } })
      : h('input', { id, type: 'text', readonly: ro, maxlength: String(f.max), oninput: (e) => { d[f.id] = e.target.value; touch(); } });
    ctl.value = d[f.id];
    return h('label', { class: 'field', for: id }, h('span', { class: 'lbl', text: f.label }), f.hint ? h('span', { class: 'hint', text: f.hint }) : null, ctl);
  });
  const linkRows = d.links.map((l, i) => {
    const lab = h('input', { id: `link-${i}-label`, type: 'text', placeholder: 'Label, for example Deck', 'aria-label': `Link ${i + 1} label`, readonly: ro, maxlength: '80', oninput: (e) => { l.label = e.target.value; touch(); } });
    lab.value = l.label;
    const url = h('input', { id: `link-${i}-url`, type: 'url', inputmode: 'url', placeholder: 'https://', 'aria-label': `Link ${i + 1} address`, readonly: ro, maxlength: '1000', oninput: (e) => { l.url = e.target.value; touch(); } });
    url.value = l.url;
    return h('div', { class: 'stack tight' },
      h('div', { class: 'linkrow' }, lab, url,
        ro ? null : h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Remove link ${i + 1}`, onclick: () => { d.links.splice(i, 1); if (!d.links.length) d.links.push({ label: '', url: '' }); S.linkErrors = {}; touch(); render(); } }, 'Remove')),
      S.linkErrors[i] ? h('span', { class: 'err', text: S.linkErrors[i] }) : null);
  });
  let action;
  if (ro) action = h('span', { class: 'muted small', text: 'Editing is closed.' });
  else if (S.flash.sub && !S.dirty) action = h('button', { class: 'btn saved', type: 'button', disabled: true }, '✓ Saved');
  else action = h('button', { class: 'btn', type: 'button', disabled: !!S.saving.sub, onclick: saveSubmission }, S.saving.sub ? 'Saving…' : 'Save submission');

  return h('div', { class: 'stack' },
    h('div', { class: 'hero' }, h('h1', { text: 'Team ' + S.me.team.codeName }),
      statusLine(open, 'Submissions are open. You can edit until the organiser closes them.', 'Submissions are closed.')),
    resultsCard(S.me.team.id),
    h('div', { class: 'card stack tight' }, h('h2', { text: 'Keep judging blind' }),
      h('p', { class: 'muted', text: 'The panel sees only your team name. Leave your own names out of the write-up and slides, and put decks and videos in the shared hackathon folder so the link doesn’t show who owns the file. Make sure the panel can open every link.' })),
    h('div', { class: 'card stack' }, h('h2', { text: 'Your submission' }), fields,
      h('div', { class: 'stack tight' }, h('span', { class: 'lbl', text: 'Links' }),
        h('span', { class: 'hint', text: 'Deck, demo video, repo, live app or anything else. Add as many as you need.' }),
        linkRows,
        ro ? null : h('div', null, h('button', { class: 'linkbtn', type: 'button', onclick: () => { d.links.push({ label: '', url: '' }); render(); const el = document.getElementById(`link-${d.links.length - 1}-label`); if (el) el.focus(); } }, '+ Add a link'))),
      h('div', { class: 'spread' }, h('span', { class: 'muted small', text: S.submission ? 'Last saved ' + fmtTime(S.submission.updatedAt) : 'Not saved yet' }), action)));
}
async function saveSubmission() {
  const d = S.draft; const errs = {}; const links = [];
  d.links.forEach((l, i) => {
    if (!l.url.trim() && !l.label.trim()) return;
    const u = safeUrl(l.url);
    if (!u) { errs[i] = 'Check this link. It needs to start with https://'; return; }
    links.push({ label: l.label.trim(), url: u });
  });
  S.linkErrors = errs;
  if (Object.keys(errs).length) { render(); return; }
  const body = { links };
  FIELDS.forEach((f) => { body[f.id] = d[f.id]; });
  S.saving.sub = true; S.msg = null; render();
  try {
    const r = await api('PUT', '/api/team/submission', body);
    S.submission = r.submission; S.dirty = false; S.flash.sub = true;
  } catch (e) { S.msg = { kind: 'error', text: e.message }; if (/closed/i.test(e.message)) refresh(); }
  S.saving.sub = false; render();
}

/* ---------------- judge ---------------- */
function phaseOpen(id) { return !!(S.settings && S.settings[id + 'Open']); }
function mySheet(teamId, phase) { return S.jSheets.find((s) => s.teamId === teamId && s.phase === phase) || null; }
function judgeView() {
  if (!S.phase) S.phase = phaseOpen('phase2') && !phaseOpen('phase1') ? 'phase2' : 'phase1';
  const phase = S.phases.find((p) => p.id === S.phase);
  const open = phaseOpen(phase.id);
  if (S.team) {
    const t = S.jTeams.find((x) => x.id === S.team);
    if (t) return judgeTeamView(t, phase, open);
    S.team = null;
  }
  const done = S.jTeams.filter((t) => { const s = mySheet(t.id, phase.id); return s && isComplete(s.scores); }).length;
  return h('div', { class: 'stack' },
    h('div', { class: 'hero' }, h('h1', { text: 'Judging' }),
      h('p', { class: 'muted', text: 'Score each team on its own. Nobody else sees your scores, and teams never see any scores.' })),
    resultsCard(null),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Judging phase' },
      S.phases.map((p) => h('button', { type: 'button', 'aria-pressed': String(p.id === S.phase), onclick: () => { S.phase = p.id; render(); } },
        p.short + (phaseOpen(p.id) ? ', open' : ', closed')))),
    h('div', { class: 'card' },
      h('div', { class: 'spread' }, h('h2', { text: phase.name }), statusLine(open, 'Open for scoring', 'Closed')),
      h('p', { class: 'muted small mt4', text: `${done} of ${S.jTeams.length} teams scored` }),
      S.jTeams.length === 0 ? h('p', { class: 'muted mt8', text: 'Teams will appear here once the organiser adds them.' })
        : h('div', { class: 'list mt8' }, S.jTeams.map((t) => {
          const s = mySheet(t.id, phase.id);
          return h('button', { class: 'pick', type: 'button', onclick: () => { S.team = t.id; S.scoreDraft = null; S.scoreDirty = false; S.flash.score = false; render(); window.scrollTo(0, 0); } },
            h('div', { class: 'grow' }, h('div', { class: 'name title', text: 'Team ' + t.codeName }),
              h('div', { class: 'meta', text: t.submission ? (t.submission.title || 'Untitled project') : 'No submission yet' })),
            s && isComplete(s.scores) ? h('span', { class: 'ok small', text: `✓ ${sumScores(s.scores)} of ${maxTotal()}` }) : h('span', { class: 'needs small', text: 'Not scored' }),
            h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
        }))));
}
function judgeTeamView(t, phase, open) {
  const saved = mySheet(t.id, phase.id);
  if (!S.scoreDraft || S.scoreDraft.team !== t.id || S.scoreDraft.phase !== phase.id) {
    S.scoreDraft = { team: t.id, phase: phase.id, values: Object.assign({}, saved ? saved.scores : {}), comment: saved ? saved.comment : '' };
  }
  const v = S.scoreDraft.values;
  const crits = S.criteria.map((c) => h('div', { class: 'crit' },
    h('div', { class: 'spread' }, h('span', { class: 'lbl', text: c.name }), h('span', { class: 'muted small', text: Number.isInteger(v[c.id]) ? `${v[c.id]} of ${c.max}` : 'Not scored' })),
    h('div', { class: 'score-grid', role: 'group', 'aria-label': c.name },
      Array.from({ length: c.max }, (_, i) => i + 1).map((n) => h('button', {
        type: 'button', id: `sc-${c.id}-${n}`, disabled: !open, 'aria-pressed': String(v[c.id] === n), 'aria-label': `${c.name} ${n}`,
        onclick: () => { v[c.id] = n; S.scoreDirty = true; S.flash.score = false; render(); },
      }, String(n))))));
  const comment = h('textarea', { id: 'sc-comment', readonly: !open, required: true, 'aria-required': 'true', maxlength: '2000', placeholder: 'Your reasoning for these scores, for the organiser',
    oninput: (e) => { S.scoreDraft.comment = e.target.value; S.scoreDirty = true; S.flash.score = false; } });
  comment.value = S.scoreDraft.comment || '';
  const complete = isComplete(v);
  let action;
  if (!open) action = h('span', { class: 'muted small', text: `${phase.short} is closed, so scores can’t be changed.` });
  else if (S.flash.score && !S.scoreDirty) action = h('button', { class: 'btn saved', type: 'button', disabled: true }, '✓ Saved');
  else action = h('button', { class: 'btn', type: 'button', disabled: !complete || !!S.saving.score, onclick: () => saveScores(t.id, phase.id) }, S.saving.score ? 'Saving…' : 'Save scores');
  return h('div', { class: 'stack' },
    h('div', null, h('button', { class: 'linkbtn', type: 'button', onclick: () => { S.team = null; S.scoreDraft = null; render(); } }, '‹ All teams')),
    h('div', { class: 'hero' }, h('h1', { text: 'Team ' + t.codeName }), statusLine(open, phase.name + ', open', phase.name + ', closed')),
    h('div', { class: 'card' }, submissionView(t.submission)),
    h('div', { class: 'card' },
      h('div', { class: 'spread' }, h('h2', { text: 'Your scores' }), h('span', { class: 'title', text: `${sumScores(v)} of ${maxTotal()}` })),
      h('div', { class: 'mt4' }, crits),
      h('label', { class: 'field mt8', for: 'sc-comment' }, h('span', { class: 'lbl', text: 'Comment (required)' }), comment),
      h('div', { class: 'spread mt16' },
        h('span', { class: 'muted small', text: complete ? (saved ? 'You can change saved scores while this phase is open.' : 'Not saved yet') : 'Score every criterion and add a comment to save.' }),
        action)));
}
async function saveScores(teamId, phaseId) {
  const scores = {};
  S.criteria.forEach((c) => { scores[c.id] = S.scoreDraft.values[c.id]; });
  if (!(S.scoreDraft.comment || '').trim()) {
    S.msg = { kind: 'error', text: 'Add a comment before saving.' }; render();
    const el = document.getElementById('sc-comment'); if (el) el.focus();
    return;
  }
  S.saving.score = true; S.msg = null; render();
  try {
    await api('PUT', `/api/judge/scores/${teamId}/${phaseId}`, { scores, comment: S.scoreDraft.comment || '' });
    await loadJudge();
    S.scoreDirty = false; S.flash.score = true;
  } catch (e) { S.msg = { kind: 'error', text: e.message }; if (/closed/i.test(e.message)) refresh(); }
  S.saving.score = false; render();
}

/* ---------------- admin ---------------- */
function adminView() {
  const D = S.data;
  if (!D) return h('p', { class: 'muted', text: 'Loading…' });
  const tabs = [['overview', 'Overview'], ['teams', 'Teams'], ['judges', 'Judges'], ['submissions', 'Submissions'], ['scores', 'Scores'], ['account', 'Account']];
  const body = { overview: adminOverview, teams: adminTeams, judges: adminJudges, submissions: adminSubmissions, scores: adminScores, account: adminAccount }[S.tab]();
  return h('div', { class: 'stack' },
    h('div', { class: 'hero' }, h('h1', { text: 'Hackathon control' }), h('p', { class: 'muted', text: 'Only organisers see this view.' })),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Sections' },
      tabs.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(S.tab === id),
        onclick: () => { S.tab = id; S.confirm = null; S.edit = null; S.creds = null; S.msg = null; render(); refresh(); } }, label))),
    body);
}
async function adminAction(fn, okText) {
  S.msg = null;
  try { await fn(); await loadAdmin(); if (okText) S.msg = { kind: 'ok', text: okText }; }
  catch (e) { S.msg = { kind: 'error', text: e.message }; }
  render();
}
function form(key, init) { if (!S.forms[key]) S.forms[key] = Object.assign({}, init); return S.forms[key]; }
function input(formObj, field, id, opts = {}) {
  const el = h('input', { id, type: opts.type || 'text', autocomplete: opts.autocomplete || 'off', autocapitalize: opts.noCaps ? 'none' : null,
    spellcheck: opts.noCaps ? 'false' : null, maxlength: opts.max ? String(opts.max) : null, placeholder: opts.placeholder || null,
    oninput: (e) => { formObj[field] = e.target.value; if (opts.onInput) opts.onInput(e.target.value); } });
  el.value = formObj[field] || '';
  return el;
}
function field(label, ctl, hint) {
  return h('label', { class: 'field', for: ctl.id }, h('span', { class: 'lbl', text: label }), hint ? h('span', { class: 'hint', text: hint }) : null, ctl);
}
function passwordField(formObj, id, label) {
  const ctl = input(formObj, 'password', id, { noCaps: true, max: 200, autocomplete: 'new-password' });
  return h('div', { class: 'field' },
    h('label', { class: 'lbl', for: id, text: label || 'Password' }),
    h('div', { class: 'pw' }, ctl, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { formObj.password = generatePassword(); render(); } }, 'Generate')));
}
function credsCard() {
  if (!S.creds) return null;
  const c = S.creds;
  const textBlock = `${c.title}\nSite: ${location.origin}\nUsername: ${c.username}\nPassword: ${c.password}`;
  return h('div', { class: 'creds', role: 'status' },
    h('h3', { text: c.heading }),
    h('dl', null, h('dt', { text: 'Username' }), h('dd', { class: 'mono', text: c.username }), h('dt', { text: 'Password' }), h('dd', { class: 'mono', text: c.password })),
    h('p', { class: 'muted small', text: 'Send these privately. The password isn’t shown again.' }),
    h('div', { class: 'row mt8' },
      h('button', { class: 'btn small', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(textBlock); e.target.textContent = '✓ Copied'; } catch { e.target.textContent = 'Copy failed, select the text instead'; } } }, 'Copy login details'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.creds = null; render(); } }, 'Done')));
}
function confirmBox(kind, id, text, onYes) {
  if (!S.confirm || S.confirm.kind !== kind || S.confirm.id !== id) return null;
  return h('div', { class: 'stack tight mt8' }, h('p', { class: 'bad small', text }),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger-solid small', type: 'button', onclick: () => { S.confirm = null; onYes(); } }, 'Delete'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.confirm = null; render(); } }, 'Cancel')));
}

function adminOverview() {
  const D = S.data; const st = D.settings;
  const toggles = [
    ['submissionsOpen', 'Submissions open', 'Teams can add and edit their submission.'],
    ['phase1Open', 'Phase 1 judging open', 'Judges score written submissions by team name only.'],
    ['phase2Open', 'Phase 2 judging open', 'Judges score each team again after the demos.'],
  ];
  const submitted = D.teams.filter((t) => t.submission).length;
  const published = D.results && D.results.published;
  const missing = S.phases.filter((p) => D.standings.some((r) => r[p.id].count < D.judges.length)).map((p) => p.short);
  const count = (jid, ph) => D.sheets.filter((s) => s.judgeId === jid && s.phase === ph).length;

  let pub;
  if (S.confirm && S.confirm.kind === 'publish') {
    pub = h('div', { class: 'stack tight' },
      h('p', { class: 'bad', text: 'Everyone, teams included, will see the ranking. Scores stay hidden.' }),
      missing.length ? h('p', { class: 'needs small', text: `Some scores are still missing for ${missing.join(' and ')}.` }) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { S.confirm = null; adminAction(() => api('POST', '/api/admin/results/publish'), 'Results published.'); } }, 'Publish results'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.confirm = null; render(); } }, 'Cancel')));
  } else {
    pub = h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => { S.confirm = { kind: 'publish' }; render(); } }, published ? 'Publish updated results' : 'Publish results'),
      published ? h('button', { class: 'btn danger', type: 'button', onclick: () => adminAction(() => api('POST', '/api/admin/results/withdraw'), 'Results withdrawn.') }, 'Withdraw results') : null);
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h2', { text: 'Phases' }),
      h('div', { class: 'mt4' }, toggles.map(([k, label, hint]) => h('div', { class: 'switch' },
        h('div', { class: 'grow' }, h('div', { class: 'lbl', id: 'lbl-' + k, text: label }), h('div', { class: 'hint', text: hint })),
        h('button', { class: 'toggle', type: 'button', role: 'switch', id: 'tg-' + k, 'aria-labelledby': 'lbl-' + k, 'aria-checked': String(!!st[k]), disabled: !!S.saving.settings,
          onclick: async () => { S.saving.settings = true; render(); await adminAction(() => api('PUT', '/api/admin/settings', { [k]: !st[k] })); S.saving.settings = false; render(); } }))))),
    h('div', { class: 'card' },
      h('div', { class: 'spread' }, h('h2', { text: 'Progress' }), h('span', { class: 'muted small', text: `${submitted} of ${D.teams.length} teams submitted` })),
      D.judges.length === 0 ? h('p', { class: 'muted mt8', text: 'No judges yet. Add them under Judges.' })
        : h('div', { class: 'scroll mt8' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Judge' }), S.phases.map((p) => h('th', { class: 'num', text: p.short })))),
          h('tbody', null, D.judges.map((j) => h('tr', null, h('td', { text: j.displayName }),
            S.phases.map((p) => { const n = count(j.id, p.id); return h('td', { class: 'num' + (n === D.teams.length && n > 0 ? ' ok' : ''), text: `${n} of ${D.teams.length}` }); }))))))),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'spread' }, h('h2', { text: 'Results' }), statusLine(published, published ? 'Published ' + fmtTime(D.results.publishedAt) : '', 'Not published')),
      h('p', { class: 'muted', text: 'Publishing shows the ranking to everyone. Scores are never shown to teams or judges.' }),
      pub));
}

function adminTeams() {
  const D = S.data;
  const f = form('newTeam', { codeName: '', members: '', username: '', password: generatePassword(), userTouched: false });
  const addForm = h('div', { class: 'card stack' },
    h('h2', { text: 'Add a team' }),
    h('div', { class: 'form-grid' },
      field('Team name', input(f, 'codeName', 'nt-name', { max: 60, placeholder: 'Blue Comet', onInput: (v) => { if (!f.userTouched) { f.username = slug(v); scheduleRender(); } } }), 'Judges see only this name.'),
      field('Members', input(f, 'members', 'nt-members', { max: 500, placeholder: 'Kishan, Chithra, Vishnu' }), 'Only organisers see this.')),
    h('div', { class: 'form-grid' },
      field('Username', input(f, 'username', 'nt-user', { noCaps: true, max: 40, onInput: () => { f.userTouched = true; } })),
      passwordField(f, 'nt-pass')),
    h('div', null, h('button', { class: 'btn', type: 'button', disabled: !!S.saving.newTeam, onclick: async () => {
      S.saving.newTeam = true; render();
      const body = { codeName: f.codeName, members: f.members, username: f.username, password: f.password };
      await adminAction(async () => {
        await api('POST', '/api/admin/teams', body);
        S.creds = { heading: `Team ${body.codeName} created`, title: `DotKonnekt Hackathon, Team ${body.codeName}`, username: body.username, password: body.password };
        S.forms.newTeam = null;
      });
      S.saving.newTeam = false; render();
    } }, S.saving.newTeam ? 'Adding…' : 'Add team')));

  const list = h('div', { class: 'card' },
    h('div', { class: 'spread' }, h('h2', { text: 'Teams' }), h('span', { class: 'muted small', text: `${D.teams.length} teams` })),
    D.teams.length === 0 ? h('p', { class: 'muted mt8', text: 'No teams yet.' }) :
      h('div', { class: 'list mt8' }, D.teams.map((t) => {
        if (S.edit && S.edit.kind === 'team' && S.edit.id === t.id) return teamEditRow(t);
        return h('div', { class: 'item' },
          h('div', { class: 'grow' },
            h('div', { class: 'title', text: 'Team ' + t.codeName }),
            h('div', { class: 'meta', text: t.members || 'No members listed' }),
            h('div', { class: 'meta' }, 'Username ', h('span', { class: 'mono', text: t.username || 'none' }), t.submission ? ', submitted ' + fmtTime(t.submission.updatedAt) : ', not submitted'),
            confirmBox('team', t.id, `Delete Team ${t.codeName}? This removes its login, submission and every score for it. It can’t be undone.`,
              () => adminAction(() => api('DELETE', `/api/admin/teams/${t.id}`), `Team ${t.codeName} deleted.`))),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.edit = { kind: 'team', id: t.id, f: { codeName: t.codeName, members: t.members, username: t.username || '', password: '' } }; S.confirm = null; render(); } }, 'Edit'),
            h('button', { class: 'btn danger small', type: 'button', onclick: () => { S.confirm = { kind: 'team', id: t.id }; render(); } }, 'Delete')));
      })));
  return h('div', { class: 'stack' }, credsCard(), list, addForm);
}
function teamEditRow(t) {
  const f = S.edit.f;
  return h('div', { class: 'item' }, h('div', { class: 'grow stack' },
    h('div', { class: 'form-grid' },
      field('Team name', input(f, 'codeName', 'et-name', { max: 60 })),
      field('Members', input(f, 'members', 'et-members', { max: 500 })),
      field('Username', input(f, 'username', 'et-user', { noCaps: true, max: 40 }))),
    h('div', { class: 'form-grid' }, passwordField(f, 'et-pass', 'New password (leave empty to keep the current one)')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const body = { codeName: f.codeName, members: f.members, username: f.username };
        if (f.password) body.password = f.password;
        adminAction(async () => {
          await api('PATCH', `/api/admin/teams/${t.id}`, body);
          if (f.password) S.creds = { heading: `New login for Team ${f.codeName}`, title: `DotKonnekt Hackathon, Team ${f.codeName}`, username: f.username, password: f.password };
          S.edit = null;
        }, 'Team updated.');
      } }, 'Save changes'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.edit = null; render(); } }, 'Cancel'))));
}

function adminJudges() {
  const D = S.data;
  const f = form('newJudge', { displayName: '', username: '', password: generatePassword(), userTouched: false });
  const addForm = h('div', { class: 'card stack' },
    h('h2', { text: 'Add a judge' }),
    h('div', { class: 'form-grid' },
      field('Name', input(f, 'displayName', 'nj-name', { max: 80, onInput: (v) => { if (!f.userTouched) { f.username = slug(v); scheduleRender(); } } })),
      field('Username', input(f, 'username', 'nj-user', { noCaps: true, max: 40, onInput: () => { f.userTouched = true; } })),
      passwordField(f, 'nj-pass')),
    h('div', null, h('button', { class: 'btn', type: 'button', disabled: !!S.saving.newJudge, onclick: async () => {
      S.saving.newJudge = true; render();
      const body = { displayName: f.displayName, username: f.username, password: f.password };
      await adminAction(async () => {
        await api('POST', '/api/admin/judges', body);
        S.creds = { heading: `${body.displayName} added to the panel`, title: `DotKonnekt Hackathon, judging panel (${body.displayName})`, username: body.username, password: body.password };
        S.forms.newJudge = null;
      });
      S.saving.newJudge = false; render();
    } }, S.saving.newJudge ? 'Adding…' : 'Add judge')));

  const list = h('div', { class: 'card' },
    h('div', { class: 'spread' }, h('h2', { text: 'Judging panel' }), h('span', { class: 'muted small', text: `${D.judges.length} judges` })),
    D.judges.length === 0 ? h('p', { class: 'muted mt8', text: 'No judges yet.' }) :
      h('div', { class: 'list mt8' }, D.judges.map((j) => {
        if (S.edit && S.edit.kind === 'judge' && S.edit.id === j.id) {
          const e = S.edit.f;
          return h('div', { class: 'item' }, h('div', { class: 'grow stack' },
            h('div', { class: 'form-grid' },
              field('Name', input(e, 'displayName', 'ej-name', { max: 80 })),
              field('Username', input(e, 'username', 'ej-user', { noCaps: true, max: 40 }))),
            h('div', { class: 'form-grid' }, passwordField(e, 'ej-pass', 'New password (leave empty to keep the current one)')),
            h('div', { class: 'row' },
              h('button', { class: 'btn', type: 'button', onclick: () => {
                const body = { displayName: e.displayName, username: e.username };
                if (e.password) body.password = e.password;
                adminAction(async () => {
                  await api('PATCH', `/api/admin/judges/${j.id}`, body);
                  if (e.password) S.creds = { heading: `New login for ${e.displayName}`, title: `DotKonnekt Hackathon, judging panel (${e.displayName})`, username: e.username, password: e.password };
                  S.edit = null;
                }, 'Judge updated.');
              } }, 'Save changes'),
              h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.edit = null; render(); } }, 'Cancel'))));
        }
        return h('div', { class: 'item' },
          h('div', { class: 'grow' },
            h('div', { class: 'title', text: j.displayName }),
            h('div', { class: 'meta' }, 'Username ', h('span', { class: 'mono', text: j.username })),
            confirmBox('judge', j.id, `Remove ${j.displayName} from the panel? Their login and all their scores are deleted. It can’t be undone.`,
              () => adminAction(() => api('DELETE', `/api/admin/judges/${j.id}`), `${j.displayName} removed.`))),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.edit = { kind: 'judge', id: j.id, f: { displayName: j.displayName, username: j.username, password: '' } }; S.confirm = null; render(); } }, 'Edit'),
            h('button', { class: 'btn danger small', type: 'button', onclick: () => { S.confirm = { kind: 'judge', id: j.id }; render(); } }, 'Remove')));
      })));
  return h('div', { class: 'stack' }, credsCard(), list, addForm);
}

function adminSubmissions() {
  const D = S.data;
  if (S.adminTeam) {
    const t = D.teams.find((x) => x.id === S.adminTeam);
    if (t) {
      return h('div', { class: 'stack' },
        h('div', null, h('button', { class: 'linkbtn', type: 'button', onclick: () => { S.adminTeam = null; render(); } }, '‹ All submissions')),
        h('div', { class: 'hero' }, h('h1', { text: 'Team ' + t.codeName }), t.members ? h('p', { class: 'muted', text: t.members }) : null),
        h('div', { class: 'card' }, submissionView(t.submission)));
    }
    S.adminTeam = null;
  }
  return h('div', { class: 'card' },
    D.teams.length === 0 ? h('p', { class: 'muted', text: 'No teams yet.' }) :
      h('div', { class: 'list' }, D.teams.map((t) => h('button', { class: 'pick', type: 'button', onclick: () => { S.adminTeam = t.id; render(); window.scrollTo(0, 0); } },
        h('div', { class: 'grow' }, h('div', { class: 'name title', text: 'Team ' + t.codeName }), h('div', { class: 'meta', text: t.members })),
        t.submission ? h('span', { class: 'ok small', text: 'Submitted ' + fmtTime(t.submission.updatedAt) }) : h('span', { class: 'needs small', text: 'Not submitted' }),
        h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' })))));
}

function adminScores() {
  const D = S.data; const max = maxTotal(); const nJ = D.judges.length;
  const table = h('div', { class: 'card' },
    h('div', { class: 'spread' }, h('h2', { text: 'Standings' }), h('span', { class: 'muted small', text: `Each phase is the judges’ average out of ${max}. Total is out of ${max * 2}.` })),
    h('div', { class: 'scroll mt8' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'num', text: 'Rank' }), h('th', { text: 'Team' }),
        S.phases.map((p) => h('th', { class: 'num', text: p.short })), h('th', { class: 'num', text: 'Total' }), h('th', { text: '' }))),
      h('tbody', null, D.standings.map((r) => h('tr', null,
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', { text: 'Team ' + r.codeName }),
        S.phases.map((p) => h('td', { class: 'num', text: `${fmtNum(r[p.id].avg)}  (${r[p.id].count}/${nJ})` })),
        h('td', { class: 'num title', text: fmtNum(r.total) }),
        h('td', null, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.scoreTeam = r.teamId; render(); } }, 'Details'))))))));
  let detail = null;
  const t = S.scoreTeam && D.teams.find((x) => x.id === S.scoreTeam);
  if (t) {
    detail = h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', { text: `Team ${t.codeName} in detail` }), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.scoreTeam = null; render(); } }, 'Close')),
      S.phases.map((p) => h('div', { class: 'stack tight' }, h('h3', { text: p.name }),
        h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Judge' }), S.criteria.map((c) => h('th', { class: 'num', text: c.name })), h('th', { class: 'num', text: 'Sum' }), h('th', { text: 'Comment' }))),
          h('tbody', null, D.judges.map((j) => {
            const s = D.sheets.find((x) => x.judgeId === j.id && x.teamId === t.id && x.phase === p.id);
            return h('tr', null, h('td', { text: j.displayName }),
              S.criteria.map((c) => h('td', { class: 'num', text: s ? String(s.scores[c.id]) : '–' })),
              h('td', { class: 'num title', text: s ? String(sumScores(s.scores)) : '–' }),
              h('td', { class: 'wrap muted', text: s ? s.comment : '' }));
          })))))));
  }
  return h('div', { class: 'stack' }, table, detail, clearScoresCard());
}
function clearScoresCard() {
  const D = S.data;
  return h('div', { class: 'card stack tight' },
    h('h2', { text: 'Clear a judge’s scores' }),
    h('p', { class: 'muted small', text: 'Deletes that judge’s scores and comments so they can score again. Other judges aren’t affected. This can’t be undone.' }),
    D.results && D.results.published ? h('p', { class: 'needs small', text: 'Results are published. Clearing scores doesn’t withdraw them, so withdraw them on the Overview tab if needed.' }) : null,
    D.judges.length === 0 ? h('p', { class: 'muted', text: 'No judges yet.' }) :
      h('div', { class: 'list' }, D.judges.map((j) => {
        const mine = D.sheets.filter((s) => s.judgeId === j.id);
        const opts = S.phases.map((p) => [p.id, p.short, mine.filter((s) => s.phase === p.id).length]).concat([['all', 'all phases', mine.length]]);
        return h('div', { class: 'item' }, h('div', { class: 'grow' },
          h('div', { class: 'spread' }, h('div', { class: 'title', text: j.displayName }),
            h('span', { class: 'muted small', text: S.phases.map((p, i) => `${p.short}: ${opts[i][2]}`).join(' · ') })),
          h('div', { class: 'row mt8' }, opts.map(([id, label, n]) => h('button', { class: 'btn danger small', type: 'button', disabled: n === 0,
            onclick: () => { S.confirm = { kind: 'clearScores', id: `${j.id}:${id}` }; render(); } }, `Clear ${label}`))),
          opts.map(([id, label, n]) => confirmBox('clearScores', `${j.id}:${id}`,
            `Delete ${j.displayName}’s ${n} score sheet${n === 1 ? '' : 's'} for ${label}? They will need to score again.`,
            () => adminAction(() => api('POST', `/api/admin/judges/${j.id}/scores/clear`, { phase: id }), `${j.displayName}’s ${label} scores cleared.`)))));
      })));
}

function adminAccount() {
  const f = form('account', { current: '', password: '' });
  const cur = input(f, 'current', 'acc-current', { type: 'password', autocomplete: 'current-password', max: 200 });
  return h('div', { class: 'card stack' },
    h('h2', { text: 'Change your password' }),
    h('div', { class: 'form-grid' }, field('Current password', cur), passwordField(f, 'acc-new', 'New password')),
    h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => adminAction(async () => {
      await api('PATCH', '/api/admin/me/password', { currentPassword: f.current, newPassword: f.password });
      S.forms.account = null;
    }, 'Password changed. Other sessions were signed out.') }, 'Change password')));
}

/* ---------------- start ---------------- */
document.getElementById('signout').addEventListener('click', async () => {
  try { await api('POST', '/api/logout'); } catch { /* ignore */ }
  S.me = null; S.data = null; S.draft = null; S.dirty = false; S.submission = null; S.jTeams = []; S.jSheets = []; S.msg = null; S.tab = 'overview';
  render();
});
setInterval(() => {
  if (!S.me || document.hidden) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  if (S.edit || S.confirm || S.scoreDirty) return;
  refresh();
}, 30000);
(async () => {
  try { await loadAll(); } catch (e) { S.msg = { kind: 'error', text: e.message }; }
  S.loading = false; render();
})();
render();
