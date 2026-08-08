import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBDVkvQc1IF23evFTplvjVc072qNGn_J-Q',
  authDomain: 'carbon-e24f8.firebaseapp.com',
  projectId: 'carbon-e24f8',
  storageBucket: 'carbon-e24f8.firebasestorage.app',
  messagingSenderId: '9387095986',
  appId: '1:9387095986:web:2ac6e7c8800c44f2d4d6ab',
  measurementId: 'G-X5GPW6YJ4M',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth (over getAuth) lets us pick the persistence order explicitly.
// IndexedDB is the default, but on some browsers (private mode, Safari with
// aggressive storage partitioning, Chrome cross-origin popup contexts) it
// throws `Database is closing/hidden` mid-sign-in. The fallback chain keeps
// auth working: IndexedDB → localStorage → in-memory (session only).
export const auth: Auth =
  typeof window === 'undefined'
    ? (undefined as unknown as Auth)
    : initializeAuth(firebaseApp, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
      });

export const googleProvider = new GoogleAuthProvider();
// Force Google's own account chooser so the user can pick / add an account
// instead of getting silently signed in with whatever's cached.
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function loadAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined') return null;
  return (await isSupported()) ? getAnalytics(firebaseApp) : null;
}
