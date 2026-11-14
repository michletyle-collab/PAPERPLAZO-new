import { initializeFirebase, listenAuthState, isFirebaseConfigured } from '/shared/firebase.js';

const firebaseState = initializeFirebase();
if (!firebaseState) {
  console.warn('PAPERPLAZO customer Firebase is not enabled yet. Add Firebase web configuration to enable Auth and Firestore on the customer app.');
} else {
  listenAuthState((user) => {
    window.PAPERPLAZO_AUTH_USER = user ? { uid: user.uid, email: user.email } : null;
    window.dispatchEvent(new CustomEvent('paperplazo-auth-state', { detail: window.PAPERPLAZO_AUTH_USER }));
  });
}

window.PAPERPLAZO_FIREBASE = {
  initialized: Boolean(firebaseState),
  configured: isFirebaseConfigured(),
  authReady: Boolean(firebaseState)
};
