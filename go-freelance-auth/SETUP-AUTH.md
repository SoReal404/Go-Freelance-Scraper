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
