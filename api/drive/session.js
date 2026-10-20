import { getDriveAccessToken, getDriveFolderId, requireJournalMember, sendApiError, getDriveApiErrorMessage, ApiError } from '../../lib/server/driveAuth.js';

const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 1500 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif',
]);

function safeFileName(input) {
  const cleaned = String(input || 'photograph')
    .normalize('NFKC')
    .replace(/[\\/\\?%*:|"<>\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'photograph';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const member = await requireJournalMember(req);
    const { name, mimeType, size, kind } = req.body || {};
    const byteSize = Number(size);

    if (!ALLOWED_IMAGE_TYPES.has(String(mimeType || '').toLowerCase())) {
      throw new ApiError(415, 'Please upload a supported photograph format (JPG, PNG, WEBP, HEIC, or AVIF).');
    }
    if (!Number.isFinite(byteSize) || byteSize < 1) {
      throw new ApiError(400, 'The photo file size is missing or invalid.');
    }
    if (kind !== 'original' && kind !== 'preview') {
      throw new ApiError(400, 'The photo upload type is invalid.');
    }
    const maxBytes = kind === 'preview' ? MAX_PREVIEW_BYTES : MAX_ORIGINAL_BYTES;
    if (byteSize > maxBytes) {
      throw new ApiError(413, kind === 'preview'
        ? 'The generated preview is too large. Try a smaller photo.'
        : 'This photo is larger than ParAly currently accepts (100 MB).');
    }

    const accessToken = await getDriveAccessToken();
    const folderId = getDriveFolderId();
    const suffix = kind === 'preview' ? 'Preview' : 'Original';
    const fileName = 'ParAly - ' + suffix + ' - ' + safeFileName(name);
    const metadata = {
      name: fileName,
      mimeType,
      parents: [folderId],
      description: 'Private photo used by the ParAly shared journal.',
      appProperties: {
        paraly: 'true',
        journal: 'paraly',
        kind,
        uploaderUid: member.uid,
      },
    };

    const uploadResponse = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,parents,appProperties',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(byteSize),
        },
        body: JSON.stringify(metadata),
      },
    );

    if (!uploadResponse.ok) {
      throw new ApiError(
        uploadResponse.status === 429 ? 429 : 502,
        getDriveApiErrorMessage(uploadResponse.status),
      );
    }

    const uploadUrl = uploadResponse.headers.get('location');
    if (!uploadUrl || !uploadUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      throw new ApiError(502, 'Google Drive did not return a valid upload session.');
    }

    // This URL grants permission to upload the one pending file. Do not log it or store it.
    return res.status(200).json({ uploadUrl, maxBytes });
  } catch (error) {
    return sendApiError(res, error);
  }
}
