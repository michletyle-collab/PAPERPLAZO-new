import { getDbInstance, collection, onSnapshot, orderBy, query, where } from './firebase.js';

export const productsApi = {
  listenToActiveProducts(callback, onError = () => {}) {
    const dbInstance = getDbInstance();
    if (!dbInstance || typeof callback !== 'function') return () => {};
    const productsQuery = query(
      collection(dbInstance, 'products'),
      where('isActive', '==', true),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(productsQuery, snapshot => {
      callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
    }, onError);
  },

  listenToProducts(callback, onError = () => {}) {
    const dbInstance = getDbInstance();
    if (!dbInstance || typeof callback !== 'function') return () => {};
    const productsQuery = query(collection(dbInstance, 'products'), orderBy('createdAt', 'desc'));
    return onSnapshot(productsQuery, snapshot => {
      callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
    }, onError);
  }
};

export default productsApi;