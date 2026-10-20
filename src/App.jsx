import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { FirestoreYjsProvider } from './journal/firestoreYjsProvider.js';
import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, setDoc } from 'firebase/firestore';
import { onDisconnect, onValue, ref, remove, set } from 'firebase/database';
import { firebaseApp, firebaseDb, firebaseRealtimeDb } from './firebase.js';
import { hydratePageFromCloud, serializePageForCloud, serializeVersionForCloud, stableJson } from './journal/cloudModel.js';
import { uploadJournalPhoto, fetchDrivePreview } from './drive/driveClient.js';
import { useAuth } from './auth/AuthProvider.jsx';

const PAGE_STORAGE_KEY = 'paraly-pages-v1';
const HISTORY_STORAGE_KEY = 'paraly-history-v1';

const INTRO_LEFT = '<p>PAGE 001 · BEGINNINGS</p><h2>For everything we want to keep.</h2><p>A little corner of the world that belongs to us. A place for letters, photographs, tiny reminders, and ordinary days that turn out to mean everything.</p><p><em>Start anywhere. This book is ours.</em></p>';
const INTRO_RIGHT = '<p>A NOTE FOR YOU</p><h2>Dear you,</h2><p>There is no perfect way to begin a journal, so we do not have to try. We can leave words, photographs, half-finished thoughts, and little notes for each other to find later.</p><p>Whenever you are ready, make this page yours.</p><p><em>P. &amp; A.</em></p>';

function makeStarterPages() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    title: index === 0 ? 'Beginnings' : index === 1 ? 'A note for you' : 'Untitled page',
    content: index === 0 ? INTRO_LEFT : index === 1 ? INTRO_RIGHT : '<p></p>',
    objects: [],
    bookmarked: false,
    updatedAt: Date.now(),
  }));
}

function loadPages() {
  try {
    const stored = localStorage.getItem(PAGE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    // A damaged local draft should never prevent the notebook from opening.
  }
  return makeStarterPages();
}

function loadHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

const EDITOR_EXTENSIONS = [
  StarterKit,
  TextStyleKit,
  Underline,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

function ToolButton({ label, title, onClick, active = false, disabled = false }) {
  return (
    <button
      className={'tool-button' + (active ? ' is-active' : '')}
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function DrivePhotoImage({ object, alt, className = '' }) {
  const [src, setSrc] = useState(() => object.src?.startsWith('data:') ? object.src : '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl = '';

    if (object.src?.startsWith('data:')) {
      setSrc(object.src);
      setFailed(false);
      return () => { cancelled = true; };
    }

    setSrc('');
    setFailed(false);
    if (!object.drivePreviewFileId) {
      return () => { cancelled = true; };
    }

    fetchDrivePreview(object.drivePreviewFileId)
      .then((blob) => {
        createdUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(createdUrl);
          return;
        }
        setSrc(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [object.src, object.drivePreviewFileId]);

  if (!src) {
    const message = failed
      ? 'PHOTO UNAVAILABLE'
      : object.drivePreviewFileId
        ? 'LOADING PHOTOGRAPH…'
        : 'LOCAL PHOTO · THIS DEVICE ONLY';
    return <div className={'photo-placeholder ' + className}>{message}</div>;
  }

  return <img className={className} src={src} alt={alt || object.caption || 'A photograph in the journal'} draggable="false" />;
}

function PageObjects({ page, onObjectChange, pageRef }) {
  const dragRef = useRef(null);

  const beginDrag = (event, object) => {
    if (event.target.closest('textarea, input, button, a, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = pageRef.current?.getBoundingClientRect();
    if (!bounds) return;

    dragRef.current = {
      id: object.id,
      startX: event.clientX,
      startY: event.clientY,
      left: object.left,
      top: object.top,
      width: bounds.width,
      height: bounds.height,
    };

    const move = (moveEvent) => {
      if (!dragRef.current) return;
      const drag = dragRef.current;
      const left = Math.min(82, Math.max(2, drag.left + ((moveEvent.clientX - drag.startX) / drag.width) * 100));
      const top = Math.min(82, Math.max(2, drag.top + ((moveEvent.clientY - drag.startY) / drag.height) * 100));
      onObjectChange(page.id, drag.id, { left, top });
    };
    const end = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  return (
    <div className="page-objects" aria-label="Page decorations">
      {page.objects.map((object) => {
        if (object.type === 'note') {
          return (
            <div
              key={object.id}
              className="sticky-note"
              style={{
                left: object.left + '%',
                top: object.top + '%',
                backgroundColor: object.color,
                transform: 'rotate(' + (object.rotation || 0) + 'deg)',
              }}
            >
              <div className="sticky-note-grip" onPointerDown={(event) => beginDrag(event, object)}>
                <span>STICKY NOTE</span><span aria-hidden="true">⠿</span>
              </div>
              <textarea
                aria-label="Sticky note text"
                value={object.text}
                placeholder="Leave a little note…"
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => onObjectChange(page.id, object.id, { text: event.target.value })}
              />
            </div>
          );
        }
        if (object.type === 'photo') {
          return (
            <div
              key={object.id}
              className={'photo-object' + (object.frame === 'plain' ? ' photo-object--plain' : '')}
              style={{
                left: object.left + '%',
                top: object.top + '%',
                transform: 'rotate(' + (object.rotation || 0) + 'deg)',
              }}
              onPointerDown={(event) => beginDrag(event, object)}
              title="Drag to move photograph"
            >
              <DrivePhotoImage object={object} alt={object.caption || 'A photograph in the journal'} />
              {object.driveWebViewLink && (
                <a
                  className="photo-open-original"
                  href={object.driveWebViewLink}
                  target="_blank"
                  rel="noreferrer"
                  onPointerDown={(event) => event.stopPropagation()}
                  title="Open the original photograph in Google Drive"
                >
                  ORIGINAL ↗
                </a>
              )}
              {object.frame !== 'plain' && (
                <div
                  className="photo-caption"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(event) => onObjectChange(page.id, object.id, { caption: event.currentTarget.textContent || '' })}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {object.caption || 'add a caption'}
                </div>
              )}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function JournalPage({
  page,
  pageNumber,
  active,
  refreshKey,
  cloudEnabled,
  user,
  pendingRestore,
  onRestoreApplied,
  onContentChange,
  onObjectChange,
  onEditorFocus,
}) {
  const pageRef = useRef(null);
  const seededRef = useRef(false);
  const appliedRestoreNonceRef = useRef(null);
  const [collaborationSession, setCollaborationSession] = useState(null);
  const [collaborationAttempt, setCollaborationAttempt] = useState(0);
  const [collaborationState, setCollaborationState] = useState(cloudEnabled ? 'connecting' : 'local');
  const [collaborationError, setCollaborationError] = useState('');

  useEffect(() => {
    if (!cloudEnabled || !user?.uid || !firebaseApp || !firebaseDb) {
      setCollaborationSession(null);
      setCollaborationState('local');
      setCollaborationError('');
      return undefined;
    }

    let cancelled = false;
    let retryTimer = null;
    seededRef.current = false;
    setCollaborationSession(null);
    setCollaborationState('connecting');
    setCollaborationError('');

    const ydoc = new Y.Doc();
    const provider = new FirestoreYjsProvider(
      firebaseDb,
      ydoc,
      ['journals', 'paraly', 'pages', String(page.id)],
      {
        onSynced: () => {
          if (!cancelled) {
            if (retryTimer) window.clearTimeout(retryTimer);
            setCollaborationState('ready');
            setCollaborationError('');
          }
        },
        onError: (error) => {
          if (!cancelled) {
            if (retryTimer) window.clearTimeout(retryTimer);
            setCollaborationState('error');
            setCollaborationError(error?.code === 'permission-denied'
              ? 'Firebase denied access to this page’s shared text. Check the deployed Firestore rules.'
              : 'The shared text connection failed. If you use Brave Shields or an ad blocker, allow Firebase for this site and reload.');
          }
        },
      },
    );

    const pageRef = doc(firebaseDb, 'journals', 'paraly', 'pages', String(page.id));
    const stateRef = doc(firebaseDb, 'journals', 'paraly', 'pages', String(page.id), 'yjs', 'state');
    runTransaction(firebaseDb, async (transaction) => {
      // A previous attempt may have marked the page initialised before it
      // crashed, leaving no Yjs state. The actual state document is the source
      // of truth: if it is missing, safely claim a lease and seed the page text.
      const snapshot = await transaction.get(pageRef);
      if (!snapshot.exists()) throw new Error('The page no longer exists in the shared journal.');
      const stateSnapshot = await transaction.get(stateRef);
      if (stateSnapshot.exists()) return { shouldSeed: false, waitingForSeed: false };

      const pageData = snapshot.data();
      const now = Date.now();
      const lockExpiry = Number(pageData.collaborationSeedLockExpiresAt) || 0;
      if (lockExpiry > now) {
        return { shouldSeed: false, waitingForSeed: true, waitForMs: lockExpiry - now + 500 };
      }

      const seedNonce = user.uid + '-' + now + '-' + Math.random().toString(36).slice(2, 10);
      transaction.update(pageRef, {
        collaborationInitialized: true,
        collaborationInitializedBy: user.uid,
        collaborationInitializedAt: Number(pageData.collaborationInitializedAt) || now,
        collaborationSeedLockOwner: user.uid,
        collaborationSeedLockNonce: seedNonce,
        collaborationSeedLockExpiresAt: now + 30000,
      });
      return { shouldSeed: true, waitingForSeed: false, seedNonce };
    }).then((result) => {
      if (cancelled) return;
      if (result.waitingForSeed) {
        // Another session may have crashed after taking the seed lease. Retry
        // automatically as soon as that lease expires instead of getting stuck
        // forever behind an abandoned lock.
        retryTimer = window.setTimeout(() => {
          if (!cancelled) setCollaborationAttempt((attempt) => attempt + 1);
        }, Math.max(1000, result.waitForMs || 1000));
      }

      const seedThisPage = result.shouldSeed && ydoc.getXmlFragment('default').length === 0;
      setCollaborationSession({ doc: ydoc, provider, shouldSeed: seedThisPage, seedNonce: result.seedNonce || null });
      if (seedThisPage) setCollaborationState('seeding');
      else if (ydoc.getXmlFragment('default').length > 0) setCollaborationState('ready');
      // If another tab holds the seed lease, stay in the connecting state until
      // its Yjs state arrives. A retry is scheduled if that lease was abandoned.
    }).catch((error) => {
      if (cancelled) return;
      if (retryTimer) window.clearTimeout(retryTimer);
      setCollaborationState('error');
      setCollaborationError(error?.code === 'permission-denied'
        ? 'The shared page is not authorised for this account. Verify the deployed Firestore rules.'
        : 'The collaborative text could not be opened. Refresh the journal and try again.');
    });

    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setCollaborationState((current) => {
          if (current !== 'connecting') return current;
          setCollaborationError('This page has not received its shared text yet. Check the connection and refresh.');
          return 'error';
        });
      }
    }, 18000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (retryTimer) window.clearTimeout(retryTimer);
      provider.destroy();
      ydoc.destroy();
    };
  }, [cloudEnabled, user?.uid, page.id, refreshKey, collaborationAttempt]);

  const editorExtensions = useMemo(() => {
    const extensions = [
      StarterKit.configure(cloudEnabled ? { undoRedo: false } : {}),
      TextStyleKit,
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ];
    if (cloudEnabled && collaborationSession) {
      extensions.push(Collaboration.configure({ document: collaborationSession.doc }));
    }
    return extensions;
  }, [cloudEnabled, collaborationSession?.doc]);

  // Tiptap v3 reads options.immediatelyRender inside useEditor, so do not
  // pass null while a cloud collaboration session is still connecting. Create
  // a disabled, empty editor during that brief state; the dependency list makes
  // useEditor recreate it with the collaborative document when the session arrives.
  const editorOptions = {
    immediatelyRender: false,
    extensions: editorExtensions,
    ...(cloudEnabled ? {} : { content: page.content }),
    editable: !cloudEnabled || collaborationState === 'ready' || collaborationSession?.shouldSeed === true,
    editorProps: {
      attributes: {
        class: 'page-editor',
        spellcheck: 'true',
        'aria-label': 'Editable journal page ' + pageNumber,
      },
    },
    onFocus: ({ editor: focusedEditor }) => onEditorFocus(page.id, focusedEditor),
    onUpdate: ({ editor: updatedEditor }) => onContentChange(page.id, updatedEditor.getHTML()),
  };

  const editor = useEditor(editorOptions, [page.id, refreshKey, collaborationSession?.doc, cloudEnabled]);

  useEffect(() => {
    if (editor) {
      const canEdit = !cloudEnabled || collaborationState === 'ready' || collaborationSession?.shouldSeed === true;
      editor.setEditable(canEdit);
    }
  }, [editor, cloudEnabled, collaborationState, collaborationSession?.shouldSeed]);

  useEffect(() => {
    if (!cloudEnabled && editor && editor.getHTML() !== page.content) {
      editor.commands.setContent(page.content || '<p></p>', { emitUpdate: false });
    }
  }, [editor, page.content, refreshKey, cloudEnabled]);

  useEffect(() => {
    if (!cloudEnabled || !editor || !collaborationSession?.shouldSeed || seededRef.current) return;
    // Only the first client that atomically claims initialisation populates the Yjs
    // document. Other clients wait for the provider to deliver this state.
    editor.commands.setContent(page.content || '<p></p>', { emitUpdate: false });
    seededRef.current = true;
    setCollaborationState('ready');
    // Flush immediately instead of waiting only on the debounce timer. If the
    // app is closed or the page changes quickly, the starter text still gets a
    // chance to reach Firestore.
    collaborationSession.provider?.flush().catch(() => {
      setCollaborationState('error');
      setCollaborationError('The starter text could not be saved to Firebase. Check your connection and Firestore rules.');
    });
  }, [editor, cloudEnabled, collaborationSession?.shouldSeed, collaborationSession?.provider, page.content]);

  useEffect(() => {
    if (!cloudEnabled || !editor || collaborationState !== 'ready') return;
    if (!pendingRestore || Number(pendingRestore.pageId) !== Number(page.id)) return;
    if (appliedRestoreNonceRef.current === pendingRestore.nonce) return;
    editor.commands.setContent(pendingRestore.content || '<p></p>', { emitUpdate: false });
    appliedRestoreNonceRef.current = pendingRestore.nonce;
    onRestoreApplied?.(pendingRestore.nonce);
  }, [cloudEnabled, editor, collaborationState, pendingRestore, page.id, onRestoreApplied]);

  return (
    <section
      className={'paper-page' + (active ? ' paper-page--active' : '') + (cloudEnabled && collaborationState !== 'ready' ? ' paper-page--collaboration-waiting' : '')}
      ref={pageRef}
      onClick={() => editor && onEditorFocus(page.id, editor)}
    >
      <div className="paper-grain" aria-hidden="true" />
      <div className="page-content">
        <EditorContent editor={editor} />
      </div>
      <PageObjects page={page} onObjectChange={onObjectChange} pageRef={pageRef} />
      {cloudEnabled && collaborationState !== 'ready' && (
        <div className="page-collab-overlay" role="status">
          <span className="page-collab-symbol">{collaborationState === 'error' ? '!' : '↻'}</span>
          <strong>{collaborationState === 'error' ? 'Page needs attention' : 'Preparing this page'}</strong>
          <small>{collaborationState === 'error' ? collaborationError : 'Connecting the shared text so neither person overwrites the other.'}</small>
        </div>
      )}
      <div className="page-footer">
        <span>{page.bookmarked ? '♡ SAVED' : 'P · A'}</span>
        <span>{String(pageNumber).padStart(3, '0')}</span>
      </div>
      <span className="page-edge-shadow" aria-hidden="true" />
    </section>
  );
}

function App() {
  const auth = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [pages, setPages] = useState(loadPages);
  const pagesRef = useRef(pages);
  const [history, setHistory] = useState(loadHistory);
  const historyRef = useRef(history);
  const [spread, setSpread] = useState(0);
  const [mobilePage, setMobilePage] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [activePageId, setActivePageId] = useState(2);
  const [activeEditor, setActiveEditor] = useState(null);
  const [refreshKeys, setRefreshKeys] = useState({});
  const [pendingRestore, setPendingRestore] = useState(null);
  const [saveState, setSaveState] = useState('Saved on this device');
  const [cloudState, setCloudState] = useState('local');
  const [cloudError, setCloudError] = useState('');
  const [onlinePartners, setOnlinePartners] = useState([]);
  const [panel, setPanel] = useState('');
  const fileInputRef = useRef(null);
  const saveTimer = useRef(null);
  const versionTimer = useRef(null);
  const cloudWriteTimer = useRef(null);
  const cloudReadyRef = useRef(false);
  const seedAttemptedRef = useRef(false);
  const cloudPageSignaturesRef = useRef(new Map());
  const cloudHistoryIdsRef = useRef(new Set());
  const historyCloudLoadedRef = useRef(false);
  const presenceWriterRef = useRef(null);
  const activePageIdRef = useRef(activePageId);

  activePageIdRef.current = activePageId;

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { historyRef.current = history; }, [history]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isOpen || !pages.length) return;
    const visible = isMobile
      ? [pages[mobilePage]].filter(Boolean)
      : [pages[spread * 2], pages[spread * 2 + 1]].filter(Boolean);
    if (visible.some((page) => page.id === activePageId)) return;
    const preferred = isMobile ? visible[0] : visible[visible.length - 1];
    if (preferred) setActivePageId(preferred.id);
  }, [isOpen, isMobile, mobilePage, spread, pages.length]);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    if (!auth.user) setSaveState('Saving…');
    saveTimer.current = setTimeout(() => {
      try {
        const key = auth.user ? PAGE_STORAGE_KEY + ':' + auth.user.uid : PAGE_STORAGE_KEY;
        localStorage.setItem(key, JSON.stringify(pages));
        if (!auth.user) setSaveState('Saved on this device');
      } catch {
        if (!auth.user) setSaveState('Could not save locally');
      }
    }, 550);
    return () => clearTimeout(saveTimer.current);
  }, [pages, auth.user?.uid]);


  // The shared journal is the source of truth once Firebase is configured.
  // Page documents are intentionally separate so edits on different pages do not
  // overwrite the entire notebook. Photo bytes are never written to Firestore.
  useEffect(() => {
    if (!auth.configured || !auth.user || !firebaseDb) {
      cloudReadyRef.current = false;
      setCloudState('local');
      setCloudError('');
      setOnlinePartners([]);
      return undefined;
    }

    cloudReadyRef.current = false;
    seedAttemptedRef.current = false;
    cloudPageSignaturesRef.current = new Map();
    cloudHistoryIdsRef.current = new Set();
    historyCloudLoadedRef.current = false;
    setCloudState('connecting');
    setCloudError('');

    const pagesCollection = collection(firebaseDb, 'journals', 'paraly', 'pages');
    const pagesQuery = query(pagesCollection, orderBy('order', 'asc'));
    const historyCollection = collection(firebaseDb, 'journals', 'paraly', 'history');
    const historyQuery = query(historyCollection, orderBy('createdAt', 'desc'), limit(100));

    const unsubscribePages = onSnapshot(pagesQuery, (snapshot) => {
      if (snapshot.empty) {
        if (seedAttemptedRef.current) return;
        seedAttemptedRef.current = true;
        setCloudState('seeding');
        const starterPages = makeStarterPages();
        const markerRef = doc(firebaseDb, 'journals', 'paraly', 'settings', 'metadata');
        runTransaction(firebaseDb, async (transaction) => {
          const marker = await transaction.get(markerRef);
          if (marker.exists()) return false;

          // Seed marker and starter pages atomically so simultaneous first logins
          // cannot overwrite an already-started notebook with partial starter state.
          const pageRefs = starterPages.map((page) =>
            doc(firebaseDb, 'journals', 'paraly', 'pages', String(page.id))
          );
          const existing = await Promise.all(pageRefs.map((pageRef) => transaction.get(pageRef)));
          if (existing.some((pageDoc) => pageDoc.exists())) return false;

          transaction.set(markerRef, {
            initialized: true,
            initializedBy: auth.user.uid,
            initializedAt: Date.now(),
          });
          starterPages.forEach((page, index) => {
            transaction.set(pageRefs[index], serializePageForCloud(page, index, auth.user));
          });
          return true;
        }).catch((error) => {
          cloudReadyRef.current = false;
          setCloudState('error');
          setCloudError(error?.code === 'permission-denied'
            ? 'Your account is not provisioned in the journal yet. Check the server invitation configuration, then reload.'
            : 'ParAly could not initialise its shared pages. Check the Firebase setup and security rules.');
        });
        return;
      }

      const currentLocalPages = pagesRef.current;
      const remotePages = snapshot.docs.map((pageDoc) => {
        const data = pageDoc.data();
        const payload = { ...data, id: Number(data.id ?? pageDoc.id) };
        const page = hydratePageFromCloud(payload, currentLocalPages);
        const signature = stableJson(serializePageForCloud(page, Number(data.order) || 0, auth.user));
        cloudPageSignaturesRef.current.set(String(page.id), signature);
        return page;
      }).sort((a, b) => a.order - b.order);

      cloudReadyRef.current = true;
      pagesRef.current = remotePages;
      setPages(remotePages);
      setCloudState('ready');
      setCloudError('');
      setSaveState('Synced with Firebase');
    }, (error) => {
      cloudReadyRef.current = false;
      setCloudState('error');
      setCloudError(error?.code === 'permission-denied'
        ? 'Journal access is not provisioned yet. Check the deployed membership rules and invitation configuration.'
        : 'Could not connect to the shared journal. Check your Firebase configuration and internet connection.');
    });

    const unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
      const cloudHistory = snapshot.docs.map((versionDoc) => {
        const version = { ...versionDoc.data(), id: versionDoc.id };
        cloudHistoryIdsRef.current.add(String(version.id));
        return version;
      });
      historyCloudLoadedRef.current = true;
      historyRef.current = cloudHistory;
      setHistory(cloudHistory);
    }, () => {
      // Page sync stays available even if version history is not configured yet.
    });

    return () => {
      cloudReadyRef.current = false;
      unsubscribePages();
      unsubscribeHistory();
      clearTimeout(cloudWriteTimer.current);
    };
  }, [auth.configured, auth.user?.uid]);

  useEffect(() => {
    if (cloudState !== 'ready' || !auth.user || !firebaseDb || !cloudReadyRef.current) return undefined;
    clearTimeout(cloudWriteTimer.current);
    cloudWriteTimer.current = setTimeout(async () => {
      const changes = [];
      pagesRef.current.forEach((page, index) => {
        const payload = serializePageForCloud(page, index, auth.user);
        const signature = stableJson(payload);
        const key = String(page.id);
        if (cloudPageSignaturesRef.current.get(key) !== signature) {
          changes.push({ key, payload, signature });
        }
      });
      if (!changes.length) return;

      setSaveState('Saving to Firebase…');
      try {
        await Promise.all(changes.map(({ key, payload }) =>
          setDoc(doc(firebaseDb, 'journals', 'paraly', 'pages', key), payload, { merge: true })
        ));
        changes.forEach(({ key, signature }) => cloudPageSignaturesRef.current.set(key, signature));
        setSaveState('Synced with Firebase');
      } catch (error) {
        setSaveState('Cloud save failed');
        setCloudError(error?.code === 'permission-denied'
          ? 'Firebase rules denied a page update. Check that the two journal members are provisioned.'
          : 'A page could not be saved to Firebase. Your local backup is still available.');
      }
    }, 650);
    return () => clearTimeout(cloudWriteTimer.current);
  }, [pages, cloudState, auth.user?.uid]);

  useEffect(() => {
    if (cloudState !== 'ready' || !auth.user || !firebaseDb || !historyCloudLoadedRef.current) return undefined;
    const missing = history.filter((version) => !cloudHistoryIdsRef.current.has(String(version.id)));
    if (!missing.length) return undefined;

    let cancelled = false;
    const saveVersions = async () => {
      for (const version of missing) {
        if (cancelled) return;
        try {
          const payload = serializeVersionForCloud(version, auth.user);
          await setDoc(doc(firebaseDb, 'journals', 'paraly', 'history', String(version.id)), payload, { merge: false });
          cloudHistoryIdsRef.current.add(String(version.id));
        } catch (error) {
          setCloudError(error?.code === 'permission-denied'
            ? 'Firebase denied saving version history. Check the deployed Firestore rules.'
            : 'Version history could not be synchronised. Recent text remains saved in the page.');
          return;
        }
      }
    };
    saveVersions();
    return () => { cancelled = true; };
  }, [history, cloudState, auth.user?.uid]);

  // Presence uses Realtime Database disconnect handling so an abruptly closed tab
  // is removed automatically. Presence is advisory; page data remains in Firestore.
  useEffect(() => {
    if (cloudState !== 'ready' || !auth.user || !firebaseRealtimeDb) {
      presenceWriterRef.current = null;
      setOnlinePartners([]);
      return undefined;
    }

    const uid = auth.user.uid;
    const presencePath = 'journals/paraly/presence';
    const selfRef = ref(firebaseRealtimeDb, presencePath + '/' + uid);
    const allPresenceRef = ref(firebaseRealtimeDb, presencePath);
    const writePresence = () => set(selfRef, {
      uid,
      displayName: auth.user.displayName || auth.user.email || 'A journal member',
      photoURL: auth.user.photoURL || '',
      pageId: activePageIdRef.current,
      lastSeen: Date.now(),
    });
    presenceWriterRef.current = writePresence;
    const disconnect = onDisconnect(selfRef);
    disconnect.remove().catch(() => {});
    writePresence().catch(() => {});
    const stopPresenceListener = onValue(allPresenceRef, (snapshot) => {
      const people = snapshot.val() || {};
      const now = Date.now();
      setOnlinePartners(Object.values(people).filter((person) =>
        person && person.uid !== uid && typeof person.lastSeen === 'number' && now - person.lastSeen < 90000
      ));
    });
    const heartbeat = window.setInterval(() => writePresence().catch(() => {}), 30000);

    return () => {
      window.clearInterval(heartbeat);
      stopPresenceListener();
      presenceWriterRef.current = null;
      disconnect.cancel().catch(() => {});
      remove(selfRef).catch(() => {});
    };
  }, [cloudState, auth.user?.uid]);

  useEffect(() => {
    if (presenceWriterRef.current && cloudState === 'ready') {
      presenceWriterRef.current().catch(() => {});
    }
  }, [activePageId, cloudState]);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    clearTimeout(versionTimer.current);
    clearTimeout(cloudWriteTimer.current);
  }, []);

  const maxSpread = Math.max(0, Math.ceil(pages.length / 2) - 1);
  const visiblePages = useMemo(() => {
    if (isMobile) return [pages[mobilePage]].filter(Boolean);
    return [pages[spread * 2], pages[spread * 2 + 1]].filter(Boolean);
  }, [isMobile, mobilePage, pages, spread]);

  const activePage = pages.find((page) => page.id === activePageId) || visiblePages[visiblePages.length - 1] || pages[0];

  const handleContentChange = useCallback((id, html) => {
    const nextPages = pagesRef.current.map((page) => page.id === id ? {
      ...page,
      content: html,
      updatedAt: Date.now(),
      updatedBy: auth.user?.uid || page.updatedBy || '',
      updatedByName: auth.user?.displayName || auth.user?.email || page.updatedByName || '',
    } : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
    setSaveState('Saving…');

    clearTimeout(versionTimer.current);
    versionTimer.current = setTimeout(() => {
      const snapshotPage = pagesRef.current.find((page) => page.id === id);
      if (!snapshotPage) return;
      const previous = historyRef.current;
      if (previous[0] && previous[0].pageId === id && previous[0].content === snapshotPage.content) return;
      const nextHistory = [{
        id: (globalThis.crypto?.randomUUID?.() || (String(Date.now()) + '-' + Math.random().toString(36).slice(2))),
        pageId: id,
        title: snapshotPage.title,
        createdAt: Date.now(),
        content: snapshotPage.content,
        objects: snapshotPage.objects,
      }, ...previous].slice(0, 80);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      try {
        const key = auth.user ? HISTORY_STORAGE_KEY + ':' + auth.user.uid : HISTORY_STORAGE_KEY;
        localStorage.setItem(key, JSON.stringify(nextHistory));
      } catch { /* history is best-effort in local preview */ }
    }, 9000);
  }, [auth.user?.uid, auth.user?.displayName, auth.user?.email]);

  const handleObjectChange = useCallback((pageId, objectId, patch) => {
    const nextPages = pagesRef.current.map((page) => page.id === pageId
      ? {
        ...page,
        updatedAt: Date.now(),
        updatedBy: auth.user?.uid || page.updatedBy || '',
        updatedByName: auth.user?.displayName || auth.user?.email || page.updatedByName || '',
        objects: page.objects.map((object) => object.id === objectId ? { ...object, ...patch } : object),
      }
      : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
  }, [auth.user?.uid, auth.user?.displayName, auth.user?.email]);

  const addObjectToPage = (pageId, object) => {
    const nextPages = pagesRef.current.map((page) => page.id === pageId
      ? {
        ...page,
        updatedAt: Date.now(),
        updatedBy: auth.user?.uid || page.updatedBy || '',
        updatedByName: auth.user?.displayName || auth.user?.email || page.updatedByName || '',
        objects: [...page.objects, object],
      }
      : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
    setActivePageId(pageId);
  };

  const currentPageId = () => activePageId || (isMobile ? pages[mobilePage]?.id : pages[spread * 2 + 1]?.id) || pages[0].id;

  const addStickyNote = () => {
    const colors = ['#f5e4a7', '#dce9d4', '#f4d8d9', '#dbe5f6'];
    const pageId = currentPageId();
    const count = pagesRef.current.find((page) => page.id === pageId)?.objects.length || 0;
    addObjectToPage(pageId, {
      id: 'note-' + Date.now(),
      type: 'note',
      text: '',
      color: colors[count % colors.length],
      left: 58 + (count % 3) * 2,
      top: 18 + (count % 4) * 7,
      rotation: count % 2 ? 2 : -2,
    });
  };

  const resizeImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        let scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        let dataUrl = '';
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Your browser could not prepare this photograph.'));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const quality = Math.max(0.42, 0.78 - attempt * 0.08);
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          const estimatedBytes = Math.max(0, dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75;
          if (estimatedBytes <= 1.25 * 1024 * 1024) {
            resolve(dataUrl);
            return;
          }
          if (attempt >= 2) scale *= 0.82;
        }
        if (dataUrl) resolve(dataUrl);
        else reject(new Error('That photograph could not be compressed.'));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handlePhotoSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      window.alert('Please choose an image file.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      window.alert('Please choose a photo smaller than 100 MB.');
      return;
    }

    let previewSrc = '';
    let driveAssets = {};
    let completed = false;
    try {
      previewSrc = await resizeImage(file);
      if (auth.configured && auth.user) {
        setSaveState('Uploading photograph to Drive…');
        const previewBlob = await (await fetch(previewSrc)).blob();
        driveAssets = await uploadJournalPhoto(file, previewBlob);
      }

      const pageId = currentPageId();
      const count = pagesRef.current.find((page) => page.id === pageId)?.objects.length || 0;
      addObjectToPage(pageId, {
        id: 'photo-' + Date.now(),
        type: 'photo',
        src: driveAssets.src ?? previewSrc,
        ...driveAssets,
        caption: '',
        frame: 'polaroid',
        left: 55,
        top: 52 + (count % 3) * 3,
        rotation: count % 2 ? 3 : -4,
      });
      completed = true;
      setSaveState(auth.configured && auth.user ? 'Photo saved to Drive · syncing journal' : 'Saved on this device');
    } catch (error) {
      const message = error?.message || 'That image could not be added.';
      window.alert(message.includes('Drive') || message.includes('ParAly') || message.includes('Google')
        ? message
        : 'That image could not be prepared. Try a JPG or PNG.');
    } finally {
      if (!completed && cloudState === 'ready') setSaveState('Synced with Firebase');
    }
  };


  const toggleBookmark = () => {
    const id = currentPageId();
    const nextPages = pagesRef.current.map((page) => page.id === id ? {
      ...page,
      bookmarked: !page.bookmarked,
      updatedAt: Date.now(),
      updatedBy: auth.user?.uid || page.updatedBy || '',
      updatedByName: auth.user?.displayName || auth.user?.email || page.updatedByName || '',
    } : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
  };

  const goToPage = (index) => {
    const safeIndex = Math.max(0, Math.min(pages.length - 1, index));
    setActivePageId(pages[safeIndex].id);
    setMobilePage(safeIndex);
    setSpread(Math.floor(safeIndex / 2));
    setPanel('');
    setActiveEditor(null);
  };

  const turnPage = (direction) => {
    setActiveEditor(null);
    if (isMobile) {
      const next = Math.max(0, Math.min(pages.length - 1, mobilePage + direction));
      setMobilePage(next);
      setActivePageId(pages[next].id);
    } else {
      const next = Math.max(0, Math.min(maxSpread, spread + direction));
      setSpread(next);
      const target = pages[Math.min(pages.length - 1, next * 2 + (direction > 0 ? 1 : 0))];
      if (target) setActivePageId(target.id);
    }
  };

  const addPages = () => {
    const firstId = Math.max(...pagesRef.current.map((page) => page.id)) + 1;
    const newPages = [0, 1].map((offset) => ({
      id: firstId + offset,
      title: 'Untitled page',
      content: '<p></p>',
      objects: [],
      bookmarked: false,
      updatedAt: Date.now(),
    }));
    const oldLength = pagesRef.current.length;
    const nextPages = [...pagesRef.current, ...newPages];
    pagesRef.current = nextPages;
    setPages(nextPages);
    setMobilePage(oldLength);
    setSpread(Math.floor(oldLength / 2));
    setActivePageId(firstId);
    setPanel('');
    setActiveEditor(null);
  };

  const restoreVersion = (version) => {
    const nextPages = pagesRef.current.map((page) => page.id === version.pageId
      ? { ...page, content: version.content, objects: version.objects || [], updatedAt: Date.now() }
      : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
    if (cloudState === 'ready') {
      setPendingRestore({ pageId: version.pageId, content: version.content, nonce: Date.now() });
    }
    setRefreshKeys((previous) => ({ ...previous, [version.pageId]: (previous[version.pageId] || 0) + 1 }));
    goToPage(nextPages.findIndex((page) => page.id === version.pageId));
  };

  const photos = pages.flatMap((page) => page.objects.filter((object) => object.type === 'photo').map((object) => ({ ...object, pageId: page.id })));
  const bookmarkedPages = pages.filter((page) => page.bookmarked);

  const applyCommand = (command) => {
    if (!activeEditor) return;
    command(activeEditor);
  };

  const renderPanel = () => {
    if (!panel) return null;
    return (
      <aside className="side-panel">
        <div className="side-panel-heading">
          <div>
            <span className="eyebrow">YOUR JOURNAL</span>
            <h2>{panel === 'contents' ? 'Contents' : panel === 'gallery' ? 'Photo gallery' : panel === 'timeline' ? 'Timeline' : panel === 'bookmarks' ? 'Saved pages' : 'Version history'}</h2>
          </div>
          <button className="close-panel" onClick={() => setPanel('')} aria-label="Close panel">×</button>
        </div>

        {panel === 'contents' && (
          <div className="panel-list">
            {pages.map((page, index) => (
              <button key={page.id} className="panel-row" onClick={() => goToPage(index)}>
                <span className="panel-page-number">{String(index + 1).padStart(3, '0')}</span>
                <span><strong>{page.title || 'Untitled page'}</strong><small>{page.bookmarked ? 'Saved page' : 'Page ' + (index + 1)}</small></span>
                <span className="panel-arrow">↗</span>
              </button>
            ))}
          </div>
        )}

        {panel === 'gallery' && (
          photos.length ? <div className="gallery-grid">{photos.map((photo) => (
            <button className="gallery-item" key={photo.id} onClick={() => goToPage(pages.findIndex((page) => page.id === photo.pageId))}>
              <DrivePhotoImage object={photo} alt={photo.caption || 'Journal photo'} />
              <span>{photo.caption || 'Page ' + photo.pageId}</span>
            </button>
          ))}</div> : <div className="empty-panel"><span>✳</span><p>Your photographs will collect here.</p><small>Add a photo to a page and it will appear in this gallery.</small></div>
        )}

        {panel === 'timeline' && (
          <div className="panel-list">{[...pages].sort((a, b) => b.updatedAt - a.updatedAt).map((page) => (
            <button key={page.id} className="panel-row" onClick={() => goToPage(pages.findIndex((item) => item.id === page.id))}>
              <span className="timeline-dot" />
              <span><strong>{page.title || 'Untitled page'}</strong><small>Last edited {new Date(page.updatedAt).toLocaleDateString()}</small></span>
              <span className="panel-arrow">↗</span>
            </button>
          ))}</div>
        )}

        {panel === 'bookmarks' && (
          bookmarkedPages.length ? <div className="panel-list">{bookmarkedPages.map((page) => (
            <button key={page.id} className="panel-row" onClick={() => goToPage(pages.findIndex((item) => item.id === page.id))}>
              <span className="panel-page-number">♡</span>
              <span><strong>{page.title || 'Untitled page'}</strong><small>Page {pages.findIndex((item) => item.id === page.id) + 1}</small></span>
              <span className="panel-arrow">↗</span>
            </button>
          ))}</div> : <div className="empty-panel"><span>♡</span><p>Keep the pages that matter close.</p><small>Use the bookmark control while viewing any page.</small></div>
        )}

        {panel === 'history' && (
          history.length ? <div className="panel-list">{history.map((version) => (
            <div className="history-row" key={version.id}>
              <div><strong>{version.title || 'Page ' + version.pageId}</strong><small>{new Date(version.createdAt).toLocaleString()} · Page {version.pageId}</small></div>
              <button className="restore-button" onClick={() => restoreVersion(version)}>Restore</button>
            </div>
          ))}</div> : <div className="empty-panel"><span>↶</span><p>Your edits will leave a trail here.</p><small>A version is captured after you pause typing for a few seconds. This preview stores history only on this device.</small></div>
        )}
      </aside>
    );
  };

  if (auth.configured && auth.user && cloudState !== 'ready') {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-monogram">P <span>&amp;</span> A</div>
          <span className="eyebrow">THE SHARED JOURNAL</span>
          <h1>{cloudState === 'error' ? 'One small setup step.' : 'Finding our pages.'}<span>.</span></h1>
          {cloudState !== 'error' && <div className="auth-loading-mark" aria-label="Loading" />}
          <p className="auth-description">{cloudState === 'error' ? cloudError : 'Connecting to the private journal and loading its latest pages.'}</p>
          {cloudState === 'error' && <p className="auth-error">Your local preview remains untouched. The cloud journal will open once its membership and Firebase rules are set up correctly.</p>}
          <button className="google-signin-button" type="button" onClick={auth.signOut}>Sign out</button>
        </div>
        <div className="auth-screen-foot">PARALY <span>·</span> A SMALL WORLD FOR TWO</div>
      </main>
    );
  }

  if (auth.configured && auth.loading) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-monogram">P <span>&amp;</span> A</div>
          <span className="eyebrow">A PRIVATE JOURNAL</span>
          <h1>Opening your little world<span>.</span></h1>
          <div className="auth-loading-mark" aria-label="Loading" />
          <p>Checking your invitation…</p>
        </div>
      </main>
    );
  }

  if (auth.configured && !auth.user) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-monogram">P <span>&amp;</span> A</div>
          <span className="eyebrow">JUST BETWEEN US</span>
          <h1>A place for<br />the things we keep<span>.</span></h1>
          <p className="auth-description">Letters, photographs, and little pieces of ordinary days. A shared journal, with only two keys.</p>
          <button className="google-signin-button" type="button" onClick={auth.signInWithGoogle}>
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(1 1) scale(.96)"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.74 7.18l7.72 5.99c4.51-4.17 7.06-10.31 7.06-17.64Z" transform="translate(1 1) scale(.96)"/>
              <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.89.93 7.57 2.56 10.78l7.97-6.19Z" transform="translate(1 1) scale(.96)"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.72-5.99c-2.14 1.45-4.88 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(1 1) scale(.96)"/>
            </svg>
            <span>Continue with Google</span>
            <span className="google-button-arrow">↗</span>
          </button>
          {auth.error && <p className="auth-error" role="alert">{auth.error}</p>}
          <div className="auth-footnote"><span /> INVITATION ONLY <span /></div>
        </div>
        <div className="auth-screen-foot">PARALY <span>·</span> A SMALL WORLD FOR TWO</div>
      </main>
    );
  }

  if (!isOpen) {
    return (
      <main className="cover-screen">
        <div className="cover-atmosphere" aria-hidden="true" />
        <div className="cover-topline"><span>PRIVATE JOURNAL</span><span>VOL. 01 — P · A</span></div>
        <div className="cover-stage">
          <div className={'closed-notebook' + (isOpening ? ' closed-notebook--opening' : '')}>
            <div className="cover-pages-edge" />
            <div className="cover-back" />
            <div className="cover-face">
              <div className="cover-stitch" />
              <div className="cover-small-label">A PLACE FOR OUR MEMORIES</div>
              <div className="cover-monogram">P <span>&</span> A</div>
              <div className="cover-rule" />
              <div className="cover-title">the little things<br />we keep</div>
              <div className="cover-date">EST. WITH LOVE</div>
              <div className="cover-bottom-mark">P · A</div>
            </div>
            <div className="cover-coil" aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <span key={index} />)}</div>
          </div>
        </div>
        <div className="cover-caption">
          <p>A quiet place for the things that belong to us.</p>
          <button className="open-journal-button" disabled={isOpening} onClick={() => { setIsOpening(true); window.setTimeout(() => { setIsOpen(true); setIsOpening(false); }, 950); }}>
            <span>{isOpening ? 'OPENING YOUR JOURNAL' : 'OPEN OUR JOURNAL'}</span><span className="button-arrow">↗</span>
          </button>
          <small>MADE FOR TWO · KEPT CLOSE</small>
        </div>
        <div className="cover-bottomline"><span>PARALY</span><span>JUST BETWEEN US</span><span>01 / ∞</span></div>
      </main>
    );
  }

  return (
    <main className="journal-app">
      <header className="app-header">
        <a className="app-wordmark" href="#journal" onClick={(event) => event.preventDefault()} aria-label="ParAly home">P<span>&</span>A <i>JOURNAL</i></a>
        <div className="save-indicator"><span className="save-dot" />{saveState}</div>
        <div className="header-actions">
          <button className="header-link" onClick={() => setPanel('contents')}>CONTENTS</button>
          <button className="header-link" onClick={() => setPanel('gallery')}>GALLERY</button>
          {auth.configured && auth.user && (
            <div className="signed-in-user">
              <span>{auth.user.displayName?.split(' ')[0] || auth.user.email}</span>
              <button onClick={auth.signOut} title="Sign out of ParAly">SIGN OUT</button>
            </div>
          )}
          <button className="header-icon-button" title="Close journal" aria-label="Close journal" onClick={() => { setIsOpen(false); setSpread(0); setMobilePage(0); }}>↙</button>
        </div>
      </header>

      <div className="preview-banner">
        <span className="preview-banner-mark">i</span>
        <span>
          {cloudState === 'ready'
            ? <><strong>Shared journal connected</strong> — text and sticky notes sync through Firebase. Photo sharing activates after the private Drive OAuth settings are configured.</>
            : auth.configured
              ? <><strong>{cloudState === 'error' ? 'Cloud connection needs setup' : 'Connecting your journal'}</strong> — {cloudState === 'error' ? cloudError : 'Opening the shared pages and checking membership…'}</>
              : <><strong>Private preview</strong> — drafts and photographs are saved in this browser until Firebase and Drive are configured.</>}
        </span>
      </div>

      <nav className="journal-toolbar" aria-label="Journal tools">
        <div className="toolbar-group toolbar-formatting">
          <ToolButton label="B" title="Bold" active={!!activeEditor?.isActive('bold')} disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleBold().run())} />
          <ToolButton label={<em>I</em>} title="Italic" active={!!activeEditor?.isActive('italic')} disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleItalic().run())} />
          <ToolButton label={<span className="underlined-tool">U</span>} title="Underline" active={!!activeEditor?.isActive('underline')} disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleUnderline().run())} />
          <ToolButton label={<s>S</s>} title="Strikethrough" active={!!activeEditor?.isActive('strike')} disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleStrike().run())} />
          <span className="toolbar-divider" />
          <select title="Font family" aria-label="Font family" defaultValue="Cormorant Garamond" onChange={(event) => applyCommand((editor) => editor.chain().focus().setFontFamily(event.target.value).run())} disabled={!activeEditor}>
            <option value="Cormorant Garamond">Cormorant</option>
            <option value="Playfair Display">Playfair</option>
            <option value="Caveat">Handwritten</option>
            <option value="DM Sans">Sans</option>
            <option value="Georgia">Georgia</option>
          </select>
          <select title="Text size" aria-label="Text size" defaultValue="18px" onChange={(event) => applyCommand((editor) => editor.chain().focus().setFontSize(event.target.value).run())} disabled={!activeEditor}>
            <option value="13px">Small</option><option value="16px">Regular</option><option value="18px">Large</option><option value="24px">Title</option><option value="32px">Display</option>
          </select>
          <label className="color-tool" title="Text colour">A<input aria-label="Text colour" type="color" defaultValue="#334d67" disabled={!activeEditor} onChange={(event) => applyCommand((editor) => editor.chain().focus().setColor(event.target.value).run())} /></label>
          <label className="highlight-tool" title="Highlight colour">▰<input aria-label="Highlight colour" type="color" defaultValue="#f4df8a" disabled={!activeEditor} onChange={(event) => applyCommand((editor) => editor.chain().focus().setHighlight({ color: event.target.value }).run())} /></label>
          <ToolButton label="≡" title="Align left" disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().setTextAlign('left').run())} />
          <ToolButton label="☷" title="Bulleted list" disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleBulletList().run())} />
          <ToolButton label="↶" title="Undo" disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().undo().run())} />
          <ToolButton label="↷" title="Redo" disabled={!activeEditor} onClick={() => applyCommand((editor) => editor.chain().focus().redo().run())} />
        </div>
        <div className="toolbar-group toolbar-insert">
          <button className="insert-button" onClick={addStickyNote}><span>＋</span> Sticky note</button>
          <button className="insert-button" onClick={() => fileInputRef.current?.click()}><span>＋</span> Photograph</button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoSelected} />
          <button className={'bookmark-button' + (activePage?.bookmarked ? ' is-bookmarked' : '')} onClick={toggleBookmark} title="Bookmark this page" aria-label="Bookmark this page">♡</button>
        </div>
      </nav>

      <div className="journal-workspace">
        <div className="journal-label-row">
          <div><span className="eyebrow">THE SHARED JOURNAL</span><h1>Our little world<span>.</span></h1></div>
          <div className="active-page-label"><span className="presence-dot" />{activePage?.title || 'Untitled page'} <span className="page-label-separator">/</span> {isMobile ? 'PAGE ' + (mobilePage + 1) : 'PAGES ' + (spread * 2 + 1) + '–' + Math.min(pages.length, spread * 2 + 2)}{onlinePartners.length > 0 && <span className="collaborator-chip"><span className="presence-dot" />{onlinePartners[0].displayName || 'Your person'} is here</span>}</div>
        </div>

        <div className={'notebook-spread' + (isMobile ? ' notebook-spread--mobile' : '')} key={isMobile ? 'mobile' : 'desktop'}>
          <div className="notebook-cover-underlay" />
          <div className="spiral-binding" aria-hidden="true">
            {Array.from({ length: 15 }, (_, index) => <span className="spiral-ring" key={index}><i /></span>)}
          </div>
          <div className="pages-spread" key={(isMobile ? mobilePage : spread) + '-' + (isMobile ? 'm' : 'd')}>
            {visiblePages.map((page) => {
              const pageIndex = pages.findIndex((item) => item.id === page.id);
              return (
                <JournalPage
                  key={page.id + '-' + (refreshKeys[page.id] || 0)}
                  page={page}
                  pageNumber={pageIndex + 1}
                  active={page.id === activePageId}
                  refreshKey={refreshKeys[page.id] || 0}
                  cloudEnabled={cloudState === 'ready' && auth.configured && Boolean(auth.user)}
                  user={auth.user}
                  pendingRestore={pendingRestore}
                  onRestoreApplied={(nonce) => setPendingRestore((current) => current?.nonce === nonce ? null : current)}
                  onContentChange={handleContentChange}
                  onObjectChange={handleObjectChange}
                  onEditorFocus={(id, editor) => { setActivePageId(id); setActiveEditor(editor); }}
                />
              );
            })}
          </div>
        </div>

        <div className="journal-bottom-controls">
          <button className="page-turn-button" onClick={() => turnPage(-1)} disabled={isMobile ? mobilePage === 0 : spread === 0}><span>←</span> Previous</button>
          <div className="page-progress">
            <div className="page-progress-line"><span style={{ width: (((isMobile ? mobilePage : spread * 2) + 1) / pages.length) * 100 + '%' }} /></div>
            <span>{String(isMobile ? mobilePage + 1 : spread * 2 + 1).padStart(2, '0')} <i>/</i> {String(pages.length).padStart(2, '0')}</span>
          </div>
          <button className="page-turn-button" onClick={() => turnPage(1)} disabled={isMobile ? mobilePage >= pages.length - 1 : spread >= maxSpread}>Next page <span>→</span></button>
          <button className="add-pages-button" onClick={addPages}>＋ Add pages</button>
        </div>

        <footer className="journal-footer">
          <div className="footer-note">A little place to leave pieces of your day.</div>
          <div className="footer-navigation">
            <button onClick={() => setPanel('timeline')}>TIMELINE</button>
            <button onClick={() => setPanel('bookmarks')}>SAVED PAGES</button>
            <button onClick={() => setPanel('history')}>VERSION HISTORY</button>
          </div>
        </footer>
      </div>
      {renderPanel()}
      {panel && <button className="panel-scrim" onClick={() => setPanel('')} aria-label="Close side panel" />}
    </main>
  );
}

export default App;