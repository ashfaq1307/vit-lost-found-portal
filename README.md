# VIT Campus Lost & Found Recovery Portal

Full-stack web app that replaces messy WhatsApp groups: report lost/found items at official VIT venues, verify ownership through a private claim check, and coordinate returns without exposing anyone's phone number, email or registration number.

**Stack:** Node.js + Express · SQLite (better-sqlite3) · JWT auth (bcrypt) · Vanilla JS frontend (no build step)

## Features
- Separate **Lost** / **Found** boards with category tags (ID Cards, Room Keys, Calculators, Lab Equipment, Earphones, Wallets)
- Locations restricted server-side to official landmarks (SJT, TT, PRP, SMV, MB, GDN, CDMM, MH-A…T, LH-A…J, Gazebo, Food Mall, DC, Central Library, Sports Complex)
- **Privacy:** public API never returns poster reg. no., email, phone or name ("Anonymous student")
- **Claim Verification Request:** poster sets a challenge question; claimant answers; poster approves/rejects in a private dashboard (claimant identity hidden from poster too)
- **Handoff:** approval requires a campus meetup checkpoint and opens a private thread where parties appear only as "Item poster" / "Claimant"
- **Lifecycle:** either party can mark *Resolved* → item leaves the active boards, chat closes
- Validation with per-field errors, loading spinners, empty states, submit-state buttons and toasts

## Project structure
```
vit-lost-found/
├── server.js          # Express API + validation + privacy rules
├── config.js          # Campus locations, categories, meetup checkpoints
├── db/schema.sql      # Tables: users, items, claims, messages
├── db/init.js         # DB bootstrap (+ optional --seed demo data)
├── public/            # index.html, app.js, style.css (SPA)
├── test.js            # End-to-end API smoke test
├── .env.example
└── README.md
```

## Local setup
Requires Node.js 18+.
```bash
git clone <your-repo-url> && cd vit-lost-found
npm install
cp .env.example .env        # set JWT_SECRET to a long random string
npm run db:init             # creates db/lostfound.db from schema.sql
npm run db:seed             # optional: demo users + items
npm start                   # http://localhost:3000
npm test                    # optional: runs the full flow test
```
Demo logins (after seeding, password `Password@123`): `22BCE0001` (finder), `22BCE0002` (owner).

## API summary
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Auth |
| GET | `/api/items?type=&category=&location=&q=` | Public active feed |
| POST | `/api/items` | Report item (with verification question) |
| POST | `/api/items/:id/claims` | Submit claim answer |
| GET | `/api/dashboard` | My posts, incoming/outgoing claims |
| PATCH | `/api/claims/:id` | Approve (with checkpoint) / reject |
| GET/POST | `/api/claims/:id/messages` | Private thread (approved claims only) |
| POST | `/api/items/:id/resolve` | Mark resolved |

## Validation rules
Reg. no. `22BCE1234` format · VIT email domain · 10-digit mobile · password ≥ 8 chars · item title/description/question length limits · location/category whitelist · date not in future · one claim per user per item · no self-claims.
