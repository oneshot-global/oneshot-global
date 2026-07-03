import { Firestore } from '@google-cloud/firestore';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim());

// key.jsonの中身を直接ここに貼り付けるか、
// もしくは最も確実な「自動認証」に切り替えます
const firestore = new Firestore({
projectId: 'oneshot-rebuild',
databaseId: '(default)'
});

const usersCol = firestore.collection('users');
const eventsCol = firestore.collection('processedEvents');

// --- 以下、メソッド類 ---

export const addUsageHistory = async (subId) => {
const userRef = usersCol.doc(subId);
const doc = await userRef.get();
const now = new Date().toISOString();
if (!doc.exists) {
await userRef.set({ history: [now], isPremium: false, premiumSince: null, errorCount: 0, lastErrorTime: null }, { merge: true });
} else {
const data = doc.data();
const newHistory = [...(data.history || []), now];
await userRef.update({ history: newHistory });
}
};

export const getUserStatus = async (subId) => {
try {
const userRef = usersCol.doc(subId);
const doc = await userRef.get();
if (!doc.exists) {
const initialData = { history: [], isPremium: false, premiumSince: null, errorCount: 0, lastErrorTime: null, isBanned: false };
await userRef.set(initialData);
return initialData;
}
return doc.data();
} catch (e) {
console.error("DB GET ERROR:", e);
return { history: [], isPremium: false, premiumSince: null, errorCount: 0, isBanned: false };
}
};

export const incrementErrorCount = async (subId, limit = 10) => {
const userRef = usersCol.doc(subId);
const doc = await userRef.get();
const now = new Date().toISOString();
if (!doc.exists) {
const newCount = 1;
const isBanned = newCount >= limit;
await userRef.set({ errorCount: newCount, lastErrorTime: now, isBanned: isBanned }, { merge: true });
return newCount;
} else {
const data = doc.data();
const newCount = (data.errorCount || 0) + 1;
const isBanned = newCount >= limit; 
await userRef.update({ 
errorCount: newCount, 
lastErrorTime: now,
isBanned: isBanned
});
return newCount;
}
};

export const resetErrorCount = async (subId) => {
const userRef = usersCol.doc(subId);
await userRef.update({ errorCount: 0 });
};

export const upgradeToPremium = async (subId, newSubscriptionId = null) => {
const userRef = usersCol.doc(subId);
const now = new Date().toISOString();

// 重複課金防止ロジックの追加
if (newSubscriptionId) {
try {
// 1. subIdによる検索 (既存)
const search = await stripe.customers.search({
query: `metadata['subId']:'${subId}'`,
});
let customers = search.data;

// 2. 検索で見つからない場合の全件リスト照合 (名寄せの補完)
if (customers.length === 0) {
const list = await stripe.customers.list({ limit: 100 });
customers = list.data.filter(c => c.metadata && c.metadata.subId === subId);
}

for (const customer of customers) {
const subscriptions = await stripe.subscriptions.list({
customer: customer.id,
status: 'active',
});
for (const sub of subscriptions.data) {
// 今回の新サブスク以外、または同一subIdを持つ別顧客のサブスクをすべて解除
// 文字列としての比較を確実にするため、明示的なIDチェックを維持
if (newSubscriptionId && sub.id !== newSubscriptionId) {
await stripe.subscriptions.cancel(sub.id);
console.log(`Cancelled previous subscription: ${sub.id} for customer: ${customer.id}`);
}
}
}
} catch (e) {
console.error("Stripe cleanup error:", e);
}
}

await userRef.set({ isPremium: true, premiumSince: now }, { merge: true });
};

export const saveRefreshToken = async (subId, refreshToken) => {
const userRef = usersCol.doc(subId);
await userRef.set({ refreshToken }, { merge: true });
};

export const getRefreshToken = async (subId) => {
try {
const doc = await usersCol.doc(subId).get();
if (!doc.exists) return null;
return doc.data().refreshToken || null;
} catch (e) {
console.error("DB REFRESH TOKEN ERROR:", e);
return null;
}
};

export const checkAndRecordStripeEvent = async (eventId) => {
  const eventRef = eventsCol.doc(eventId);
  return await firestore.runTransaction(async (t) => {
    const doc = await t.get(eventRef);
    if (doc.exists) return true;
    t.set(eventRef, { processedAt: new Date().toISOString() });
    return false;
  });
};