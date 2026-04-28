import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Firebase Web API keys are public by design — security is enforced by Firestore Rules
const firebaseConfig = {
  apiKey: "AIzaSyCXSUOjVrUnQf14nfdRGEJmYh2Xx9DA-3c",
  authDomain: "venta-saco.firebaseapp.com",
  projectId: "venta-saco",
  storageBucket: "venta-saco.firebasestorage.app",
  messagingSenderId: "162304629577",
  appId: "1:162304629577:web:dae1f45eca1b3531a2d898",
};

initializeApp(firebaseConfig);

export const isFirebaseConfigured = true;
export const db = getFirestore();
