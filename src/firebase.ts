import { initializeApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import type { Auth } from 'firebase/auth';

// Firebase Web API keys are public by design — access is secured via Auth + Firestore Rules
const firebaseConfig = {
  apiKey: "AIzaSyCXSUOjVrUnQf14nfdRGEJmYh2Xx9DA-3c",
  authDomain: "venta-saco.firebaseapp.com",
  projectId: "venta-saco",
  storageBucket: "venta-saco.firebasestorage.app",
  messagingSenderId: "162304629577",
  appId: "1:162304629577:web:dae1f45eca1b3531a2d898",
};

let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _configured = false;

try {
  const app = initializeApp(firebaseConfig);
  _db = getFirestore(app);
  _auth = getAuth(app);
  _configured = true;
} catch (e) {
  console.error('Firebase init error:', e);
}

export const isFirebaseConfigured = _configured;
export const db = _db;
export const auth = _auth;
export const googleProvider = new GoogleAuthProvider();
