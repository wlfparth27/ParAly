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

Do not introduce paid vendors, paid collaboration plans, or infrastructure that requires a paid plan simply to work. Firebase products must remain within their no-cost quotas. The existing Google One 5 TB allowance is the planned photo store, through the Google Drive API; upload support is **not connected yet**. We won't use Cloudflare R2, Firebase Storage, or Liveblocks for this zero-new-spend version.

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
8. Run `npm install`, then `npm run dev`.
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
- **Google Drive API:** planned photo files stored against your existing Google One / Drive quota.
- **Vercel:** frontend hosting.

The photo uploader is the next major milestone. It must keep Drive credentials out of the browser, upload files into an application-specific ParAly folder, preserve private permissions, and show storage/quota failures clearly. Until then, photo bytes stay local to the browser; only non-binary photo metadata is written to Firestore. Do not store base64 image data in Firestore documents.

## Security notes

- `VITE_ALLOWED_EMAILS` is only a front-end invitation gate. It is not the security boundary.
- `firestore.rules` allows access only for UIDs seeded into `journals/paraly/members`; clients cannot add themselves.
- `database.rules.json` restricts presence to seeded member UIDs.
- The Admin SDK seed script runs locally and should never be exposed as a public endpoint.
- The Google Drive token flow still needs to be designed before upload is enabled; do not grant the app broad access to a user's entire Drive when a narrower scope can work.

## Current limitations

This branch is still a work in progress. Actual cloud behaviour needs a configured Firebase project, deployed rules, and seeded memberships. The GitHub Actions build should pass before merging. Photos are not yet shared between devices, and we still need to test Yjs initialisation, simultaneous editing, reconnects, version restores, and free-tier read/write usage against a real test project.
