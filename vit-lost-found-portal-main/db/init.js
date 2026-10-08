require('dotenv').config();
const fs = require('fs'), path = require('path'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs');
const file = path.resolve(__dirname, '..', process.env.DB_PATH || './db/lostfound.db');
const db = new Database(file);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
console.log('Schema ready at', file);
if (process.argv.includes('--seed')) {
  const hash = bcrypt.hashSync('Password@123', 10);
  const u = db.prepare('INSERT OR IGNORE INTO users (reg_no,name,email,phone,password_hash) VALUES (?,?,?,?,?)');
  u.run('22BCE0001', 'Demo Finder', 'finder@vitstudent.ac.in', '9000000001', hash);
  u.run('22BCE0002', 'Demo Owner', 'owner@vitstudent.ac.in', '9000000002', hash);
  if (!db.prepare('SELECT 1 FROM items').get()) {
    const i = db.prepare('INSERT INTO items (type,title,description,category,location,event_date,challenge,poster_id) VALUES (?,?,?,?,?,?,?,?)');
    i.run('found', 'Student ID card', 'Found near the stairs, blue lanyard.', 'ID Cards', 'SJT', '2026-10-05', 'What name and branch are printed on the ID?', 1);
    i.run('lost', 'Casio fx-991EX calculator', 'Lost after CAT-1, sticker on the back.', 'Calculators', 'TT', '2026-10-04', 'Where and how did you find it?', 2);
  }
  console.log('Seeded demo users (password: Password@123) and items.');
}
