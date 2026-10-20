import { getDriveAccessToken, getDriveFolderId, requireJournalMember, sendApiError, getDriveApiErrorMessage, ApiError } from '../../lib/server/driveAuth.js';

const MAX_PREVIEW_BYTES = 1500 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    await requireJournalMember(req);
    const fileId = String(req.query?.fileId || '');
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) {
      throw new ApiError(400, 'The photograph identifier is invalid.');
    }

    const token = await getDriveAccessToken();
    const folderId = getDriveFolderId();
    const metadataResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId)
        + '?fields=id,name,mimeType,size,parents,appProperties',
      { headers: { Authorization: 'Bearer ' + token } },
    );

    if (!metadataResponse.ok) {
      if (metadataResponse.status === 404) throw new ApiError(404, 'That photograph could not be found.');
      throw new ApiError(502, getDriveApiErrorMessage(metadataResponse.status));
    }

    const file = await metadataResponse.json();
    const parents = Array.isArray(file.parents) ? file.parents : [];
    if (
      file.appProperties?.paraly !== 'true' ||
      file.appProperties?.kind !== 'preview' ||
      !parents.includes(folderId) ||
      !String(file.mimeType || '').startsWith('image/')
    ) {
      throw new ApiError(404, 'That photograph is not available in this journal.');
    }

    const size = Number(file.size || 0);
    if (size > MAX_PREVIEW_BYTES) {
      throw new ApiError(413, 'This preview is unexpectedly large. Re-upload the photograph to regenerate it.');
    }

    const mediaResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media',
      { headers: { Authorization: 'Bearer ' + token } },
    );
    if (!mediaResponse.ok) {
      throw new ApiError(mediaResponse.status === 404 ? 404 : 502, getDriveApiErrorMessage(mediaResponse.status));
    }

    const bytes = Buffer.from(await mediaResponse.arrayBuffer());
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).end(bytes);
  } catch (error) {
    return sendApiError(res, error);
  }
}
