# Outbound

Family PTO, trip, and expense tracker. One shared login, cloud-synced across
every device, deployable to Netlify — and wrappable into a real iOS/Android
app via Capacitor.

## 1. Supabase setup

1. [supabase.com](https://supabase.com) → New project.
2. **SQL Editor** → paste all of `supabase-schema.sql` → Run.
   - This also enables real-time sync and a self-service "delete my account"
     function. If the `alter publication supabase_realtime add table waypoint_data;`
     line errors because it's already been added, that's fine — it just means
     it's already on. You can also toggle it manually under
     **Database → Replication**.
3. **Settings → API** → copy the **Project URL** and **anon / publishable key**.
4. **Authentication → Providers → Email** → turn off "Confirm email" if you
   want to log in immediately after creating the account.

## 2. Run locally

```bash
npm install
cp .env.example .env
# paste your Supabase URL + anon key into .env
npm run dev
```

## 3. Deploy to Netlify

1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. **Site configuration → Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Visit the site, create the shared family account once.

## Before you submit to the App Store — a few things to fill in

- **`public/privacy.html`** and **`public/support.html`** are real pages
  that'll be live at `https://yoursite.netlify.app/privacy.html` and
  `/support.html` — both required by Apple. Fill in the `[FILL IN ...]`
  placeholders (a contact email, at minimum) before submitting.
- Update `capacitor.config.json`'s `appId` to your own reverse-DNS style ID
  (e.g. `com.yourlastname.waypointledger`) before running `cap add`.
- You'll need an app icon and splash screen — Capacitor has an
  `@capacitor/assets` tool that generates every required size from one
  source image.

## Wrapping it as a native app (Capacitor)

This turns the existing web app into a real installable iOS/Android app —
no rewrite needed. You'll need a Mac with Xcode for the iOS build.

```bash
npm install
npm run build
npx cap add ios        # first time only
npx cap add android     # first time only (if you also want Android)
npm run cap:sync        # rebuilds the web app and copies it into both native projects
npx cap open ios        # opens the project in Xcode
```

From Xcode: set your Apple Developer team under Signing & Capabilities,
set the app icon and splash screen, then Product → Archive to submit to
App Store Connect. Whenever you change the app, re-run `npm run cap:sync`
before reopening Xcode so it picks up the latest build.

## How data & sync work

- All family data lives in one row per shared login in the `waypoint_data`
  table, protected by row-level security so only that login can read or
  write it.
- **Real-time sync**: if two devices are open at once, changes on one push
  to the other live, instead of only appearing after a manual reload.
- **Conflict-safe saves**: every save checks that no one else wrote to the
  data in between. If someone else's change lands first, your device
  reloads the latest data and shows a banner asking you to redo your last
  edit — rather than silently overwriting their change (or having yours
  silently overwritten).
- **Save failures are visible**: if a save can't reach the server, you'll
  see a "couldn't save" banner with a retry button rather than the app
  quietly assuming it worked.

## Account & data deletion

Anyone signed in can permanently delete the shared account and all of its
data from the "Delete account & all data" link in the app header. This
runs a Postgres function (`delete_user_account`, defined in the schema)
that removes the data row and the login itself — no server-side secret
key required.

## Changing the shared password

Use the "Forgot the password?" link on the sign-in screen, or reset it
manually via Supabase dashboard → Authentication → Users.
