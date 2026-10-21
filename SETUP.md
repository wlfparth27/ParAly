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
2. In PowerShell, clone the feature branch and enter the folder:
   ```powershell
   git clone --branch feat/notebook-first-pass https://github.com/wlfparth27/ParAly.git
   cd ParAly
   Copy-Item .env.example .env.local
   npm install
   ```
   If you already cloned the repo, use `git fetch` and `git switch feat/notebook-first-pass` instead of cloning it again.
3. The example environment file includes the public project ID and Realtime Database URL used by the local Admin bootstrap script.
4. Open `.env.local` in a text editor and set the server-side invitation list:
   ```dotenv
   PARALY_MEMBER_EMAILS=your-google-email,partner-google-email
   GOOGLE_APPLICATION_CREDENTIALS=
   ```
   Replace the examples with the exact two approved addresses. Leave the key path empty until Step 4. Do not commit `.env.local`. Do not set these addresses under a `VITE_*` variable for the deployed site.
5. Start the app with `npm run dev`. Open the localhost URL shown in the terminal and sign in **only with your own Google account**. You do not need your girlfriend to sign in during setup; the surprise recipient is provisioned automatically the first time she opens the deployed site.
6. If the local site reports that membership is not provisioned yet, that is expected until Step 4. Stop the server with `Ctrl+C`.

## 4. Provision the two members

The Admin SDK bootstrap script runs locally. The service-account JSON file bypasses client Security Rules; never upload it to GitHub, never put it in a `VITE_*` variable, and never send it through chat.

1. In Firebase console → Project settings → Service accounts, click **Generate new private key**. Save the downloaded JSON outside the repository, for example `C:\\Users\\YOUR-WINDOWS-USER\\Documents\\paraly-admin-key.json`.
2. In `.env.local`, set `GOOGLE_APPLICATION_CREDENTIALS` to that complete file path. Do not upload or paste this file anywhere.
3. From the repository folder, run `npm run seed:members`. It provisions whichever invited accounts have already signed in and skips accounts not created yet. **Only your own account needs to exist now.** The surprise recipient can remain signed out until you are ready.
4. Deploy the repository's rules using the Firebase CLI:
   ```powershell
   npx firebase-tools login
   npx firebase-tools deploy --project paraly-2bfb7 --only firestore:rules,database
   ```
   Sign in to the CLI with a Google account that has permission to administer this Firebase project, then confirm the target is `paraly-2bfb7` before deploying.
5. For deployed hosting, open the Vercel project settings and add these server-side variables for **Production, Preview, and Development**:
   - `PARALY_MEMBER_EMAILS`: the two allowed addresses separated by a comma.
   - `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: the service-account JSON encoded as Base64.
   - `FIREBASE_DATABASE_URL`: `https://paraly-2bfb7-default-rtdb.asia-southeast1.firebasedatabase.app`.
   
   To encode the service-account key locally in PowerShell, run the following with your actual file path (the output is secret; paste it only into Vercel's environment-variable form):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\\path\\to\\paraly-admin-key.json"))
   ```
   Do not set `PARALY_MEMBER_EMAILS` or the service-account credential as `VITE_*` variables. Redeploy after saving the variables. The protected `/api/auth/provision` endpoint then checks the server-side allowlist and provisions either approved account the first time that person signs in.
6. Reload the local app after seeding to test with your own account. Do not ask the surprise recipient to sign in before the reveal.

Keep the service-account key only for local provisioning. After member setup succeeds, remove the `GOOGLE_APPLICATION_CREDENTIALS` line from `.env.local` and revoke/delete that service-account key in Google Cloud IAM if you no longer need it. Never send the key to the assistant or commit it to GitHub.

## 5. What currently works and what is still being built

The notebook UI, rich-text editing, local draft storage, Firestore page metadata/history code, a Yjs/Firestore collaborative text provider, and Realtime Database presence code are in the feature branch. The CI production build passed for the current code revision.

The app still needs end-to-end runtime verification against the Firebase project. An approved account is now provisioned by the protected server endpoint during its first deployed sign-in, so the surprise recipient does not need to test early. Photo bytes are deliberately not saved as base64 in Firestore; Google Drive upload and private image retrieval are the next storage implementation step. Collaboration must be verified before relying on it for important writing.

## Security reminders

- The front-end email allowlist improves the sign-in experience but is not the actual security barrier.
- Firestore and Realtime Database rules use server-seeded member records to restrict access.
- Never commit `.env.local`, service-account JSON, Drive refresh tokens, or OAuth client secrets.
- Do not enable paid billing to make a free-tier limit disappear. Stop and discuss options if any quota is exhausted.


## 6. Enable secure photo uploads to the existing Google One Drive

Photo uploads use the existing Google Drive quota, not Firebase Storage or a third-party paid image host. ParAly creates a resumable Drive session through its private API, then relays the file to Drive in small authenticated chunks through Vercel. This avoids browser CORS failures from directly uploading to Google's session URL while keeping each function request below the request-body limit. Small previews are used inside the journal. The original stays in your Drive. There is no additional storage subscription, but it consumes your current shared Google One quota.

### Authorise the storage-owning Google account

1. In the same Google Cloud project, enable **Google Drive API**. You can use the existing `paraly-2bfb7` project.
2. Open Google Auth Platform (OAuth consent / audience settings). For personal Gmail accounts, use an External audience and add only the storage-owning Gmail account (your account) as a test user while developing. You do not need your girlfriend to test or authorise anything.
3. Add the `https://www.googleapis.com/auth/drive.file` scope. This is the narrow file-level scope; do not request full Drive access.
4. Create an OAuth client of type **Web application**. Add the exact authorised redirect URI `http://localhost:53682/oauth2callback`.
5. Copy its Client ID and Client Secret into `.env.local` as `GOOGLE_DRIVE_OAUTH_CLIENT_ID` and `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`.
6. Run `npm run drive:token`. Open the URL shown in the terminal, sign in as the Google account that owns the 5 TB Google One plan, and approve the Drive file access. The script prints a refresh token in the terminal; copy it directly into `GOOGLE_DRIVE_REFRESH_TOKEN` in your private `.env.local`. Never send it in chat or commit it.
7. A Google OAuth app left in **Testing** issues refresh tokens that expire after seven days for Drive scopes. For long-term use, change the app's publishing status to **In production**. Because this journal is for two known users and requests only the narrow `drive.file` scope, keep access private and review any warning/verification screen Google presents. If you keep it in Testing, expect to repeat authorisation when the token expires.

### Create the ParAly Drive folder

1. Set `PARALY_PARTNER_EMAIL` to your girlfriend's Google account address in `.env.local`.
2. Run `npm run drive:folder`. It creates or reuses a dedicated folder named `ParAly Journal Photos` and prints `GOOGLE_DRIVE_FOLDER_ID`. To preserve the surprise, the script does **not** share the folder with your girlfriend by default. When you are ready for the reveal, you can optionally set `PARALY_SHARE_FOLDER_WITH_PARTNER=true` and `PARALY_PARTNER_EMAIL` before rerunning it, or share the folder manually. Photo previews inside the journal are served by the private API and do not require her to sign into Drive during setup.
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
- Do not set `PARALY_SHARE_FOLDER_WITH_PARTNER=true` until you are ready to share the Drive folder after the surprise reveal.

If local server routes are needed, link the checkout to your Vercel project and use `npx vercel dev`; plain `npm run dev` starts Vite only and does not execute the API routes.

For cost safety, no paid Drive or photo-storage provider is configured. The browser sends 512 KiB chunks to an authenticated API route, which forwards them to the Google Drive resumable-upload session. This prevents browser CORS issues and keeps requests small; larger photos require more function invocations, so keep photo sizes reasonable. Previews are capped and served through a private route. Originals remain in the owner's Drive folder and count against that account's remaining Google One quota.


## Existing Firebase project values

The Firebase Web app has already been configured in `src/firebase.js`:

- Project ID: `paraly-2bfb7`
- Auth domain: `paraly-2bfb7.firebaseapp.com`
- Web app ID: `1:260846591273:web:cacc84500dc4e0eaf12b38`

The Realtime Database URL is now configured in the app. The Google sign-in provider and Firestore database still need to be enabled/created, the two accounts must sign in once, and the local member-provisioning script must be run before the shared journal opens.
