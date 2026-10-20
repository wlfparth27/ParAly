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
- **Cloud Storage for Firebase:** original photos and thumbnails.
- **Firebase Realtime Database:** online presence and the transport/storage layer for collaborative updates where appropriate.
- **React + Tiptap + a Yjs-based collaboration layer:** concurrent editing without silently replacing the other person's changes.
- **Vercel:** frontend hosting.

The implementation will not use Liveblocks file storage for photographs. Photos belong in Cloud Storage for Firebase. We will only add a separate collaboration vendor if it proves materially better after comparing reliability, limits, and costs.

## Security and storage notes

The current Google sign-in allowlist is a front-end gate for the setup milestone, not a security boundary for cloud data. Before any private journal data is written to Firebase, Firestore, Realtime Database, and Storage Security Rules must independently enforce that only the two approved members can read or change it. Do not deploy cloud storage with open rules.

Google One storage is for a personal Google Account's Drive, Gmail, and Google Photos quota. It does not increase a Firebase project's Cloud Storage, Firestore, or Realtime Database quota. Firebase usage is managed and billed separately through the Firebase / Google Cloud project.

Firebase's Cloud Storage setup may require the project to be on the Blaze pay-as-you-go plan even though no-cost usage quotas can still apply. We'll configure budget alerts and review projected usage before enabling billing; a Google One subscription is not a substitute for a Firebase billing account.

## Current limitations

This is still a frontend preview. Without Firebase environment values the site opens in local-preview mode, saving drafts to the current browser. With Firebase Auth configured, the Google sign-in screen is enabled, but the journal content, photos, real-time collaboration, member-enforced security rules, and cloud version history are not yet connected. These will be implemented as separate, testable milestones.
