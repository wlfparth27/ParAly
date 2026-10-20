import { firebaseAuth } from '../firebase.js';

async function authHeaders() {
  const user = firebaseAuth?.currentUser;
  if (!user) throw new Error('Sign in to ParAly before uploading a photograph.');
  return { Authorization: 'Bearer ' + await user.getIdToken() };
}

async function uploadDriveAsset(file, kind, name) {
  const headers = await authHeaders();
  const sessionResponse = await fetch('/api/drive/session', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: file.type || 'image/jpeg',
      size: file.size,
      kind,
    }),
  });

  const sessionBody = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok) {
    throw new Error(sessionBody.error || 'ParAly could not prepare the secure photo upload.');
  }
  if (!sessionBody.uploadUrl) throw new Error('Google Drive did not return an upload session.');

  // The file body goes directly to the one-file Google Drive upload session, not
  // through Vercel. This avoids serverless request-size limits for original photos.
  const uploadResponse = await fetch(sessionBody.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error('The photograph did not finish uploading to Drive. Check the connection and try again.');
  }
  const uploaded = await uploadResponse.json().catch(() => ({}));
  if (!uploaded.id) throw new Error('Drive accepted the upload but did not return a file identifier.');
  return uploaded;
}

export async function uploadJournalPhoto(originalFile, previewBlob) {
  let preview;
  try {
    preview = await uploadDriveAsset(
      previewBlob,
      'preview',
      (originalFile.name || 'photograph') + '.preview.jpg',
    );
    const original = await uploadDriveAsset(
      originalFile,
      'original',
      originalFile.name || 'photograph',
    );

    return {
      drivePreviewFileId: preview.id,
      driveOriginalFileId: original.id,
      driveWebViewLink: original.webViewLink || 'https://drive.google.com/file/d/' + original.id + '/view',
      drivePreviewName: preview.name || '',
      driveOriginalName: original.name || '',
      src: '',
      localOnly: false,
    };
  } catch (error) {
    if (preview?.id) {
      deleteDrivePhoto(preview.id).catch(() => {});
    }
    throw error;
  }
}

export async function deleteDrivePhoto(fileId) {
  if (!fileId) return;
  const headers = await authHeaders();
  const response = await fetch('/api/drive/file?fileId=' + encodeURIComponent(fileId), {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error('ParAly could not remove a temporary Drive upload.');
  }
}

export async function fetchDrivePreview(fileId) {
  const headers = await authHeaders();
  const response = await fetch('/api/drive/image?fileId=' + encodeURIComponent(fileId), { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'This photo preview could not be loaded.');
  }
  return response.blob();
}
