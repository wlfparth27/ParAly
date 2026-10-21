import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, setDoc } from 'firebase/firestore';
import { onDisconnect, onValue, ref, remove, set } from 'firebase/database';
import { firebaseApp, firebaseDb, firebaseRealtimeDb } from './firebase.js';
import { hydratePageFromCloud, serializePageForCloud, serializeVersionForCloud, stableJson } from './journal/cloudModel.js';
import { uploadJournalPhoto, fetchDrivePreview, deleteDrivePhoto } from './drive/driveClient.js';
import { useAuth } from './auth/AuthProvider.jsx';

const PAGE_STORAGE_KEY = 'paraly-pages-v1';
const HISTORY_STORAGE_KEY = 'paraly-history-v1';
const PAPER_COLOR_PRESETS = [
  ['#f4f0e6', 'Warm ivory'],
  ['#fffdf7', 'Paper white'],
  ['#f4e3e4', 'Soft rose'],
  ['#e5eee1', 'Sage'],
  ['#e4edf4', 'Mist blue'],
  ['#ece7f5', 'Lilac'],
  ['#efe3d0', 'Sand'],
];

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

function PageObjects({ page, onObjectChange, onObjectDelete, pageRef }) {
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
              <button
                className="object-delete-button"
                type="button"
                title="Delete sticky note"
                aria-label="Delete sticky note"
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); onObjectDelete(page.id, object.id); }}
              >×</button>
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
              <button
                className="object-delete-button"
                type="button"
                title="Delete photograph"
                aria-label="Delete photograph"
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); onObjectDelete(page.id, object.id); }}
              >×</button>
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
  onObjectDelete,
  onEditorFocus,
}) {
  const pageRef = useRef(null);
  const appliedRestoreNonceRef = useRef(null);
  const [collaborationState, setCollaborationState] = useState(cloudEnabled ? 'ready' : 'local');

  // The Firestore page document is the live shared source of truth for now.
  // Keep one stable Tiptap editor per page instead of swapping editors while a
  // Yjs session attaches. That swap was leaving stale editor references behind
  // and causing the commands-null crash that blanked the whole notebook.
  useEffect(() => {
    setCollaborationState(cloudEnabled ? 'ready' : 'local');
  }, [cloudEnabled]);

  const editorExtensions = useMemo(() => [
    StarterKit,
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ], []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions,
    content: page.content || '<p></p>',
    editable: true,
    editorProps: {
      attributes: {
        class: 'page-editor',
        spellcheck: 'true',
        'aria-label': 'Editable journal page ' + pageNumber,
      },
    },
    onFocus: ({ editor: focusedEditor }) => {
      if (!focusedEditor.isDestroyed) onEditorFocus(page.id, focusedEditor);
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (!updatedEditor.isDestroyed) onContentChange(page.id, updatedEditor.getHTML());
    },
  }, [page.id, refreshKey]);

  // Apply remote Firestore updates to the existing editor without generating a
  // second write. The local editor is not re-created as cloud state changes.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view?.dom?.isConnected) return;
    editor.setEditable(true);
    const nextContent = page.content || '<p></p>';
    if (editor.getHTML() !== nextContent) {
      try {
        editor.commands.setContent(nextContent, { emitUpdate: false });
      } catch {
        // Ignore a teardown race; the next Firestore snapshot will retry.
      }
    }
  }, [editor, page.content, refreshKey]);

  useEffect(() => {
    if (!cloudEnabled || !editor || editor.isDestroyed || collaborationState !== 'ready') return;
    if (!pendingRestore || Number(pendingRestore.pageId) !== Number(page.id)) return;
    if (appliedRestoreNonceRef.current === pendingRestore.nonce) return;

    try {
      editor.commands.setContent(pendingRestore.content || '<p></p>', { emitUpdate: false });
      appliedRestoreNonceRef.current = pendingRestore.nonce;
      onRestoreApplied?.(pendingRestore.nonce);
    } catch {
      // A restore should never crash the notebook if an editor is re-mounted.
    }
  }, [cloudEnabled, editor, collaborationState, pendingRestore, page.id, onRestoreApplied]);

  return (
    <section
      className={'paper-page' + (active ? ' paper-page--active' : '')}
      data-paper-pattern={page.paperPattern || 'plain'}
      style={{ '--paper-color': page.paperColor || '#f4f0e6' }}
      ref={pageRef}
      onClick={() => {
        if (editor && !editor.isDestroyed && editor.view?.dom?.isConnected) {
          onEditorFocus(page.id, editor);
        }
      }}
    >
      <div className="paper-grain" aria-hidden="true" />
      <div className="page-content">
        <EditorContent editor={editor} />
      </div>
      <PageObjects page={page} onObjectChange={onObjectChange} onObjectDelete={onObjectDelete} pageRef={pageRef} />
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
  const [isJournalEntering, setIsJournalEntering] = useState(false);
  const [turnDirection, setTurnDirection] = useState('next');
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
  const activePaperColor = activePage?.paperColor || '#f4f0e6';
  const activePaperPattern = activePage?.paperPattern || 'plain';

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

  const handleObjectDelete = useCallback(async (pageId, objectId) => {
    const page = pagesRef.current.find((item) => item.id === pageId);
    const target = page?.objects.find((object) => object.id === objectId);
    if (!target) return;

    const kind = target.type === 'photo' ? 'photograph' : 'sticky note';
    const confirmed = window.confirm('Delete this ' + kind + ' from the journal?');
    if (!confirmed) return;

    // Remove it from the journal immediately; the existing Firestore page sync
    // persists the updated object list for both members.
    const nextPages = pagesRef.current.map((item) => item.id === pageId
      ? {
        ...item,
        updatedAt: Date.now(),
        updatedBy: auth.user?.uid || item.updatedBy || '',
        updatedByName: auth.user?.displayName || auth.user?.email || item.updatedByName || '',
        objects: item.objects.filter((object) => object.id !== objectId),
      }
      : item);
    pagesRef.current = nextPages;
    setPages(nextPages);

    if (target.type === 'photo') {
      const driveIds = [...new Set([target.drivePreviewFileId, target.driveOriginalFileId].filter(Boolean))];
      if (driveIds.length) {
        try {
          await Promise.all(driveIds.map((fileId) => deleteDrivePhoto(fileId)));
          setSaveState(cloudState === 'ready' ? 'Photograph removed · journal syncing' : 'Photograph removed');
        } catch {
          // The photo is removed from the notebook even if Drive is temporarily
          // unavailable. Warn that the underlying managed file may need cleanup.
          window.alert('The photograph was removed from the journal, but its Drive file could not be deleted. Check the connection and try again later.');
        }
      }
    }
  }, [auth.user?.uid, auth.user?.displayName, auth.user?.email, cloudState]);

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

  const handlePaperStyleChange = (patch) => {
    const pageId = currentPageId();
    const nextPages = pagesRef.current.map((page) => page.id === pageId
      ? {
        ...page,
        ...patch,
        updatedAt: Date.now(),
        updatedBy: auth.user?.uid || page.updatedBy || '',
        updatedByName: auth.user?.displayName || auth.user?.email || page.updatedByName || '',
      }
      : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
    setSaveState(cloudState === 'ready' ? 'Saving to Firebase…' : 'Saved on this device');
  };

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

  const resizeImage = async (file) => {
    let image = null;
    let objectUrl = '';
    let previewBlob = null;

    // Prefer Blob decoding/encoding. This is more reliable than round-tripping
    // the selected file through a large base64 data URL before preparing a Drive
    // preview, and it gives us the actual compressed Blob for upload.
    if (typeof createImageBitmap === 'function') {
      try {
        image = await createImageBitmap(file);
      } catch {
        // Fall back to the browser image decoder below for formats supported by
        // <img> but not by createImageBitmap in a particular browser.
      }
    }

    if (!image) {
      objectUrl = URL.createObjectURL(file);
      image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error(
          'Your browser could not read that image file. Try opening it and exporting it again as a standard JPG or PNG.'
        ));
        element.src = objectUrl;
      }).catch((error) => {
        URL.revokeObjectURL(objectUrl);
        throw error;
      });
    }

    try {
      const originalWidth = image.width;
      const originalHeight = image.height;
      if (!originalWidth || !originalHeight) {
        throw new Error('The selected image has no readable dimensions. Try exporting it as a standard JPG or PNG.');
      }

      let scale = Math.min(1, 1200 / Math.max(originalWidth, originalHeight));
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(originalWidth * scale));
        canvas.height = Math.max(1, Math.round(originalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Your browser could not create an image preview. Try another browser or a smaller photo.');
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const quality = Math.max(0.42, 0.78 - attempt * 0.08);
        previewBlob = await new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Your browser could not encode the image preview. Try saving the photo as a standard JPG or PNG.'));
          }, 'image/jpeg', quality);
        });

        if (previewBlob.size <= 1.25 * 1024 * 1024 || attempt === 6) {
          const previewSrc = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('The compressed preview could not be prepared in this browser.'));
            reader.readAsDataURL(previewBlob);
          });
          if (!previewSrc) throw new Error('The compressed preview was empty. Please choose another JPG or PNG.');
          return { previewSrc, previewBlob };
        }

        if (attempt >= 2) scale *= 0.82;
      }

      throw new Error('The compressed preview could not be prepared. Please choose another JPG or PNG.');
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('Your browser could not prepare this image. Try exporting it again as a standard JPG or PNG.');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (typeof image.close === 'function') image.close();
    }
  };

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
    let previewBlob = null;
    let driveAssets = {};
    let completed = false;
    try {
      const prepared = await resizeImage(file);
      previewSrc = prepared.previewSrc;
      previewBlob = prepared.previewBlob;

      if (auth.configured && auth.user) {
        setSaveState('Uploading photograph to Drive…');
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
      const message = error?.message || 'The photograph could not be added for an unknown reason.';
      window.alert(message);
      if (cloudState === 'ready') {
        setSaveState(message.includes('Drive') || message.includes('Google')
          ? 'Google Drive upload failed'
          : 'Photograph preparation failed');
      }
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
    setTurnDirection(direction > 0 ? 'next' : 'previous');
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

  // During collaborative setup Tiptap may destroy and recreate an editor as
  // its Yjs document attaches. Never ask a destroyed instance for commands or
  // active-mark state; stale editor handles can crash the whole React tree.
  const usableEditor = activeEditor
    && !activeEditor.isDestroyed
    && activeEditor.view?.dom?.isConnected
    ? activeEditor
    : null;

  const isEditorActive = (name) => {
    if (!usableEditor || usableEditor.isDestroyed || !usableEditor.view?.dom?.isConnected) return false;
    try {
      return Boolean(usableEditor.isActive(name));
    } catch {
      // Ignore a Tiptap instance being torn down during collaborative rebind.
      return false;
    }
  };

  const applyCommand = (command) => {
    if (!usableEditor || usableEditor.isDestroyed || !usableEditor.view?.dom?.isConnected) return;
    try {
      command(usableEditor);
    } catch {
      // An editor may be replaced between an input event and this callback.
      setActiveEditor(null);
    }
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
          <button className="open-journal-button" disabled={isOpening} onClick={() => {
              setIsOpening(true);
              window.setTimeout(() => {
                setIsOpen(true);
                setIsOpening(false);
                setIsJournalEntering(true);
                window.setTimeout(() => setIsJournalEntering(false), 1250);
              }, 950);
            }}>
            <span>{isOpening ? 'OPENING YOUR JOURNAL' : 'OPEN OUR JOURNAL'}</span><span className="button-arrow">↗</span>
          </button>
          <small>MADE FOR TWO · KEPT CLOSE</small>
        </div>
        <div className="cover-bottomline"><span>PARALY</span><span>JUST BETWEEN US</span><span>01 / ∞</span></div>
      </main>
    );
  }

  return (
    <main className={'journal-app' + (isJournalEntering ? ' journal-app--opening' : '')}>
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
          <button className="header-icon-button" title="Close journal" aria-label="Close journal" onClick={() => { setIsOpen(false); setIsJournalEntering(false); setSpread(0); setMobilePage(0); setTurnDirection('next'); }}>↙</button>
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
          <ToolButton label="B" title="Bold" active={!!isEditorActive('bold')} disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleBold().run())} />
          <ToolButton label={<em>I</em>} title="Italic" active={!!isEditorActive('italic')} disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleItalic().run())} />
          <ToolButton label={<span className="underlined-tool">U</span>} title="Underline" active={!!isEditorActive('underline')} disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleUnderline().run())} />
          <ToolButton label={<s>S</s>} title="Strikethrough" active={!!isEditorActive('strike')} disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleStrike().run())} />
          <span className="toolbar-divider" />
          <select title="Font family" aria-label="Font family" defaultValue="Cormorant Garamond" onChange={(event) => applyCommand((editor) => editor.chain().focus().setFontFamily(event.target.value).run())} disabled={!usableEditor}>
            <option value="Cormorant Garamond">Cormorant</option>
            <option value="Playfair Display">Playfair</option>
            <option value="Caveat">Handwritten</option>
            <option value="DM Sans">Sans</option>
            <option value="Georgia">Georgia</option>
          </select>
          <select title="Text size" aria-label="Text size" defaultValue="18px" onChange={(event) => applyCommand((editor) => editor.chain().focus().setFontSize(event.target.value).run())} disabled={!usableEditor}>
            <option value="13px">Small</option><option value="16px">Regular</option><option value="18px">Large</option><option value="24px">Title</option><option value="32px">Display</option>
          </select>
          <label className="color-tool" title="Text colour">A<input aria-label="Text colour" type="color" defaultValue="#334d67" disabled={!usableEditor} onChange={(event) => applyCommand((editor) => editor.chain().focus().setColor(event.target.value).run())} /></label>
          <label className="highlight-tool" title="Highlight colour">▰<input aria-label="Highlight colour" type="color" defaultValue="#f4df8a" disabled={!usableEditor} onChange={(event) => applyCommand((editor) => editor.chain().focus().setHighlight({ color: event.target.value }).run())} /></label>
          <ToolButton label="≡" title="Align left" disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().setTextAlign('left').run())} />
          <ToolButton label="☷" title="Bulleted list" disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().toggleBulletList().run())} />
          <ToolButton label="↶" title="Undo" disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().undo().run())} />
          <ToolButton label="↷" title="Redo" disabled={!usableEditor} onClick={() => applyCommand((editor) => editor.chain().focus().redo().run())} />
        </div>
        <div className="toolbar-group toolbar-paper" aria-label="Page appearance">
          <span className="paper-control-label">PAPER</span>
          <select
            title="Paper pattern"
            aria-label="Paper pattern"
            value={activePaperPattern}
            onChange={(event) => handlePaperStyleChange({ paperPattern: event.target.value })}
          >
            <option value="plain">Plain</option>
            <option value="ruled">Ruled lines</option>
            <option value="grid">Grid</option>
            <option value="dots">Dots</option>
          </select>
          <select
            title="Paper colour"
            aria-label="Paper colour"
            value={activePaperColor}
            onChange={(event) => handlePaperStyleChange({ paperColor: event.target.value })}
          >
            {PAPER_COLOR_PRESETS.map(([color, label]) => <option value={color} key={color}>{label}</option>)}
            {!PAPER_COLOR_PRESETS.some(([color]) => color === activePaperColor) && (
              <option value={activePaperColor}>Custom colour</option>
            )}
          </select>
          <label className="paper-color-tool" title="Choose a custom paper colour">
            <span aria-hidden="true" style={{ '--swatch-color': activePaperColor }} />
            <input
              type="color"
              aria-label="Custom paper colour"
              value={activePaperColor}
              onChange={(event) => handlePaperStyleChange({ paperColor: event.target.value })}
            />
          </label>
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

        <div className={'notebook-spread' + (isMobile ? ' notebook-spread--mobile' : '') + ' notebook-spread--turn-' + turnDirection} key={isMobile ? 'mobile' : 'desktop'}>
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
                  onObjectDelete={handleObjectDelete}
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