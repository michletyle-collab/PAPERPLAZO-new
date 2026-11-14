import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyCjpB6rrwroNhmGCHe0aBUgkZdz6y1RAG8',
  authDomain: 'paperplazo.firebaseapp.com',
  projectId: 'paperplazo',
  storageBucket: 'paperplazo.firebasestorage.app',
  messagingSenderId: '480576692274',
  appId: '1:480576692274:web:658767f317e7ae2a241c2b',
  measurementId: 'G-CLL9E4CS4D'
};

const FIREBASE_CONFIG = {
  ...DEFAULT_CONFIG,
  ...(window.PAPERPLAZO_FIREBASE_CONFIG || {})
};

const isPlaceholderValue = value => typeof value !== 'string' || value.includes('PASTE_') || value.trim() === '';

export const firebaseConfig = FIREBASE_CONFIG;

export const isFirebaseConfigured = () => {
  if (!FIREBASE_CONFIG.projectId || FIREBASE_CONFIG.projectId === 'paperplazo') {
    return !isPlaceholderValue(FIREBASE_CONFIG.apiKey) && !isPlaceholderValue(FIREBASE_CONFIG.appId);
  }
  return !isPlaceholderValue(FIREBASE_CONFIG.apiKey) && !isPlaceholderValue(FIREBASE_CONFIG.appId) && !isPlaceholderValue(FIREBASE_CONFIG.projectId);
};

let firebaseApp;
let auth;
let db;
let analytics;

export const initializeFirebase = () => {
  if (firebaseApp) return { app: firebaseApp, auth, db, analytics };
  if (!isFirebaseConfigured()) {
    console.warn('PAPERPLAZO Firebase is not configured yet. Copy values from Firebase Console into the app config or .env.example before enabling live auth and Firestore.');
    return null;
  }

  firebaseApp = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  analytics = getAnalytics(firebaseApp);
  return { app: firebaseApp, auth, db, analytics };
};

export const getAuthInstance = () => {
  if (!auth) {
    const ready = initializeFirebase();
    if (!ready) return null;
    return ready.auth;
  }
  return auth;
};

export const getDbInstance = () => {
  if (!db) {
    const ready = initializeFirebase();
    if (!ready) return null;
    return ready.db;
  }
  return db;
};

export const getCurrentUser = () => getAuthInstance()?.currentUser ?? null;

export const listenAuthState = callback => {
  const authInstance = getAuthInstance();
  if (!authInstance || typeof callback !== 'function') return () => {};
  return onAuthStateChanged(authInstance, callback);
};

export const createProfile = async (uid, userData) => {
  const dbInstance = getDbInstance();
  if (!dbInstance || !uid) return null;
  const payload = {
    uid,
    name: userData?.name || 'PAPERPLAZO user',
    email: userData?.email || '',
    role: userData?.role || 'customer',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = doc(dbInstance, 'users', uid);
  await setDoc(ref, payload, { merge: true });
  return payload;
};

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp
};
