# ParAly

A private, shared journal for Parth and A.

## Current build

- Dusty-blue leather cover with silver spiral and P & A monogram.
- Cover-opening animation and responsive journal pages.
- Rich text formatting, typefaces, text colour, highlighting, lists, alignment, collaborative undo/redo.
- Movable sticky notes and photographs with captions.
- Contents, gallery, timeline, bookmarks, and page version snapshots.
- Firebase Google sign-in scaffold with a two-address invitation gate.
- Firestore-backed page metadata and version history.
- Yjs-backed rich-text collaboration persisted through Firestore.
- Realtime Database presence for the other journal member.
- Local browser backup for journal state.

## Zero-additional-spend goal

Do not introduce paid vendors, paid collaboration plans, or infrastructure that requires a paid plan simply to work. Firebase products must remain within their no-cost quotas. The existing Google One 5 TB allowance is the planned photo store through the Google Drive API. Secure upload-session and thumbnail-proxy routes are implemented, but they need Google Drive OAuth configuration and an end-to-end test before photo sharing is considered ready. We won't use Cloudflare R2, Firebase Storage, or Liveblocks for this zero-new-spend version.

Google One storage is shared across the Google account's Drive, Gmail, and Google Photos, so the actual remaining photo capacity is the subscription's remaining quota—not a dedicated 5 TB just for ParAly. Google Drive API rate limits also apply. We must never describe storage as unlimited.

Firestore currently has a no-cost quota of 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day, and 10 GiB outbound transfer/month for one eligible database. Yjs editing uses Firestore reads/writes, so use sensible sync delays and avoid attaching multiple unnecessary listeners. Do not enable billing to solve a quota issue without the user's explicit approval.

## Local setup

For the full Firebase console walkthrough, see [SETUP.md](./SETUP.md).

1. Install a current Node.js LTS release.
2. Create a Firebase project and register a Web app.
3. In Firebase Authentication, enable Google sign-in and add both local/deployed domains under Authorized domains.
4. Create one Cloud Firestore database. Choose the location carefully; database location cannot simply be changed later.
5. Create Firebase Realtime Database and copy its URL.
6. Copy `.env.example` to `.env.local`. Put the Firebase Web app config into the `VITE_FIREBASE_*` values.
7. Set `VITE_ALLOWED_EMAILS` to exactly the two Google account email addresses, separated by a comma. Set `PARALY_MEMBER_EMAILS` to the same two addresses.
8. Run `npm install`, then `npm run dev` for the frontend preview. For the full-stack Drive API routes, link the checkout to Vercel and run `npx vercel dev` as described in [SETUP.md](./SETUP.md).
9. Both people must sign in once through Google so Firebase Authentication creates their user records. Until membership is provisioned, the app intentionally won't show the cloud journal.
10. Download a Firebase service-account key for local setup only. Set `GOOGLE_APPLICATION_CREDENTIALS` to its file path in `.env.local`. Never commit that key.
11. Run `npm run seed:members`. This uses the Admin SDK locally to create the two membership records in Firestore and Realtime Database. The script refuses to run unless it has exactly two email addresses.
12. Deploy rules using `npx firebase-tools deploy --only firestore:rules,database`, then reload the app.

The service-account key bypasses Firebase client rules; keep it private, do not put it in a Vite `VITE_*` variable, and revoke it when it is no longer needed.

## Current architecture

- **Firebase Authentication:** Google sign-in for the two invited accounts.
- **Cloud Firestore:** page metadata, sticky-note metadata, durable version snapshots, and Yjs update history.
- **Firebase Realtime Database:** online presence and disconnect cleanup.
- **Yjs + Tiptap Collaboration + a Firestore provider:** concurrent text editing with conflict-free merging.
- **Google Drive API:** original photos and compressed previews stored against the existing Google One / Drive quota. The API routes require server-only OAuth secrets.
- **Vercel:** frontend hosting.

The Drive photo-upload flow is scaffolded. It initiates a resumable Drive session through the private server API, uploads originals directly from the browser to Drive, uploads a compressed preview, then stores only the Drive file IDs and non-binary metadata in Firestore. The image proxy verifies journal membership before serving private preview bytes. This still needs real-project and CORS/runtime testing. Do not store base64 image data in Firestore documents.

## Security notes

- `VITE_ALLOWED_EMAILS` is only a front-end invitation gate. It is not the security boundary.
- `firestore.rules` allows access only for UIDs seeded into `journals/paraly/members`; clients cannot add themselves.
- `database.rules.json` restricts presence to seeded member UIDs.
- The Admin SDK seed script runs locally and should never be exposed as a public endpoint.
- Google Drive uses the narrow `drive.file` OAuth scope. Keep the OAuth refresh token and client secret in server environment variables only; never add a `VITE_*` prefix to them.
- Run `npm run drive:token` and `npm run drive:folder` only after setting up the OAuth client; see [SETUP.md](./SETUP.md).

## Current limitations

This branch is still a work in progress. Actual cloud behaviour needs a configured Firebase project, deployed rules, and seeded memberships. The GitHub Actions build and server-script syntax check should pass before merging. Photo upload routes have not yet been tested against an actual Google Drive OAuth setup. We still need to test Yjs initialisation, simultaneous editing, reconnects, version restores, Drive upload CORS, membership enforcement, and free-tier read/write usage against real test accounts.
