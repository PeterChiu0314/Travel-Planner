# 旅程規劃室

React + Supabase collaborative travel planner with Google login, owner-approved trip membership, realtime itinerary updates, packing lists, budget summary, invite links, and JSON export.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and fill in:

   ```bash
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

3. In Supabase SQL Editor, run:

   ```text
   supabase/migrations/001_collaborative_travel_planner.sql
   ```

4. In Supabase Auth providers, enable Google OAuth and add redirect URLs:

   ```text
   http://localhost:5173
   http://127.0.0.1:5173
   https://your-vercel-domain.vercel.app
   ```

5. Start development:

   ```bash
   npm run dev
   ```

## Collaboration Flow

- The owner creates a trip.
- The owner clicks `邀請朋友` and sends the copied link.
- A friend opens the link, signs in with Google, and becomes `pending`.
- The owner approves the friend in the `成員` panel.
- Approved members can edit itinerary and packing items. Changes sync through Supabase Realtime.
"# Travel-Planner" 
"# Travel-Planner" 
"# Travel-Planner" 
