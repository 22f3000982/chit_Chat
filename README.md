# Chit Chat 💬

A private, WhatsApp-style chat for two people: **Sneha** and **Axon**.

Features: name + 6-digit PIN login · real-time messages · ✓ sent / ✓✓ delivered / blue ✓✓ read ·
online, typing… and last seen · hide last seen · turn off read receipts · photos & videos (up to 50 MB) ·
reply to a message · delete for me / delete for everyone (also removes the file) · emoji · change PIN ·
installable on the phone home screen.

Built with React + Vite, Supabase (login, database, realtime, storage) and hosted on Vercel.

## One-time setup

### 1. Supabase
1. **SQL Editor → New query** → paste everything from [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
2. **Authentication → Users → Add user → Create new user**, twice (tick *Auto Confirm User*):
   | Email | Password |
   |---|---|
   | `sneha@chitchat.app` | Sneha's 6-digit PIN |
   | `axon@chitchat.app` | Axon's 6-digit PIN |
3. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up" so nobody else can make an account.

### 2. Vercel
1. vercel.com → **Add New → Project** → import this GitHub repo.
2. Framework is detected as **Vite**. Click **Deploy**. That's it. Every push to `main` re-deploys automatically.

(The Supabase URL and public anon key live in `src/config.js`. You can also set them as
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` environment variables in Vercel instead.)

### 3. Install on the phone
Open the site → browser menu → **Add to Home screen** / **Install app**.

## Run locally
```bash
npm install
npm run dev
```
