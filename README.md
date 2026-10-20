# ParAly

A private, shared journal for Parth and A.

## Current milestone

The first playable frontend establishes the notebook experience:

- Dusty-blue leather cover with a silver spiral and P & A monogram.
- Cover-opening animation and two-page desktop spread.
- Responsive page navigation for mobile and tablet.
- Rich text editing, typeface and size selection, text colour, highlighting, lists, alignment, undo, and redo.
- Movable sticky notes and photographs with captions.
- Contents, gallery, timeline, bookmarks, and preliminary browser-local version snapshots.
- Automatic local-draft saving.
- Firebase client configuration and an invitation-gated Google sign-in screen.

## Run locally

1. Install a current Node.js LTS release.
2. Copy `.env.example` to `.env.local`.
3. Create a Firebase project and register a Web app in the Firebase console.
4. Enable Google in Authentication > Sign-in method, and add your local host to Authentication > Settings > Authorized domains if required.
5. Fill in the `VITE_FIREBASE_*` values from the Firebase Web app config.
6. Replace the sample `VITE_ALLOWED_EMAILS` values with the two real Google account email addresses.
7. Run `npm install`, then `npm run dev`.

## Architecture direction

- **Firebase Authentication:** Google sign-in for the two invited accounts.
- **Cloud Firestore:** journal structure, metadata, sealed-letter state, and durable version snapshots.
- **Google Drive API:** journal photo files, stored against the existing Google account's Google One / Drive quota.
- **Firebase Realtime Database:** online presence and collaboration coordination where appropriate.
- **React + Tiptap + a Yjs-based collaboration layer:** concurrent editing without silently replacing the other person's changes.
- **Vercel:** frontend hosting and a small server-side API to access Drive securely.

The implementation will not use Liveblocks file storage, Cloudflare R2, or Firebase Storage for journal photos in the zero-new-spend version. Cloud Storage for Firebase requires a Blaze billing account for new buckets and continued access, and R2 requires a billing profile/payment method even though it has a limited free tier. Instead, we plan to store compressed journal photos in a dedicated folder in the existing Google Drive account that has the Google One subscription. A server-side API must authenticate the journal member, access Drive using a securely stored owner OAuth credential, and never expose that credential to the browser. Photo storage is still limited by the remaining Google One quota, and Drive API usage limits still apply. We should not promise unlimited storage.

## Security and storage notes

The current Google sign-in allowlist is a front-end gate for the setup milestone, not a security boundary for cloud data. Before any private journal data is written to Firebase, Firestore, Realtime Database, and Storage Security Rules must independently enforce that only the two approved members can read or change it. Do not deploy cloud storage with open rules.

Google One storage is shared across the subscriber's Google Drive, Gmail, and Google Photos. For this no-new-spend plan, journal photos will use the Drive space already included in the existing subscription. This is a finite quota, not unlimited storage; the app should show available/used capacity where practical and stop uploads safely before it runs out. Compress uploads and create thumbnails to use the quota efficiently.

Do not provision Firebase Storage or Cloudflare R2 for the zero-spend milestone: Firebase Storage requires a Blaze billing account, and Cloudflare requires a payment method for an R2 subscription. We will avoid those services unless Parth explicitly chooses a spending-enabled plan later.

## Current limitations

This is still a frontend preview. Without Firebase environment values the site opens in local-preview mode, saving drafts to the current browser. With Firebase Auth configured, the Google sign-in screen is enabled, but journal content, Drive photo storage, real-time collaboration, member-enforced security rules, and cloud version history are not yet connected. Drive storage requires a separate owner-account OAuth connection in the backend; the Firebase Google sign-in token alone must not be treated as Drive access. These will be implemented as separate, testable milestones.
