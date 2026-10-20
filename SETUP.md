# ParAly setup checklist

This first cloud milestone uses Firebase Authentication, Cloud Firestore, and Firebase Realtime Database. It does not need a paid plan for the intended small journal, as long as usage stays inside each product's free quotas. Do not enable billing to bypass a quota without an explicit decision.

## 1. Create the Firebase project

1. Open the Firebase console and create a new project named `ParAly` (or use a project you already own).
2. Do not enable Analytics unless you specifically want it.
3. Add a Web app in Project settings and copy its Firebase configuration.
4. Under Build → Authentication → Sign-in method, enable Google.
5. In Authentication → Settings → Authorized domains, confirm `localhost` is present for local work. Add the deployed domain when you deploy.

## 2. Create the databases

1. Under Build → Firestore Database, create a database. Choose a location close to you and your girlfriend; the location is not easy to change later.
2. Keep in mind the journal will be private; never select test mode for the final database.
3. Under Build → Realtime Database, create a database and copy its URL.
4. Leave Storage for a later step: ParAly is planned to store original photos in the existing Google Drive / Google One allowance rather than introducing a Firebase Storage billing requirement.

## 3. Configure the local app

1. Clone this repository and check out the `feat/notebook-first-pass` branch, or download that branch from GitHub.
2. Copy `.env.example` to `.env.local`.
3. Fill these values from the Firebase Web app settings:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET` (may be present even though Storage is not used)
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_DATABASE_URL` (from the Realtime Database page)
4. Set `VITE_ALLOWED_EMAILS` and `PARALY_MEMBER_EMAILS` to exactly your Google email and your girlfriend's Google email, separated by a comma. Example format only: `first@example.com,second@example.com`.
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
