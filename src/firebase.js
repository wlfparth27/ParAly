import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const env = import.meta.env;

// Firebase web configuration identifies this app/project; authorization is enforced
// by Firebase Authentication and database Security Rules. Environment values may
// override these public defaults for local preview deployments or separate projects.
const publicConfig = {
  apiKey: 'AIzaSyAk-0jHz3UckWsAFJjZd3IFpS_Ks8DzeDg',
  authDomain: 'paraly-2bfb7.firebaseapp.com',
  projectId: 'paraly-2bfb7',
  storageBucket: 'paraly-2bfb7.firebasestorage.app',
  messagingSenderId: '260846591273',
  appId: '1:260846591273:web:cacc84500dc4e0eaf12b38',
};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || publicConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || publicConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || publicConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || publicConfig.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || publicConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || publicConfig.appId,
  // Supplied from the existing asia-southeast1 Realtime Database. An environment
  // override is still supported for local/preview deployments using another project.
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || 'https://paraly-2bfb7-default-rtdb.asia-southeast1.firebasedatabase.app',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);

export const firebaseApp = isFirebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const firebaseDb = firebaseApp ? getFirestore(firebaseApp) : null;
export const firebaseRealtimeDb = firebaseApp && firebaseConfig.databaseURL
  ? getDatabase(firebaseApp, firebaseConfig.databaseURL)
  : null;
