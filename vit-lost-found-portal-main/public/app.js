const $ = s => document.querySelector(s), app = $('#app');
const S = { token: localStorage.token, name: localStorage.name, meta: null, tab: 'found', view: 'feed', lastReqId: 0 };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function toast(msg, kind = '') { const t = $('#toast'); t.textContent = msg; t.className = 'show ' + kind; setTimeout(() => t.className = '', 2600); }
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: 'Bearer ' + S.token }) }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) {
    toast('Your session has expired. Please log in again.', 'bad');
    logout();
    const e = new Error('Session expired'); e.isSessionExpired = true; throw e;
  }
  if (!r.ok) { const e = new Error(d.error || 'Something went wrong'); e.fields = d.fields || {}; throw e; }
  return d;
}
const loading = () => app.innerHTML = '<div class="spin"></div>';
function showFieldErrors(form, fields) {
  form.querySelectorAll('.err').forEach(e => e.remove());
  for (const [k, m] of Object.entries(fields || {})) { const el = form.querySelector(`[name=${k}]`); if (el) el.insertAdjacentHTML('afterend', `<div class="err">${esc(m)}</div>`); }
}
async function submitForm(form, fn, okMsg) {
  const btn = form.querySelector('button[type=submit]'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Submitting…';
  try { await fn(Object.fromEntries(new FormData(form))); toast(okMsg, 'good'); return true; }
  catch (e) { showFieldErrors(form, e.fields); toast(e.message, 'bad'); return false; }
  finally { btn.disabled = false; btn.textContent = label; }
}
function nav() {
  $('#nav').innerHTML = S.token
    ? `<span class="mut" style="color:#dfe7ff">Hi, ${esc(S.name)}</span>
       <button class="sec" data-go="feed">Boards</button><button class="sec" data-go="report">+ Report</button>
       <button class="sec" data-go="dash">My Dashboard</button><button class="sec" id="lo">Logout</button>`
    : '<button class="sec" data-go="auth">Login / Register</button>';
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  if ($('#lo')) $('#lo').onclick = logout;
}
function logout() { localStorage.clear(); S.token = null; go('auth'); }
function go(v, arg) { 
  clearInterval(window._chatPoll);
  S.view = v; ({ feed, report: reportView, dash, auth: authView, chat: chatView })[v](arg); nav(); 
}

// ---------- auth ----------
function authView() {
  app.innerHTML = `<div class="grid">
  <form class="card" id="lf"><h3>Login</h3><label>Reg. No or Email</label><input name="login" required>
    <label>Password</label><input type="password" name="password" required><button type="submit">Login</button></form>
  <form class="card" id="rf"><h3>Register</h3>
    <label>Registration No.</label><input name="reg_no" placeholder="22BCE1234" required>
    <label>Name</label><input name="name" required><label>VIT Email</label><input name="email" type="email" required>
    <label>Mobile (kept private)</label><input name="phone" required><label>Password</label><input type="password" name="password" required>
    <button type="submit">Create account</button></form></div>`;
  const done = d => { S.token = localStorage.token = d.token; S.name = localStorage.name = d.name; go('feed'); };
  $('#lf').onsubmit = async e => { e.preventDefault(); await submitForm(e.target, async b => done(await api('/auth/login', 'POST', b)), 'Welcome back!'); };
  $('#rf').onsubmit = async e => { e.preventDefault(); await submitForm(e.target, async b => done(await api('/auth/register', 'POST', b)), 'Account created!'); };
}

// ---------- feed ----------
const opts = (arr, ph) => `<option value="">${ph}</option>` + arr.map(x => `<option>${esc(x)}</option>`).join('');
const locOpts = ph => `<option value="">${ph}</option>` + Object.entries(S.meta.locations).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(x => `<option>${esc(x)}</option>`).join('')}</optgroup>`).join('');
async function feed() {
  if (!S.meta) S.meta = await api('/meta');
  app.innerHTML = `<div class="tabs"><button data-t="found">Found Items</button><button data-t="lost">Lost Items</button></div>
   <div class="card filters"><input id="q" placeholder="Search…"><select id="cat">${opts(S.meta.categories, 'All categories')}</select><select id="loc">${locOpts('All locations')}</select></div>
   <div id="list"></div>`;
  document.querySelectorAll('[data-t]').forEach(b => { b.classList.toggle('on', b.dataset.t === S.tab); b.onclick = () => { S.tab = b.dataset.t; feed(); }; });
  let timer; const reload = () => { clearTimeout(timer); timer = setTimeout(loadList, 250); };
  ['q', 'cat', 'loc'].forEach(id => $('#' + id).oninput = reload);
  loadList();
}
async function loadList() {
  const list = $('#list'); list.innerHTML = '<div class="spin"></div>';
  const reqId = ++S.lastReqId;
  const p = new URLSearchParams({ type: S.tab, q: $('#q').value, category: $('#cat').value, location: $('#loc').value });
  try {
    const items = await api('/items?' + p);
    if (reqId !== S.lastReqId) return;
    list.innerHTML = items.length ? `<div class="grid">${items.map(card).join('')}</div>` : `<div class="empty">No ${S.tab} items match. Try other filters.</div>`;
    list.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => claimForm(b.dataset.claim, items));
  } catch (e) { 
    if (e.isSessionExpired) return;
    if (reqId === S.lastReqId) list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; 
  }
}
const card = i => `<div class="card"><span class="tag ${i.type}">${i.type}</span><span class="tag">${esc(i.category)}</span>
  <h3 style="margin:6px 0">${esc(i.title)}</h3><p>${esc(i.description)}</p>
  <p class="mut">📍 ${esc(i.location)} · ${esc(i.event_date)} · Posted by <b>Anonymous student</b></p>
  ${i.mine ? '<span class="mut">Your post</span>' : i.my_claim ? `<span class="tag ${i.my_claim}">Your request: ${i.my_claim}</span>`
    : `<button data-claim="${i.id}">${i.type === 'found' ? 'This is mine' : 'I found this'}</button>`}</div>`;

function claimForm(id, items) {
  if (!S.token) { toast('Please log in first', 'bad'); return go('auth'); }
  const it = items.find(x => x.id == id);
  app.innerHTML = `<form class="card"><h3>Claim Verification Request</h3><p><b>${esc(it.title)}</b></p>
   <p class="mut">The poster set this challenge. Your identity details stay hidden.</p>
   <label>${esc(it.challenge)}</label><textarea name="answer" rows="3" maxlength="300" required></textarea>
   <div class="row"><button type="submit">Submit request</button><button type="button" class="sec" id="cx">Cancel</button></div></form>`;
  $('#cx').onclick = () => go('feed');
  app.querySelector('form').onsubmit = async e => { e.preventDefault();
    if (await submitForm(e.target, b => api(`/items/${id}/claims`, 'POST', b), 'Request submitted!')) go('dash'); };
}

// ---------- report ----------
function reportView() {
  app.innerHTML = `<form class="card"><h3>Report an item</h3>
   <label>Type</label><select name="type"><option value="found">I FOUND an item</option><option value="lost">I LOST an item</option></select>
   <label>Title</label><input name="title" maxlength="80" required>
   <label>Category</label><select name="category">${opts(S.meta.categories, 'Select…')}</select>
   <label>Campus location</label><select name="location">${locOpts('Select…')}</select>
   <label>Date</label><input type="date" name="event_date" max="${localDate()}" required>
   <label>Description (don't reveal identifying details)</label><textarea name="description" rows="3" maxlength="500" required></textarea>
   <label>Verification question (claimants must answer it)</label><input name="challenge" maxlength="200" placeholder="What name/branch is on the ID tag?" required>
   <button type="submit">Publish</button></form>`;
  app.querySelector('form').onsubmit = async e => { e.preventDefault();
    if (await submitForm(e.target, b => api('/items', 'POST', b), 'Item published!')) go('feed'); };
}

// ---------- dashboard ----------
async function dash() {
  loading();
  try {
    const d = await api('/dashboard');
    const badge = s => `<span class="tag ${s}">${s}</span>`;
    const inc = d.incoming.map(c => `<div class="card">${badge(c.status)}<b>${esc(c.title)}</b>
      <p class="mut">Challenge: ${esc(c.challenge)}</p><p>Claimant's answer: <i>${esc(c.answer)}</i></p>
      ${c.status === 'pending' && c.item_status === 'active' ? `<div class="row"><select id="mp${c.id}">${opts(S.meta.meetupPoints, 'Meetup checkpoint…')}</select>
        <button class="ok" data-ap="${c.id}">Approve</button><button class="bad" data-rj="${c.id}">Reject</button></div>`
      : c.status === 'approved' ? `<button data-chat="${c.id}">Open private chat</button>` : ''}</div>`).join('');
    const out = d.outgoing.map(c => `<div class="card">${badge(c.status)}<b>${esc(c.title)}</b>
      ${c.status === 'approved' ? `<p class="mut">Meetup: ${esc(c.meetup_point)}</p><button data-chat="${c.id}">Open private chat</button>` : ''}</div>`).join('');
    const posts = d.posts.map(p => `<div class="card row" style="justify-content:space-between"><span>${badge(p.type)}${esc(p.title)} ${badge(p.status === 'active' ? 'pending' : 'approved').replace(/>(pending|approved)</, `>${p.status}<`)}</span>
      ${p.status === 'active' ? `<button class="sec" data-res="${p.id}">Mark Resolved</button>` : ''}</div>`).join('');
    app.innerHTML = `<h3>Claims on my posts</h3>${inc || '<div class="empty">No claims yet.</div>'}
      <h3>My claim requests</h3>${out || '<div class="empty">You haven\'t claimed anything.</div>'}
      <h3>My posts</h3>${posts || '<div class="empty">No posts yet.</div>'}`;
    app.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => act(`/claims/${b.dataset.ap}`, 'PATCH', { action: 'approve', meetup_point: $('#mp' + b.dataset.ap).value }, 'Approved — chat opened'));
    app.querySelectorAll('[data-rj]').forEach(b => b.onclick = () => act(`/claims/${b.dataset.rj}`, 'PATCH', { action: 'reject' }, 'Claim rejected'));
    app.querySelectorAll('[data-res]').forEach(b => b.onclick = () => act(`/items/${b.dataset.res}/resolve`, 'POST', {}, 'Marked as resolved'));
    app.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => go('chat', b.dataset.chat));
  } catch (e) { 
    if (e.isSessionExpired) return;
    app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; 
  }
}
async function act(path, m, body, ok) { try { await api(path, m, body); toast(ok, 'good'); dash(); } catch (e) { toast(e.message, 'bad'); } }

// ---------- chat ----------
async function chatView(id) {
  loading();
  try {
    const d = await api(`/claims/${id}/messages`);
    app.innerHTML = `<div class="card"><h3>${esc(d.title)}</h3><p class="mut">📍 Agreed checkpoint: <b>${esc(d.meetup_point)}</b>. Never share phone numbers; meet in public campus spots.</p>
     <div class="chat" id="ch">${d.messages.map(m => `<div class="msg ${m.mine ? 'me' : ''}"><small>${m.mine ? 'You' : esc(m.role)}</small>${esc(m.body)}</div>`).join('')}</div>
     ${d.resolved ? '<p class="mut">✅ Resolved — chat closed.</p>' : `<form class="row"><input name="body" maxlength="500" placeholder="Type a message…" required style="flex:1"><button type="submit">Send</button></form>`}
     <div class="row" style="margin-top:8px"><button class="sec" id="bk">Back</button>${d.resolved ? '' : '<button class="ok" id="rs">Mark item returned (Resolved)</button>'}</div></div>`;
    $('#ch').scrollTop = 1e6; $('#bk').onclick = () => go('dash');
    const f = app.querySelector('form'); if (f) f.onsubmit = async e => { e.preventDefault(); if (await submitForm(f, b => api(`/claims/${id}/messages`, 'POST', b), 'Sent')) chatView(id); };
    if ($('#rs')) $('#rs').onclick = async () => { const c = (await api('/dashboard')); const row = [...c.incoming, ...c.outgoing].find(x => x.id == id);
      try { await api(`/items/${row.item_id}/resolve`, 'POST', {}); toast('Item resolved 🎉', 'good'); go('dash'); } catch (e) { toast(e.message, 'bad'); } };
    
    if (!d.resolved) {
      const poll = setInterval(async () => {
        try { 
          const fresh = await api(`/claims/${id}/messages`);
          if (fresh.resolved) { clearInterval(poll); chatView(id); }
          else if (JSON.stringify(fresh.messages) !== JSON.stringify(d.messages)) {
            const ch = $('#ch'); if (ch) {
              ch.innerHTML = fresh.messages.map(m => `<div class="msg ${m.mine ? 'me' : ''}"><small>${m.mine ? 'You' : esc(m.role)}</small>${esc(m.body)}</div>`).join('');
              ch.scrollTop = 1e6;
            }
          }
        } catch (e) {}
      }, 5000);
      window._chatPoll = poll;
    }
  } catch (e) { 
    if (e.isSessionExpired) return;
    app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; 
  }
}

(async () => { 
  try { 
    S.meta = await api('/meta'); 
    go(S.token ? 'feed' : 'auth'); 
  } catch (e) { 
    app.innerHTML = `<div class="empty">Failed to load system configuration. Please refresh the page.</div>`;
  }
})();
