import { getDbInstance, collection, doc, addDoc, updateDoc, onSnapshot, query, where, orderBy, serverTimestamp } from './firebase.js';

export const ordersApi = {
  listenToCustomerOrders(uid, callback) {
    const dbInstance = getDbInstance();
    if (!dbInstance || typeof callback !== 'function') return () => {};
    const q = query(collection(dbInstance, 'orders'), where('customerUid', '==', uid), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snapshot => {
      callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
    });
  },

  listenToAllOrders(callback) {
    const dbInstance = getDbInstance();
    if (!dbInstance || typeof callback !== 'function') return () => {};
    const q = query(collection(dbInstance, 'orders'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snapshot => {
      callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
    });
  },

  async createOrder(orderPayload) {
    const dbInstance = getDbInstance();
    if (!dbInstance) {
      throw new Error('Firebase is not configured. Add the Firebase web config before enabling live orders.');
    }

    const payload = {
      ...orderPayload,
      status: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const ref = await addDoc(collection(dbInstance, 'orders'), payload);
    return { id: ref.id, ...payload };
  },

  async updateOrderStatus(orderId, status) {
    const dbInstance = getDbInstance();
    if (!dbInstance) return null;
    await updateDoc(doc(dbInstance, 'orders', orderId), {
      status,
      updatedAt: serverTimestamp()
    });
    return true;
  }
};

export default ordersApi;
