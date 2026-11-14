import { getDbInstance, collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot } from './firebase.js';

export const databaseApi = {
  async setDocument(collectionName, documentId, payload) {
    const dbInstance = getDbInstance();
    if (!dbInstance) return null;
    const ref = doc(dbInstance, collectionName, documentId);
    await setDoc(ref, payload, { merge: true });
    return ref;
  },

  async getDocument(collectionName, documentId) {
    const dbInstance = getDbInstance();
    if (!dbInstance) return null;
    const snapshot = await getDoc(doc(dbInstance, collectionName, documentId));
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() };
  },

  async updateDocument(collectionName, documentId, payload) {
    const dbInstance = getDbInstance();
    if (!dbInstance) return null;
    await updateDoc(doc(dbInstance, collectionName, documentId), payload);
    return true;
  },

  async deleteDocument(collectionName, documentId) {
    const dbInstance = getDbInstance();
    if (!dbInstance) return null;
    await deleteDoc(doc(dbInstance, collectionName, documentId));
    return true;
  },

  listenToCollection(collectionName, callback) {
    const dbInstance = getDbInstance();
    if (!dbInstance || typeof callback !== 'function') return () => {};
    return onSnapshot(collection(dbInstance, collectionName), snapshot => {
      callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
    });
  }
};

export default databaseApi;
