# ParAly

A private, shared journal for P and A.

## Current milestone

The first playable frontend lays the foundations for the journal experience:

- Dusty-blue leather notebook cover with a silver spiral and P & A monogram.
- A cover-opening animation and a two-page desktop spread.
- Responsive, single-page navigation on narrower screens.
- Rich text editing, typeface and size selection, text colours, highlighting, lists, alignment, undo, and redo.
- Movable sticky notes and photographs with captions.
- Contents, photo gallery, timeline, bookmarks, and local version snapshots.
- Automatic local-draft saving.

## Run locally

1. Install a current Node.js LTS release.
2. Run npm install.
3. Run npm run dev and open the local URL shown by Vite.

## Important scope note

This milestone is a local frontend preview. Drafts and version snapshots are stored in the current browser only. The shared Firebase authentication, cloud photo storage, cross-device sync, simultaneous editing/presence, secure two-person access, and durable cloud version history are not connected yet. Those need Firebase project configuration and security rules before this can be treated as a private shared journal.

The next milestone will connect Firebase and choose a reliable collaboration layer for concurrent editing rather than relying on last-write-wins page saves.
