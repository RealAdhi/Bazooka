# Setup checklist

## Environment variable names (Vercel → Project → Settings → Environment Variables)

The code reads exactly these names. If yours differ, rename them in Vercel (no code change needed).

| Name | What |
|---|---|
| `SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Public (anon / publishable) key. Sent to the browser by `/api/config`; safe because of RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key. Server only |
| `AZURE_SPEECH_KEY` | Azure AI Speech key |
| `AZURE_SPEECH_REGION` | e.g. `centralindia` |
| `GEMINI_API_KEY` | From aistudio.google.com |
| `XAI_API_KEY` | Grok (optional) |
| `ANTHROPIC_API_KEY` | Claude (optional) |
| `DEEPGRAM_API_KEY` | Only if transcription is switched to Deepgram |
| `SITE_URL` | Optional. The production address, used in invite emails |

## Supabase, one time

1. **Run the migrations** in order (`supabase/migrations/*.sql`), then `supabase/seed.sql`. Either `supabase db push` with the CLI, or paste each file into SQL Editor.
2. **Authentication → Sign In / Providers → Email:** enabled. **Allow new users to sign up: off** (invite only).
3. **Authentication → URL Configuration:** Site URL = the Vercel production address. Redirect URLs: add `https://<site>/login.html` and `https://<site>/login.html?next=set-password` (and the Vercel preview pattern if you want previews to work).
4. **Emails:** Supabase's built-in sender works but is rate-limited (a few emails an hour) and meant for testing. Fine for four people; add custom SMTP later if invites or links stop arriving.
5. **Storage → Settings:** global upload limit at least 100 MB (the `captures` bucket allows 500 MB; the project limit caps it). On the free plan the cap is 50 MB, about 2 hours of audio at Bazooka's bitrate.
6. **First admin:** `adhithya.sriram@inmobi.com` is pre-approved as admin by the migrations. Sign in with "Email me a sign-in link" on `/login.html`, then set a password. (Or create the user in Authentication → Users → Add user; the trigger makes it admin.)

## Vercel

- Framework preset: **Other**. No build command. Output directory: the repo root.
- Functions live in `api/`; `vercel.json` gives them 300 s.

## Agents

Admin → Agents → Create token, then paste `AGENTS.md` instructions + token into the agent.
