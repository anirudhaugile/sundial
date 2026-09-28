# Sundial

A calm, AI-assisted planner for students. Sundial pulls assignments from Canvas and events from
Outlook, asks an LLM how long each assignment will take, and then a deterministic scheduler finds the
time — around your meetings, the gym, and your internship applications.

> Work in progress. Full README (architecture, demo, setup) lands with the demo.

## Local setup

```bash
npm install
npx supabase start          # needs Docker
npx supabase db reset       # applies migrations
cp .env.example .env.local  # fill in values from `npx supabase status`
npm run dev
```

Magic-link emails in local dev go to Mailpit at http://127.0.0.1:54324.
