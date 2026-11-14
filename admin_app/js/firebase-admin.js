import { initializeFirebase, listenAuthState, isFirebaseConfigured } from '/shared/firebase.js';

const firebaseState = initializeFirebase();
if (!firebaseState) {
  console.warn('PAPERPLAZO admin Firebase is not enabled yet. Add Firebase web configuration to enable Auth and Firestore on the admin app.');
} else {
  listenAuthState((user) => {
    window.PAPERPLAZO_ADMIN_AUTH_USER = user ? { uid: user.uid, email: user.email } : null;
    window.dispatchEvent(new CustomEvent('paperplazo-admin-auth-state', { detail: window.PAPERPLAZO_ADMIN_AUTH_USER }));
  });
}

window.PAPERPLAZO_ADMIN_FIREBASE = {
  initialized: Boolean(firebaseState),
  configured: isFirebaseConfigured(),
  authReady: Boolean(firebaseState)
};
