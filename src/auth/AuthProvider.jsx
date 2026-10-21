import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from '../firebase.js';

const AuthContext = createContext(null);
const allowedEmails = (import.meta.env.VITE_ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseAuth) return undefined;

    return onAuthStateChanged(firebaseAuth, async (candidate) => {
      if (!candidate) {
        setUser(null);
        setLoading(false);
        return;
      }

      const email = candidate.email?.toLowerCase() || '';
      if (allowedEmails.length >= 2 && !allowedEmails.includes(email)) {
        try {
          await firebaseSignOut(firebaseAuth);
        } catch {
          // Access stays denied even if the sign-out request cannot finish immediately.
        }
        setUser(null);
        setError('This Google account is not on the journal invitation list.');
        setLoading(false);
        return;
      }

      // In deployed builds, the server provisions an approved account after the
      // owner signs in for the first time. This means a surprise recipient does
      // not need to sign in during setup. The server-only allowlist and Admin SDK
      // credentials are never exposed in the browser bundle.
      if (import.meta.env.PROD) {
        try {
          const token = await candidate.getIdToken();
          const response = await fetch('/api/auth/provision', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result.error || 'This Google account is not invited to the journal.');
          }
        } catch (provisionError) {
          try {
            await firebaseSignOut(firebaseAuth);
          } catch {
            // The database rules still block unprovisioned accounts.
          }
          setUser(null);
          setError(provisionError?.message || 'ParAly could not verify journal access. Please try again.');
          setLoading(false);
          return;
        }
      }

      setUser(candidate);
      setError('');
      setLoading(false);
    });
  }, []);

  const value = useMemo(() => ({
    configured: isFirebaseConfigured,
    loading,
    user,
    error,
    allowedAccountCount: allowedEmails.length,
    async signInWithGoogle() {
      setError('');
      if (!firebaseAuth) {
        setError('Firebase is not configured yet. Add the VITE_FIREBASE_* values to your local environment.');
        return;
      }
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(firebaseAuth, provider);
      } catch (signInError) {
        if (signInError?.code === 'auth/popup-closed-by-user') return;
        if (signInError?.code === 'auth/unauthorized-domain') {
          setError('This website domain is not authorised in Firebase Authentication settings yet.');
          return;
        }
        setError('Google sign-in could not be completed. Check Firebase Authentication settings and try again.');
      }
    },
    async signOut() {
      if (firebaseAuth) await firebaseSignOut(firebaseAuth);
    },
  }), [loading, user, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
