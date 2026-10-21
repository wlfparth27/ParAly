import { firebaseAuth } from '../firebase.js';

async function authHeaders() {
  const user = firebaseAuth?.currentUser;
  if (!user) throw new Error('Sign in to ParAly before uploading a photograph.');
  return { Authorization: 'Bearer ' + await user.getIdToken() };
}

const DRIVE_UPLOAD_CHUNK_BYTES = 512 * 1024;

function encodeBase64(bytes) {
  // Avoid spreading a whole 512 KB array into one function call (argument limits
  // vary by browser). The smaller slices are safely below those limits.
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

async function uploadDriveAsset(file, kind, name) {
  let sessionResponse;
  try {
    sessionResponse = await fetch('/api/drive/session', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: file.type || 'image/jpeg',
        size: file.size,
        kind,
      }),
    });
  } catch {
    throw new Error('ParAly could not reach its secure photo-upload API. Reload the journal and try again.');
  }

  const sessionBody = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok) {
    throw new Error(sessionBody.error || 'ParAly could not prepare the secure photo upload.');
  }
  if (!sessionBody.uploadUrl) throw new Error('Google Drive did not return an upload session.');

  // Upload in 512 KB chunks through our authenticated Vercel API. This avoids
  // browser CORS failures when PUT-ing directly to Google's resumable-session
  // URL. Each binary chunk is base64 encoded below 1 MB for the function API.
  let offset = 0;
  while (offset < file.size) {
    const blob = file.slice(offset, Math.min(offset + DRIVE_UPLOAD_CHUNK_BYTES, file.size));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkBase64 = encodeBase64(bytes);

    let response;
    try {
      response = await fetch('/api/drive/chunk', {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadUrl: sessionBody.uploadUrl,
          offset,
          totalSize: file.size,
          chunkBase64,
        }),
      });
    } catch {
      throw new Error('The secure photo upload connection was interrupted. Please try uploading the photograph again.');
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'ParAly could not upload this part of the photograph.');
    }

    if (result.complete) {
      if (!result.file?.id) throw new Error('Google Drive finished uploading but returned no file ID.');
      return result.file;
    }

    const nextOffset = Number(result.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > file.size) {
      throw new Error('Google Drive returned an invalid upload position. Please try again.');
    }
    offset = nextOffset;
  }

  throw new Error('The photo upload ended before Google Drive confirmed the file. Please try again.');
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
