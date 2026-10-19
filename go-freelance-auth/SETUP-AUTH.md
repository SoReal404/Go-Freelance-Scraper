# Auth setup (Supabase + Google + Gmail activation)

## 1. Env
Copy `.env.example` to `.env.local`, fill URL + publishable key (Supabase → Project Settings → API). Use the project URL itself (for example, `https://<project-ref>.supabase.co`), not the REST endpoint ending in `/rest/v1`.
Restart `pnpm dev`.

## 2. Supabase → Authentication → URL Configuration
- Site URL: your production URL (dev: http://localhost:3000)
- Redirect URLs (add all):
  - http://localhost:3000/**
  - https://YOUR-DOMAIN/**

## 3. Email activation
Authentication → Sign In / Providers → Email: enable "Confirm email". Min password length = 8.

Authentication → Email Templates → "Confirm signup", replace the link with:

    <h2>Activate your GO Freelance account</h2>
    <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">Activate my account</a></p>

(This works even when the link is opened in the Gmail app on a different device.)

## 4. Sending real emails
Supabase's built-in sender is for testing only (very low hourly limit). Authentication → SMTP Settings → custom SMTP:
- Resend / Brevo (recommended), or
- Gmail: host smtp.gmail.com, port 465, user = your Gmail, pass = Google App Password
  (needs 2-Step Verification on; ~500 emails/day cap).

## 5. Google sign-in
Google Cloud Console → APIs & Services → OAuth consent screen (External) → Credentials →
Create OAuth client ID → Web application:
- Authorized redirect URI: https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
Supabase → Authentication → Providers → Google: enable, paste Client ID + Secret.
Publish the consent screen (move from Testing to In production) or only test users can log in.

## 6. Freelancer profiles and activity
The application saves each freelancer's onboarding details, specialized profiles, skills, projects, and UTC activity dates in that user's Supabase Auth user metadata. No additional database tables or SQL setup are required. A dashboard visit records one activity date per day; the dashboard and profile calculate streaks from that saved history.

## 7. Gemini AI bid generation
Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey), then add it to the root `.env.local` file:

    GOOGLE_GEMINI_API_KEY=your-gemini-api-key

Keep this key server-side: do not prefix it with `NEXT_PUBLIC_` or commit `.env.local`. Restart `pnpm dev` after adding it. The bid maker sends the project title, complete description, skills, selected language, and notes to Gemini. The server loads the signed-in user's name and all saved profile descriptions, skills, and portfolio project details from Supabase before making the request.

For Vercel, add `GOOGLE_GEMINI_API_KEY` under **Project → Settings → Environment Variables**, enable it for the deployments you use, and redeploy. The name must match exactly. In Google AI Studio, make sure the key is active and restricted to the Gemini API; unrestricted standard keys may be rejected. Keys created in AI Studio after May 28, 2026 are authorization keys by default. Avoid browser/referrer restrictions for this server-to-server request. The bid maker displays Google's specific error and a suggested next step if Gemini rejects the request.
