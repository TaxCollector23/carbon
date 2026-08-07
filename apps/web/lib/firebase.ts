import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { GithubAuthProvider, GoogleAuthProvider, getAuth, type Auth } from 'firebase/auth';

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
export const auth: Auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

export async function loadAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined') return null;
  return (await isSupported()) ? getAnalytics(firebaseApp) : null;
}
