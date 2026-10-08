// Smoke test of the full claim → approve → chat → resolve flow (uses a temp DB).
process.env.DB_PATH = './db/test.db'; process.env.JWT_SECRET = 't';
const fs = require('fs'); try { fs.unlinkSync('./db/test.db'); } catch {}
require('child_process').execSync('node db/init.js', { env: process.env });
const assert = require('assert'), app = require('./server'), srv = app.listen(0);
const base = `http://localhost:${srv.address().port}/api`;
const call = async (p, m = 'GET', b, t) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t && { Authorization: 'Bearer ' + t }) }, body: b && JSON.stringify(b) }); return { s: r.status, d: await r.json() }; };
(async () => {
  const reg = async (n, r) => (await call('/auth/register', 'POST', { reg_no: r, name: n, email: `${n}@vitstudent.ac.in`, phone: '9876543210', password: 'Password@1' })).d.token;
  const A = await reg('finder', '22BCE0001'), B = await reg('owner', '22BCE0002');
  assert.equal((await call('/items', 'POST', { type: 'found' }, A)).s, 400);
  assert.equal((await call('/items', 'POST', { type: 'found', title: 'ID card', description: 'blue lanyard id', category: 'ID Cards', location: 'NOPE', event_date: '2026-10-01', challenge: 'Name on the ID?' }, A)).s, 400);
  const it = await call('/items', 'POST', { type: 'found', title: 'ID card', description: 'blue lanyard id', category: 'ID Cards', location: 'SJT', event_date: '2026-10-01', challenge: 'Name on the ID?' }, A);
  const feed = (await call('/items?type=found')).d; assert.ok(!JSON.stringify(feed).match(/22BCE|9876543210|vitstudent/));
  const cl = await call(`/items/${it.d.id}/claims`, 'POST', { answer: 'Ravi, CSE' }, B); assert.equal(cl.s, 201);
  assert.equal((await call('/claims/1/messages', 'GET', null, B)).s, 403);
  assert.equal((await call('/claims/1', 'PATCH', { action: 'approve', meetup_point: 'Central Library Security Desk' }, B)).s, 403);
  assert.equal((await call('/claims/1', 'PATCH', { action: 'approve', meetup_point: 'Central Library Security Desk' }, A)).s, 200);
  assert.equal((await call('/claims/1/messages', 'POST', { body: 'See you at 5' }, B)).s, 201);
  const th = (await call('/claims/1/messages', 'GET', null, A)).d; assert.ok(!JSON.stringify(th).match(/22BCE|owner|finder/));
  assert.equal((await call(`/items/${it.d.id}/resolve`, 'POST', {}, B)).s, 200);
  assert.equal((await call('/items?type=found')).d.length, 0);
  console.log('All tests passed ✅'); srv.close(); fs.unlinkSync('./db/test.db');
})().catch(e => { console.error(e); process.exit(1); });
