import { getDriveAccessToken, getDriveFolderId, requireJournalMember, sendApiError, getDriveApiErrorMessage, ApiError } from '../../lib/server/driveAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
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
        + '?fields=id,parents,appProperties',
      { headers: { Authorization: 'Bearer ' + token } },
    );

    if (!metadataResponse.ok) {
      if (metadataResponse.status === 404) return res.status(204).end();
      throw new ApiError(502, getDriveApiErrorMessage(metadataResponse.status));
    }

    const file = await metadataResponse.json();
    const parents = Array.isArray(file.parents) ? file.parents : [];
    if (file.appProperties?.paraly !== 'true' || !parents.includes(folderId)) {
      throw new ApiError(404, 'That file is not managed by ParAly.');
    }

    const deleteResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId),
      { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      throw new ApiError(502, getDriveApiErrorMessage(deleteResponse.status));
    }
    return res.status(204).end();
  } catch (error) {
    return sendApiError(res, error);
  }
}
