import { existsSync, readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { OAuth2Client } from 'google-auth-library';

let adminApp;
let oauthClient;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getAdminApp() {
  if (adminApp) return adminApp;
  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }

  let serviceAccount;
  try {
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (encoded) serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    else if (raw) serviceAccount = JSON.parse(raw);
    else if (keyPath && existsSync(keyPath)) serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    throw new ApiError(503, 'The server Firebase credentials are not configured correctly.');
  }

  if (!serviceAccount?.project_id || !serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new ApiError(503, 'The server Firebase credentials have not been configured.');
  }

  adminApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
    databaseURL: process.env.FIREBASE_DATABASE_URL
      || process.env.VITE_FIREBASE_DATABASE_URL
      || 'https://paraly-2bfb7-default-rtdb.asia-southeast1.firebasedatabase.app',
  }, 'paraly-drive-api');
  return adminApp;
}

function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, 'Please sign in to ParAly first.');
  return match[1];
}

/**
 * First-login invitation bootstrap. Only two addresses from the server-side
 * PARALY_MEMBER_EMAILS allowlist can be provisioned. The value must never be
 * placed in a VITE_* variable or shipped to the browser.
 */
export async function provisionJournalMember(req) {
  const app = getAdminApp();
  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(readBearerToken(req));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }

  const email = String(decoded.email || '').trim().toLowerCase();
  const allowedEmails = [...new Set(
    String(process.env.PARALY_MEMBER_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];

  if (!decoded.email_verified || !email || allowedEmails.length !== 2 || !allowedEmails.includes(email)) {
    throw new ApiError(403, 'This Google account is not one of the two invited ParAly members.');
  }

  const authUser = await getAuth(app).getUser(decoded.uid);
  const db = getFirestore(app);
  const memberRef = db.doc('journals/paraly/members/' + decoded.uid);
  const existing = await memberRef.get();
  if (!existing.exists) {
    await memberRef.set({
      uid: decoded.uid,
      email,
      displayName: authUser.displayName || email.split('@')[0],
      photoURL: authUser.photoURL || '',
      role: 'member',
      seededAt: FieldValue.serverTimestamp(),
    });
  }

  await getDatabase(app).ref('journals/paraly/members/' + decoded.uid).set(true);
  return { uid: decoded.uid, email };
}

export async function requireJournalMember(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, 'Please sign in to ParAly first.');

  const app = getAdminApp();
  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(match[1]);
  } catch {
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }

  const member = await getFirestore(app).doc('journals/paraly/members/' + decoded.uid).get();
  if (!member.exists) throw new ApiError(403, 'This Google account is not one of the two ParAly members.');

  return { uid: decoded.uid, email: decoded.email || '', decoded };
}

export async function getDriveAccessToken() {
  const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new ApiError(503, 'Google Drive uploads are not configured yet.');
  }

  if (!oauthClient) {
    oauthClient = new OAuth2Client(clientId, clientSecret);
    oauthClient.setCredentials({ refresh_token: refreshToken });
  }

  try {
    const { token } = await oauthClient.getAccessToken();
    if (!token) throw new Error('Missing access token');
    return token;
  } catch {
    throw new ApiError(503, 'ParAly could not access Google Drive. Check the Drive OAuth configuration.');
  }
}

export function getDriveFolderId() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new ApiError(503, 'The private ParAly folder has not been configured in Google Drive.');
  return folderId;
}

export function getDriveApiErrorMessage(status) {
  if (status === 401 || status === 403) {
    return 'Google Drive denied the request. Check the Drive API, OAuth permissions, and folder access.';
  }
  if (status === 404) return 'That ParAly photograph could not be found.';
  if (status === 429) return 'Google Drive is temporarily rate-limiting requests. Please try again shortly.';
  return 'Google Drive could not complete the request. Please try again.';
}

export function sendApiError(res, error) {
  const status = Number(error?.status) || 500;
  const message = error instanceof ApiError
    ? error.message
    : 'ParAly could not complete this secure storage request.';
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
}
