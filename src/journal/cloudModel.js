export function serializePhotoForCloud(object) {
  if (object?.type === 'photo' && typeof object.src === 'string' && object.src.startsWith('data:')) {
    // Photo bytes belong in Drive, never in a Firestore page document.
    return { ...object, src: '', localOnly: true };
  }
  return object;
}

export function serializePageForCloud(page, order, user) {
  return {
    id: Number(page.id),
    order,
    title: page.title || 'Untitled page',
    content: page.content || '<p></p>',
    objects: Array.isArray(page.objects) ? page.objects.map(serializePhotoForCloud) : [],
    bookmarked: Boolean(page.bookmarked),
    paperColor: /^#[0-9a-f]{6}$/i.test(page.paperColor || '') ? page.paperColor : '#f4f0e6',
    paperPattern: ['plain', 'ruled', 'grid', 'dots'].includes(page.paperPattern) ? page.paperPattern : 'plain',
    updatedAt: Number(page.updatedAt) || Date.now(),
    updatedBy: page.updatedBy || user?.uid || '',
    updatedByName: page.updatedByName || user?.displayName || user?.email || 'A journal member',
  };
}

export function hydratePageFromCloud(data, localPages = []) {
  const localPage = localPages.find((page) => Number(page.id) === Number(data.id));
  const localObjects = new Map((localPage?.objects || []).map((object) => [object.id, object]));
  const objects = (Array.isArray(data.objects) ? data.objects : []).map((object) => {
    const localObject = localObjects.get(object.id);
    if (object.type === 'photo' && !object.src && localObject?.src?.startsWith('data:')) {
      return { ...object, src: localObject.src, localOnly: true };
    }
    return object;
  });
  return {
    id: Number(data.id),
    title: data.title || 'Untitled page',
    content: data.content || '<p></p>',
    objects,
    bookmarked: Boolean(data.bookmarked),
    paperColor: /^#[0-9a-f]{6}$/i.test(data.paperColor || '') ? data.paperColor : '#f4f0e6',
    paperPattern: ['plain', 'ruled', 'grid', 'dots'].includes(data.paperPattern) ? data.paperPattern : 'plain',
    updatedAt: Number(data.updatedAt) || Date.now(),
    updatedBy: data.updatedBy || '',
    updatedByName: data.updatedByName || '',
    order: Number(data.order) || 0,
  };
}

export function serializeVersionForCloud(version, user) {
  return {
    id: String(version.id),
    pageId: Number(version.pageId),
    title: version.title || 'Untitled page',
    createdAt: Number(version.createdAt) || Date.now(),
    content: version.content || '<p></p>',
    objects: Array.isArray(version.objects) ? version.objects.map(serializePhotoForCloud) : [],
    createdBy: user?.uid || '',
    createdByName: user?.displayName || user?.email || 'A journal member',
  };
}

export function stableJson(value) {
  return JSON.stringify(value);
}
