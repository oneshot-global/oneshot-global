import { Firestore } from '@google-cloud/firestore';

// グリッド（月間予定表）機能専用のDBモジュール。
// db.js は Stripe 課金ロジックを含むため変更せず、ここに分離している。
// 保存先は同じ users コレクションの同一ドキュメント（merge 書き込みのみ）。
const firestore = new Firestore({
  projectId: 'oneshot-rebuild',
  databaseId: '(default)'
});

const usersCol = firestore.collection('users');
const batchesCol = firestore.collection('gridBatches');

// ユーザーが前回選択したクラス列名の配列を返す（未保存なら null）
export const getGridClassPrefs = async (subId) => {
  try {
    const doc = await usersCol.doc(subId).get();
    if (!doc.exists) return null;
    const prefs = doc.data().gridClassPrefs;
    return Array.isArray(prefs) && prefs.length > 0 ? prefs : null;
  } catch (e) {
    console.error('DB GRID PREFS GET ERROR:', e);
    return null;
  }
};

// 一括登録バッチ（取り消し用）。登録したカレンダーイベントIDをbatchIdに紐づけて一時保存する。
// expireAt はFirestoreコンソールでTTLポリシーを設定すれば自動削除に使えるフィールド（未設定でも動作に影響なし）。
export const saveGridBatch = async (subId, batchId, eventIds) => {
  await batchesCol.doc(batchId).set({
    subId: subId,
    eventIds: eventIds,
    createdAt: new Date().toISOString(),
    expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
};

export const getGridBatch = async (batchId) => {
  const doc = await batchesCol.doc(batchId).get();
  return doc.exists ? doc.data() : null;
};

export const deleteGridBatch = async (batchId) => {
  await batchesCol.doc(batchId).delete();
};

// クラス列の選択結果を保存（園によって列名は自由文字列）
export const saveGridClassPrefs = async (subId, classes) => {
  try {
    const cleaned = (Array.isArray(classes) ? classes : [])
      .filter(c => typeof c === 'string' && c.trim())
      .map(c => c.trim())
      .slice(0, 20);
    if (cleaned.length === 0) return;
    await usersCol.doc(subId).set({ gridClassPrefs: cleaned }, { merge: true });
  } catch (e) {
    console.error('DB GRID PREFS SAVE ERROR:', e);
  }
};
