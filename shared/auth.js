import {
  getAuthInstance,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  createProfile,
  getCurrentUser,
  listenAuthState
} from './firebase.js';

export const authApi = {
  async registerCustomer({ name, email, password }) {
    const authInstance = getAuthInstance();
    if (!authInstance) {
      throw new Error('Firebase is not configured. Add the Firebase web config before enabling authentication.');
    }

    const userCredential = await createUserWithEmailAndPassword(authInstance, email, password);
    await createProfile(userCredential.user.uid, { name, email, role: 'customer' });
    return userCredential.user;
  },

  async loginCustomer(email, password) {
    const authInstance = getAuthInstance();
    if (!authInstance) {
      throw new Error('Firebase is not configured. Add the Firebase web config before enabling authentication.');
    }
    return signInWithEmailAndPassword(authInstance, email, password);
  },

  async logout() {
    const authInstance = getAuthInstance();
    if (!authInstance) return;
    await signOut(authInstance);
  },

  async resetPassword(email) {
    const authInstance = getAuthInstance();
    if (!authInstance) {
      throw new Error('Firebase is not configured. Add the Firebase web config before enabling authentication.');
    }
    await sendPasswordResetEmail(authInstance, email);
  },

  getCurrentUser,
  listenAuthState
};

export default authApi;
