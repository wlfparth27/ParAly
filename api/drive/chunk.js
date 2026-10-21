import {
  ApiError,
  requireJournalMember,
  sendApiError,
} from '../../lib/server/driveAuth.js';

const MAX_CHUNK_BYTES = 512 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const DRIVE_UPLOAD_HOST = 'www.googleapis.com';
const DRIVE_UPLOAD_PATH = '/upload/drive/v3/files';

function validateUploadUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new ApiError(400, 'The Drive upload session is invalid. Please retry the photo upload.');
  }

  // Only proxy resumable sessions issued by the Drive files upload endpoint;
  // never turn this authenticated endpoint into a general-purpose URL proxy.
  if (
    url.protocol !== 'https:' ||
    url.hostname !== DRIVE_UPLOAD_HOST ||
    url.pathname !== DRIVE_UPLOAD_PATH ||
    url.searchParams.get('uploadType') !== 'resumable' ||
    !url.searchParams.has('upload_id')
  ) {
    throw new ApiError(400, 'The Drive upload session is invalid. Please retry the photo upload.');
  }
  return url.toString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    await requireJournalMember(req);

    const { uploadUrl, offset, totalSize, chunkBase64 } = req.body || {};
    const safeUploadUrl = validateUploadUrl(uploadUrl);
    const start = Number(offset);
    const total = Number(totalSize);

    if (!Number.isSafeInteger(start) || start < 0) {
      throw new ApiError(400, 'The photo upload position is invalid.');
    }
    if (!Number.isSafeInteger(total) || total < 1 || total > MAX_FILE_BYTES || start >= total) {
      throw new ApiError(400, 'The photo upload size is invalid.');
    }
    if (typeof chunkBase64 !== 'string' || chunkBase64.length > 710000) {
      throw new ApiError(413, 'The photo upload chunk is too large. Please retry the upload.');
    }

    const chunk = Buffer.from(chunkBase64, 'base64');
    if (chunk.length < 1 || chunk.length > MAX_CHUNK_BYTES || start + chunk.length > total) {
      throw new ApiError(400, 'The photo upload chunk is invalid.');
    }
    if (start + chunk.length < total && chunk.length % (256 * 1024) !== 0) {
      throw new ApiError(400, 'The photo upload chunk has an invalid size. Please retry the upload.');
    }

    const end = start + chunk.length - 1;
    let uploadResponse;
    try {
      uploadResponse = await fetch(safeUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
        },
        body: chunk,
      });
    } catch {
      throw new ApiError(502, 'The connection to Google Drive was interrupted during upload. Please try again.');
    }

    if (uploadResponse.status === 308) {
      const range = uploadResponse.headers.get('range') || '';
      const match = /^bytes=0-(\\d+)$/.exec(range);
      const nextOffset = match ? Number(match[1]) + 1 : start + chunk.length;
      return res.status(200).json({ complete: false, nextOffset });
    }

    if (!uploadResponse.ok) {
      let googleMessage = '';
      try {
        const body = await uploadResponse.json();
        googleMessage = String(body?.error?.message || '');
      } catch {
        // Do not expose arbitrary HTML or response text from the upstream host.
      }
      const status = uploadResponse.status;
      if (status === 401 || status === 403) {
        throw new ApiError(502, 'Google Drive rejected the upload session. Re-authorise the Drive account and update the Vercel refresh token.');
      }
      if (status === 404 || status === 410) {
        throw new ApiError(502, 'The Google Drive upload session expired. Please select the photograph and try again.');
      }
      if (status === 429) {
        throw new ApiError(429, 'Google Drive is temporarily rate-limiting uploads. Please wait and try again.');
      }
      throw new ApiError(502, googleMessage
        ? 'Google Drive could not accept this upload (' + status + '). ' + googleMessage.slice(0, 180)
        : 'Google Drive could not accept this upload (HTTP ' + status + ').');
    }

    let uploaded;
    try {
      uploaded = await uploadResponse.json();
    } catch {
      throw new ApiError(502, 'Google Drive finished the upload but returned invalid file details.');
    }
    if (!uploaded?.id) {
      throw new ApiError(502, 'Google Drive finished the upload but did not return a file ID.');
    }

    return res.status(200).json({
      complete: true,
      nextOffset: total,
      file: uploaded,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
