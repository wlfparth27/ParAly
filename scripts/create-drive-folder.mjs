import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OAuth2Client } from 'google-auth-library';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(resolve(process.cwd(), '.env.local'));

const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
const partnerEmail = process.env.PARALY_PARTNER_EMAIL?.trim().toLowerCase();

if (!clientId || !clientSecret || !refreshToken) {
  console.error('Set GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN in .env.local.');
  process.exit(1);
}
if (!partnerEmail || !partnerEmail.includes('@')) {
  console.error('Set PARALY_PARTNER_EMAIL to your girlfriend’s Google account email in .env.local.');
  process.exit(1);
}

const oauth = new OAuth2Client(clientId, clientSecret);
oauth.setCredentials({ refresh_token: refreshToken });
const { token } = await oauth.getAccessToken();
if (!token) throw new Error('Google did not provide an access token.');

async function driveRequest(path, options = {}) {
  const response = await fetch('https://www.googleapis.com/drive/v3' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error('Drive API request failed (' + response.status + '): ' + detail.slice(0, 500));
  }
  if (response.status === 204) return null;
  return response.json();
}

const folderName = 'ParAly Journal Photos';
const search = new URLSearchParams({
  q: "name = '" + folderName + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  fields: 'files(id,name,webViewLink)',
  pageSize: '100',
  spaces: 'drive',
});
const found = await driveRequest('/files?' + search.toString());
let folder = found.files?.[0];

if (!folder) {
  folder = await driveRequest('/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Private image assets for the ParAly shared journal.',
    }),
  });
  console.log('Created a dedicated ParAly photo folder in your Google Drive.');
} else {
  console.log('Reusing the ParAly photo folder previously created by this OAuth app.');
}

const permissionsQuery = new URLSearchParams({ fields: 'permissions(id,emailAddress,role,type)' });
const permissionData = await driveRequest('/files/' + encodeURIComponent(folder.id) + '/permissions?' + permissionsQuery.toString());
const existing = (permissionData.permissions || []).find((permission) =>
  String(permission.emailAddress || '').toLowerCase() === partnerEmail
);

if (!existing) {
  await driveRequest('/files/' + encodeURIComponent(folder.id) + '/permissions?sendNotificationEmail=false&fields=id,emailAddress,role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: partnerEmail }),
  });
  console.log('Shared the photo folder with the second journal member as a viewer.');
} else {
  console.log('The second journal member already has access to the photo folder.');
}

console.log('\nAdd this non-secret folder ID to .env.local and your Vercel environment:');
console.log('GOOGLE_DRIVE_FOLDER_ID=' + folder.id);
console.log('\nOnly files created in this dedicated folder by the ParAly app will be used for journal photos.');
