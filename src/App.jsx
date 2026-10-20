import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';

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

function PageObjects({ page, onObjectChange, pageRef }) {
  const dragRef = useRef(null);

  const beginDrag = (event, object) => {
    if (event.target.closest('textarea, input, button, [contenteditable="true"]')) return;
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
              <img src={object.src} alt={object.caption || 'A photograph in the journal'} draggable="false" />
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
  onContentChange,
  onObjectChange,
  onEditorFocus,
}) {
  const pageRef = useRef(null);
  const editor = useEditor(
    {
      extensions: EDITOR_EXTENSIONS,
      content: page.content,
      editorProps: {
        attributes: {
          class: 'page-editor',
          spellcheck: 'true',
          'aria-label': 'Editable journal page ' + pageNumber,
        },
      },
      onFocus: ({ editor: focusedEditor }) => onEditorFocus(page.id, focusedEditor),
      onUpdate: ({ editor: updatedEditor }) => onContentChange(page.id, updatedEditor.getHTML()),
    },
    [page.id, refreshKey],
  );

  useEffect(() => {
    if (editor && editor.getHTML() !== page.content && refreshKey > 0) {
      editor.commands.setContent(page.content, false);
    }
  }, [editor, page.content, refreshKey]);

  return (
    <section
      className={'paper-page' + (active ? ' paper-page--active' : '')}
      ref={pageRef}
      onClick={() => editor && onEditorFocus(page.id, editor)}
    >
      <div className="paper-grain" aria-hidden="true" />
      <div className="page-content">
        <EditorContent editor={editor} />
      </div>
      <PageObjects page={page} onObjectChange={onObjectChange} pageRef={pageRef} />
      <div className="page-footer">
        <span>{page.bookmarked ? '♡ SAVED' : 'P · A'}</span>
        <span>{String(pageNumber).padStart(3, '0')}</span>
      </div>
      <span className="page-edge-shadow" aria-hidden="true" />
    </section>
  );
}

function App() {
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
  const [saveState, setSaveState] = useState('Saved on this device');
  const [panel, setPanel] = useState('');
  const fileInputRef = useRef(null);
  const saveTimer = useRef(null);
  const versionTimer = useRef(null);

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
    const visibleIndex = isMobile ? mobilePage : Math.min(pages.length - 1, spread * 2 + 1);
    if (pages[visibleIndex]) setActivePageId(pages[visibleIndex].id);
  }, [isOpen, isMobile, mobilePage, spread, pages.length]);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    setSaveState('Saving…');
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(pages));
        setSaveState('Saved on this device');
      } catch {
        setSaveState('Could not save locally');
      }
    }, 550);
    return () => clearTimeout(saveTimer.current);
  }, [pages]);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    clearTimeout(versionTimer.current);
  }, []);

  const maxSpread = Math.max(0, Math.ceil(pages.length / 2) - 1);
  const visiblePages = useMemo(() => {
    if (isMobile) return [pages[mobilePage]].filter(Boolean);
    return [pages[spread * 2], pages[spread * 2 + 1]].filter(Boolean);
  }, [isMobile, mobilePage, pages, spread]);

  const activePage = pages.find((page) => page.id === activePageId) || visiblePages[visiblePages.length - 1] || pages[0];

  const handleContentChange = useCallback((id, html) => {
    const nextPages = pagesRef.current.map((page) => page.id === id ? { ...page, content: html, updatedAt: Date.now() } : page);
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
        id: String(Date.now()),
        pageId: id,
        title: snapshotPage.title,
        createdAt: Date.now(),
        content: snapshotPage.content,
        objects: snapshotPage.objects,
      }, ...previous].slice(0, 80);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory)); } catch { /* history is best-effort in local preview */ }
    }, 9000);
  }, []);

  const handleObjectChange = useCallback((pageId, objectId, patch) => {
    const nextPages = pagesRef.current.map((page) => page.id === pageId
      ? { ...page, updatedAt: Date.now(), objects: page.objects.map((object) => object.id === objectId ? { ...object, ...patch } : object) }
      : page);
    pagesRef.current = nextPages;
    setPages(nextPages);
  }, []);

  const addObjectToPage = (pageId, object) => {
    const nextPages = pagesRef.current.map((page) => page.id === pageId
      ? { ...page, updatedAt: Date.now(), objects: [...page.objects, object] }
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
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
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
    if (file.size > 12 * 1024 * 1024) {
      window.alert('That file is quite large for this local preview. Choose a photo under 12 MB.');
      return;
    }
    try {
      const src = await resizeImage(file);
      const pageId = currentPageId();
      const count = pagesRef.current.find((page) => page.id === pageId)?.objects.length || 0;
      addObjectToPage(pageId, {
        id: 'photo-' + Date.now(),
        type: 'photo',
        src,
        caption: '',
        frame: 'polaroid',
        left: 55,
        top: 52 + (count % 3) * 3,
        rotation: count % 2 ? 3 : -4,
      });
    } catch {
      window.alert('That image could not be opened. Try a JPG or PNG.');
    }
  };

  const toggleBookmark = () => {
    const id = currentPageId();
    const nextPages = pagesRef.current.map((page) => page.id === id ? { ...page, bookmarked: !page.bookmarked, updatedAt: Date.now() } : page);
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
              <img src={photo.src} alt={photo.caption || 'Journal photo'} />
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
          <button className="header-icon-button" title="Close journal" aria-label="Close journal" onClick={() => { setIsOpen(false); setSpread(0); setMobilePage(0); }}>↙</button>
        </div>
      </header>

      <div className="preview-banner">
        <span className="preview-banner-mark">i</span>
        <span><strong>Private preview</strong> — edits are saved on this device for now. Shared accounts, cloud sync, and cross-device history come next.</span>
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
          <div className="active-page-label"><span className="presence-dot" />{activePage?.title || 'Untitled page'} <span className="page-label-separator">/</span> {isMobile ? 'PAGE ' + (mobilePage + 1) : 'PAGES ' + (spread * 2 + 1) + '–' + Math.min(pages.length, spread * 2 + 2)}</div>
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