# ParAly setup checklist

This first cloud milestone uses Firebase Authentication, Cloud Firestore, and Firebase Realtime Database. It does not need a paid plan for the intended small journal, as long as usage stays inside each product's free quotas. Do not enable billing to bypass a quota without an explicit decision.

## 1. Create the Firebase project

1. Use the existing Firebase project `paraly-2bfb7`.
2. Its Web app configuration has been added to `src/firebase.js` from the values you shared. Firebase's web API key is public app configuration; the actual access controls are Firebase Authentication and database Security Rules.
3. Under Build → Authentication → Sign-in method, enable Google and select a support email.
4. In Authentication → Settings → Authorized domains, confirm `localhost` is present for local work. Add the Vercel domain once the project is deployed.

## 2. Create the databases

1. Under Build → Firestore Database, create a database if the Firestore tab does not already show one. Choose a location close to you and your girlfriend; the location cannot simply be changed later. Production mode is fine because we will deploy the member-only rules from this repo.
2. The existing Realtime Database is at `https://paraly-2bfb7-default-rtdb.asia-southeast1.firebasedatabase.app`. This URL is now configured as the app's default. You can override it with `VITE_FIREBASE_DATABASE_URL` for another environment.
3. Leave Firebase Storage for a later step: ParAly is planned to store original photos in the existing Google Drive / Google One allowance rather than introducing a Firebase Storage billing requirement.

## 3. Configure the local app

1. Clone this repository and check out the `feat/notebook-first-pass` branch, or download that branch from GitHub.
2. Copy `.env.example` to `.env.local`.
3. The web app configuration and Realtime Database URL are already set in `src/firebase.js`; no duplicate values are needed for local development.
4. Set `PARALY_MEMBER_EMAILS` to exactly the two invited Google email addresses, separated by a comma. You provided these values in the setup conversation; keep them in your local `.env.local`, not in source code. `VITE_ALLOWED_EMAILS` is optional and only an extra client-side gate, not a security boundary.
5. Run `npm install`, then `npm run dev`.
6. Sign into ParAly once with each invited Google account. The project needs Firebase Auth users to exist before member provisioning.

## 4. Provision the two members

The Admin SDK bootstrap script runs locally. The service-account JSON file bypasses client Security Rules; never upload it to GitHub, never put it in a `VITE_*` variable, and never send it through chat.

1. In Firebase console → Project settings → Service accounts, create a private service-account key for local setup.
2. Save it outside the repository, for example in a folder under your user profile.
3. Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env.local` to the full path to that JSON file.
4. Run `npm run seed:members`. The script checks that exactly two invited accounts exist, then records their Firebase UIDs as journal members.
5. Deploy the database rules from the repository:
   `npx firebase-tools deploy --only firestore:rules,database`
6. Reload ParAly. If access is denied, check the project ID, database URL, deployed rules, and that both accounts were seeded.

Keep the service-account key only for local provisioning. Once setup is complete, remove the `GOOGLE_APPLICATION_CREDENTIALS` line from the local environment if you no longer need the seeding script, and consider deleting/revoking the key from Google Cloud IAM.

## 5. What currently works and what is still being built

The notebook UI, rich-text editing, local draft storage, Firestore page metadata/history code, a Yjs/Firestore collaborative text provider, and Realtime Database presence code are in the feature branch. The CI production build passed for the current code revision.

A real Firebase project has not been connected to this repository, so runtime behaviour has not yet been verified. Photo bytes are deliberately not saved as base64 in Firestore; Google Drive upload and private image retrieval are the next storage implementation step. Collaboration must be tested with both accounts before relying on it for important writing.

## Security reminders

- The front-end email allowlist improves the sign-in experience but is not the actual security barrier.
- Firestore and Realtime Database rules use server-seeded member records to restrict access.
- Never commit `.env.local`, service-account JSON, Drive refresh tokens, or OAuth client secrets.
- Do not enable paid billing to make a free-tier limit disappear. Stop and discuss options if any quota is exhausted.


## 6. Enable secure photo uploads to the existing Google One Drive

Photo uploads use the existing Google Drive quota, not Firebase Storage or a third-party paid image host. Original photos are uploaded directly to a resumable Drive session; small previews are used inside the journal. The original stays in your Drive. There is no additional storage subscription, but it consumes your current shared Google One quota.

### Authorise the storage-owning Google account

1. In the same Google Cloud project, enable **Google Drive API**.
2. Open Google Auth Platform (OAuth consent / audience settings). Use an External audience for a personal Gmail account and add the storage-owning Gmail account as a test user while developing.
3. Add the `https://www.googleapis.com/auth/drive.file` scope. This is the narrow file-level scope; do not request full Drive access.
4. Create an OAuth client of type **Web application**. Add the exact authorised redirect URI `http://localhost:53682/oauth2callback`.
5. Copy its Client ID and Client Secret into `.env.local` as `GOOGLE_DRIVE_OAUTH_CLIENT_ID` and `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`.
6. Run `npm run drive:token`. Open the URL shown in the terminal, sign in as the Google account that owns the 5 TB Google One plan, and approve the Drive file access. The script prints a refresh token in the terminal; copy it directly into `GOOGLE_DRIVE_REFRESH_TOKEN` in your private `.env.local`. Never send it in chat or commit it.
7. A Google OAuth app left in **Testing** issues refresh tokens that expire after seven days for Drive scopes. For long-term use, change the app's publishing status to **In production**. Because this journal is for two known users and requests only the narrow `drive.file` scope, keep access private and review any warning/verification screen Google presents. If you keep it in Testing, expect to repeat authorisation when the token expires.

### Create the ParAly Drive folder

1. Set `PARALY_PARTNER_EMAIL` to your girlfriend's Google account address in `.env.local`.
2. Run `npm run drive:folder`. It creates or reuses a dedicated folder named `ParAly Journal Photos` using the same OAuth client, shares that folder with her as a viewer so the original-photo links can open, and prints `GOOGLE_DRIVE_FOLDER_ID`.
3. Copy the printed folder ID into `.env.local`. Do not paste the full refresh token or client secret anywhere public.

The app stores original and preview file IDs in Firestore, not photo bytes. The secure `/api/drive/image` route verifies the Firebase ID token and seeded member UID before returning an image preview. It rejects Drive files unless they carry ParAly's app metadata and live in the dedicated folder.

### Deploying the private API

The Drive routes live under `api/drive/` and run as Vercel serverless functions. They need the server-side environment variables listed below in Vercel Project Settings → Environment Variables. Set them for Preview and Production as needed:

- All `VITE_FIREBASE_*` settings and `VITE_ALLOWED_EMAILS`.
- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: the Base64 encoding of the Firebase service-account JSON. In Windows PowerShell, generate it with `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\\path\\service-account.json"))`. Keep the JSON key private and outside the repo; never use the base64 value in a `VITE_*` variable.
- `GOOGLE_DRIVE_OAUTH_CLIENT_ID`.
- `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`.
- `GOOGLE_DRIVE_REFRESH_TOKEN`.
- `GOOGLE_DRIVE_FOLDER_ID`.

If local server routes are needed, link the checkout to your Vercel project and use `npx vercel dev`; plain `npm run dev` starts Vite only and does not execute the API routes.

For cost safety, no paid Drive or photo-storage provider is configured. Direct Drive uploads bypass the 4.5 MB Vercel function request limit; previews are capped and proxied as small responses. The originals remain in the owner's Drive folder and count against that account's remaining Google One quota.


## Existing Firebase project values

The Firebase Web app has already been configured in `src/firebase.js`:

- Project ID: `paraly-2bfb7`
- Auth domain: `paraly-2bfb7.firebaseapp.com`
- Web app ID: `1:260846591273:web:cacc84500dc4e0eaf12b38`

The Realtime Database URL is now configured in the app. The Google sign-in provider and Firestore database still need to be enabled/created, the two accounts must sign in once, and the local member-provisioning script must be run before the shared journal opens.
