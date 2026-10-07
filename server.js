require('dotenv').config();
const path = require('path'), fs = require('fs'), express = require('express'), Database = require('better-sqlite3');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), rateLimit = require('express-rate-limit');
const { LOCATIONS, ALL_LOCATIONS, CATEGORIES, MEETUP_POINTS } = require('./config');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is required in production.');
  process.exit(1);
}
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const dbPath = path.resolve(__dirname, process.env.DB_PATH || './db/lostfound.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Auto-initialize schema if tables are missing (forgiving setup)
try {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
  }
} catch (e) {
  console.error('DB Auto-init warning:', e.message);
}

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { error: 'Too many attempts, please try again after 15 minutes.' }
});
app.use('/api/auth', authLimiter);

class HttpError extends Error { constructor(s, m, f) { super(m); this.status = s; this.fields = f; } }
const wrap = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };
const str = (v, min, max) => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= max) ? v.trim() : null;

function auth(required = true) {
  return (req, _res, next) => {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    try { req.user = jwt.verify(t, SECRET); } catch { if (required) return next(new HttpError(401, 'Please log in to continue.')); }
    next();
  };
}

function validate(rules, body) {
  const errs = {}, out = {};
  for (const [k, [fn, msg]] of Object.entries(rules)) { const v = fn(body[k]); if (v === null || v === false) errs[k] = msg; else out[k] = v; }
  if (Object.keys(errs).length) throw new HttpError(400, 'Please fix the highlighted fields.', errs);
  return out;
}

// ---------- meta ----------
app.get('/api/meta', (_q, res) => res.json({ locations: LOCATIONS, categories: CATEGORIES, meetupPoints: MEETUP_POINTS }));

// ---------- auth ----------
app.post('/api/auth/register', wrap((req, res) => {
  const d = validate({
    reg_no: [v => /^\d{2}[A-Za-z]{3}\d{4}$/.test(v || '') && v.toUpperCase(), 'Use a valid registration number, e.g. 22BCE1234.'],
    name: [v => str(v, 2, 60), 'Name must be 2–60 characters.'],
    email: [v => /^[^\s@]+@(vitstudent|vit)\.ac\.in$/i.test(v || '') && v.toLowerCase(), 'Use your VIT email (@vitstudent.ac.in).'],
    phone: [v => /^[6-9]\d{9}$/.test(v || '') && v, 'Enter a valid 10-digit mobile number.'],
    password: [v => typeof v === 'string' && v.length >= 8 && v.length <= 72 && v, 'Password must be 8–72 characters.']
  }, req.body);
  try {
    const r = db.prepare('INSERT INTO users (reg_no,name,email,phone,password_hash) VALUES (?,?,?,?,?)')
      .run(d.reg_no, d.name, d.email, d.phone, bcrypt.hashSync(d.password, 10));
    res.status(201).json({ token: jwt.sign({ id: r.lastInsertRowid, name: d.name }, SECRET, { expiresIn: '7d' }), name: d.name });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'An account with this registration number or email already exists.');
    throw e;
  }
}));
app.post('/api/auth/login', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE reg_no = ? OR email = ?')
    .get(String(req.body.login || '').toUpperCase(), String(req.body.login || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) throw new HttpError(401, 'Invalid credentials.');
  res.json({ token: jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: '7d' }), name: u.name });
}));

// ---------- items (public fields only: no poster identity) ----------
const PUBLIC = 'i.id,i.type,i.title,i.description,i.category,i.location,i.event_date,i.challenge,i.status,i.created_at';
app.get('/api/items', auth(false), wrap((req, res) => {
  const { type, category, location, q } = req.query;
  const w = ["i.status='active'"], p = [];
  if (['lost', 'found'].includes(type)) { w.push('i.type=?'); p.push(type); }
  if (CATEGORIES.includes(category)) { w.push('i.category=?'); p.push(category); }
  if (ALL_LOCATIONS.includes(location)) { w.push('i.location=?'); p.push(location); }

  if (q && q.length <= 60) {
    const sanitizedQ = q.replace(/[\\%_]/g, '\\$&');
    w.push('(i.title LIKE ? OR i.description LIKE ? ESCAPE \'\\\')');
    p.push(`%${sanitizedQ}%`, `%${sanitizedQ}%`);
  }
  const uid = req.user ? req.user.id : 0;
  const rows = db.prepare(`SELECT ${PUBLIC}, (i.poster_id=?) AS mine,
      (SELECT status FROM claims c WHERE c.item_id=i.id AND c.claimant_id=?) AS my_claim
      FROM items i WHERE ${w.join(' AND ')} ORDER BY i.created_at DESC LIMIT 100`).all(uid, uid, ...p);
  res.json(rows);
}));
app.post('/api/items', auth(), wrap((req, res) => {
  const d = validate({
    type: [v => ['lost', 'found'].includes(v) && v, 'Choose Lost or Found.'],
    title: [v => str(v, 3, 80), 'Title must be 3–80 characters.'],
    description: [v => str(v, 10, 500), 'Description must be 10–500 characters.'],
    category: [v => CATEGORIES.includes(v) && v, 'Pick a valid category.'],
    location: [v => ALL_LOCATIONS.includes(v) && v, 'Pick an official VIT campus location.'],
    event_date: [v => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
      const date = new Date(v);
      if (isNaN(date.getTime())) return false;
      if (date.getUTCFullYear() !== parseInt(v.split('-')[0]) ||
          date.getUTCMonth() + 1 !== parseInt(v.split('-')[1]) ||
          date.getUTCDate() !== parseInt(v.split('-')[2])) return false;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Allow 1 day of slack for timezone differences (IST)
      const diff = (date - today) / (1000 * 60 * 60 * 24);
      if (diff > 1.1) return false;
      return true;
    }, 'Enter a valid date (not in the future).'],
    challenge: [v => str(v, 8, 200), 'Verification question must be 8–200 characters.']
  }, req.body);
  const r = db.prepare('INSERT INTO items (type,title,description,category,location,event_date,challenge,poster_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(d.type, d.title, d.description, d.category, d.location, d.event_date, d.challenge, req.user.id);
  res.status(201).json({ id: r.lastInsertRowid });
}));

// ---------- claims ----------
app.post('/api/items/:id/claims', auth(), wrap((req, res) => {
  const item = db.prepare("SELECT * FROM items WHERE id=? AND status='active'").get(req.params.id);
  if (!item) throw new HttpError(404, 'This item is no longer available.');
  if (item.poster_id === req.user.id) throw new HttpError(403, 'You cannot claim your own post.');
  const { answer } = validate({ answer: [v => str(v, 3, 300), 'Answer must be 3–300 characters.'] }, req.body);
  try { db.prepare('INSERT INTO claims (item_id,claimant_id,answer) VALUES (?,?,?)').run(item.id, req.user.id, answer); }
  catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'You already submitted a claim for this item.'); throw e; }
  res.status(201).json({ ok: true });
}));

app.get('/api/dashboard', auth(), wrap((req, res) => {
  const incoming = db.prepare(`SELECT c.id,c.answer,c.status,c.meetup_point,c.created_at,i.id AS item_id,i.title,i.type,i.challenge,i.status AS item_status
    FROM claims c JOIN items i ON i.id=c.item_id WHERE i.poster_id=? ORDER BY c.created_at DESC`).all(req.user.id);
  const outgoing = db.prepare(`SELECT c.id,c.status,c.meetup_point,c.created_at,i.id AS item_id,i.title,i.type,i.status AS item_status
    FROM claims c JOIN items i ON i.id=c.item_id WHERE c.claimant_id=? ORDER BY c.created_at DESC`).all(req.user.id);
  const posts = db.prepare('SELECT id,type,title,status,created_at FROM items WHERE poster_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ incoming, outgoing, posts });
}));

function loadClaim(id, uid) {
  const c = db.prepare(`SELECT c.*, i.poster_id, i.status AS item_status, i.title FROM claims c JOIN items i ON i.id=c.item_id WHERE c.id=?`).get(id);
  if (!c || (c.poster_id !== uid && c.claimant_id !== uid)) throw new HttpError(404, 'Claim not found.');
  return c;
}
app.patch('/api/claims/:id', auth(), wrap((req, res) => {
  const c = loadClaim(req.params.id, req.user.id);
  if (c.poster_id !== req.user.id) throw new HttpError(403, 'Only the poster can review claims.');
  if (c.status !== 'pending') throw new HttpError(409, 'This claim was already reviewed.');
  if (c.item_status !== 'active') throw new HttpError(409, 'This item is already resolved.');
  const action = req.body.action;
  if (action === 'reject') { db.prepare("UPDATE claims SET status='rejected' WHERE id=?").run(c.id); return res.json({ ok: true }); }
  if (action !== 'approve') throw new HttpError(400, 'Action must be approve or reject.');
  const mp = req.body.meetup_point;
  if (!MEETUP_POINTS.includes(mp)) throw new HttpError(400, 'Choose a valid campus meetup checkpoint.', { meetup_point: 'Required' });

  // Transaction: Approve this claim AND reject all others for this item
  const txn = db.transaction(() => {
    db.prepare("UPDATE claims SET status='approved', meetup_point=? WHERE id=?").run(mp, c.id);
    db.prepare("UPDATE claims SET status='rejected' WHERE item_id=? AND id!=?").run(c.item_id, c.id);
  });
  txn();

  db.prepare('INSERT INTO messages (claim_id,sender_id,body) VALUES (?,?,?)')
    .run(c.id, req.user.id, `Claim approved. Suggested meetup: ${mp}. Please coordinate a time here.`);
  res.json({ ok: true });
}));

app.get('/api/claims/:id/messages', auth(), wrap((req, res) => {
  const c = loadClaim(req.params.id, req.user.id);
  if (c.status !== 'approved') throw new HttpError(403, 'Chat opens after the claim is approved.');
  const msgs = db.prepare('SELECT id,sender_id,body,created_at FROM messages WHERE claim_id=? ORDER BY id').all(c.id)
    .map(m => ({ id: m.id, body: m.body, created_at: m.created_at, mine: m.sender_id === req.user.id,
      role: m.sender_id === c.poster_id ? 'Item poster' : 'Claimant' }));   // roles only, never identity
  res.json({ title: c.title, meetup_point: c.meetup_point, resolved: c.item_status === 'resolved', messages: msgs });
}));
app.post('/api/claims/:id/messages', auth(), wrap((req, res) => {
  const c = loadClaim(req.params.id, req.user.id);
  if (c.status !== 'approved') throw new HttpError(403, 'Chat opens after the claim is approved.');
  if (c.item_status === 'resolved') throw new HttpError(409, 'This item is resolved; chat is closed.');
  const { body } = validate({ body: [v => str(v, 1, 500), 'Message must be 1–500 characters.'] }, req.body);
  db.prepare('INSERT INTO messages (claim_id,sender_id,body) VALUES (?,?,?)').run(c.id, req.user.id, body);
  res.status(201).json({ ok: true });
}));

// ---------- lifecycle ----------
app.post('/api/items/:id/resolve', auth(), wrap((req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) throw new HttpError(404, 'Item not found.');
  if (item.status === 'resolved') throw new HttpError(409, 'This item is already resolved.');

  const isParty = item.poster_id === req.user.id ||
    db.prepare("SELECT 1 FROM claims WHERE item_id=? AND claimant_id=? AND status='approved'").get(item.id, req.user.id);
  if (!isParty) throw new HttpError(403, 'Only the poster or an approved claimant can resolve this item.');
  db.prepare("UPDATE items SET status='resolved', resolved_at=datetime('now') WHERE id=?").run(item.id);
  res.json({ ok: true });
}));

app.use('/api', (_q, _r, next) => next(new HttpError(404, 'Not found.')));
app.use((err, _q, res, _n) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body.');
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Server error. Please try again.', fields: err.fields });
});

if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log(`Running on http://localhost:${process.env.PORT || 3000}`));
module.exports = app;
