import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
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

const rawEmails = process.env.PARALY_MEMBER_EMAILS || process.env.VITE_ALLOWED_EMAILS || '';
const emails = [...new Set(rawEmails.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))];
const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const databaseURL = process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL;

if (emails.length !== 2) {
  console.error('Set PARALY_MEMBER_EMAILS to exactly two comma-separated Google account email addresses in .env.local.');
  process.exit(1);
}
if (!projectId) {
  console.error('Set VITE_FIREBASE_PROJECT_ID in .env.local.');
  process.exit(1);
}
if (!databaseURL) {
  console.error('Set VITE_FIREBASE_DATABASE_URL (or FIREBASE_DATABASE_URL) in .env.local after creating Realtime Database.');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the local path of a Firebase service-account JSON file. Never commit that file.');
  process.exit(1);
}

const { applicationDefault, initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const { getDatabase } = await import('firebase-admin/database');

const app = initializeApp({
  credential: applicationDefault(),
  projectId,
  databaseURL,
});
const auth = getAuth(app);
const firestore = getFirestore(app);
const realtimeDatabase = getDatabase(app);

const members = [];
for (const email of emails) {
  try {
    const user = await auth.getUserByEmail(email);
    members.push({
      uid: user.uid,
      email,
      displayName: user.displayName || email.split('@')[0],
      photoURL: user.photoURL || '',
    });
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      console.error('No Firebase Authentication user exists for ' + email + '. Sign in once with that Google account first, then run this script again.');
      process.exitCode = 1;
      process.exit();
    }
    throw error;
  }
}

const batch = firestore.batch();
for (const member of members) {
  const memberRef = firestore.doc('journals/paraly/members/' + member.uid);
  batch.set(memberRef, {
    uid: member.uid,
    email: member.email,
    displayName: member.displayName,
    photoURL: member.photoURL,
    role: 'member',
    seededAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
await batch.commit();

const memberFlags = Object.fromEntries(members.map((member) => [member.uid, true]));
await realtimeDatabase.ref('journals/paraly/members').update(memberFlags);

console.log('ParAly membership seeded successfully:');
for (const member of members) console.log(' - ' + member.displayName + ' (' + member.email + ')');
console.log('You can now load the shared journal with the two invited accounts.');
await app.delete();
