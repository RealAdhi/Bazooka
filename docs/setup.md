# Setup checklist

## Environment variable names (Vercel → Project → Settings → Environment Variables)

The code reads exactly these names. If yours differ, rename them in Vercel (no code change needed).

| Name | What |
|---|---|
| `SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Public (anon / publishable) key. Sent to the browser by `/api/config`; safe because of RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key. Server only |
| `AZURE_SPEECH_KEY` | Azure AI Speech key (also accepted: `SPEECH_KEY`, `speech_key`) |
| `AZURE_SPEECH_REGION` | Optional, defaults to `eastus` |
| `GEMINI_API_KEY` | From aistudio.google.com |
| `XAI_API_KEY` | Grok (optional) |
| `ANTHROPIC_API_KEY` | Claude (optional) |
| `DEEPGRAM_API_KEY` | Only if transcription is switched to Deepgram |
| `SITE_URL` | Optional. The production address, used in invite emails |
| `CRON_SECRET` | Any long random string; lets Vercel's daily cron call `/api/cleanup` |

## Supabase — done on 2026-11-05 (from a cloud session, via the Management API)

- All migrations + seed applied (`supabase_migrations.schema_migrations` records them). New migrations: run `supabase/tests/remote-sql.sh -f <file>` (needs `SUPABASE_ACCESS_TOKEN`), then insert the version into that table.
- Auth: public sign-up **off**, minimum password 10. Site URL and redirect URLs were already set to the Vercel address.
- `adhithya.sriram@inmobi.com` exists in Auth and is admin. Sign in with "Email me a sign-in link", then choose a password.
- Emails: Supabase's built-in sender (rate-limited to a few an hour; fine for four people).
- Storage: audio is deleted as soon as it is transcribed; `/api/cleanup` deletes anything left for 24 hours. Transcripts stay in `captures.transcript`.

## Still manual (dashboards only)

1. **Vercel → Project → Settings → Deployment Protection:** the site is behind "Vercel Authentication", so only people logged into your Vercel team can open it, and agents can't reach `/api/mcp` at all. Turn Vercel Authentication **off** (Bazooka has its own login), or set it to protect previews only and use the production domain listed under **Settings → Domains**.
2. **Vercel → Environment Variables:** add `CRON_SECRET` (any long random string) so the daily audio cleanup runs. Optional: `AZURE_SPEECH_REGION` (defaults to `eastus`, which is where your key lives). The Azure key may be named `AZURE_SPEECH_KEY`, `SPEECH_KEY` or `speech_key`.
3. **Redeploy** after changing env vars (Deployments → … → Redeploy).

## Vercel

- Framework preset: **Other**. No build command. Output directory: the repo root.
- Functions live in `api/`; `vercel.json` gives them 300 s and schedules `/api/cleanup` daily.

## Agents

Admin → Agents → add or pick an agent → Create token. Connect it to `/api/mcp` (or `/api/agent`) with `Authorization: Bearer <token>` and paste the instructions from `AGENTS.md`.
