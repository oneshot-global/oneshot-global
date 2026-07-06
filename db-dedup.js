// /upload のべき等化用の短期重複排除ストア（uploadDedup コレクション）。
// 決済・認証系の db.js には触れないため独立モジュールにしている。
//
// 設計:
// - キーは呼び出し側が計算した SHA-256(subId + '|' + コンテンツバイト列)
// - Firestore の TTL ポリシーは本プロジェクトでは未設定のため、
//   失効はコード内判定（createdAtMs との比較）を正とする。
//   expireAt フィールドは将来 TTL ポリシーを有効化したときの掃除用
// - pending が失効時間を過ぎて残っている場合（処理中クラッシュの残骸）は
//   上書きして初回扱いにする＝再試行が永久ブロックされない
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore({
  projectId: 'oneshot-rebuild',
  databaseId: '(default)'
});

const dedupCol = firestore.collection('uploadDedup');

const DONE_TTL_MS = 10 * 60 * 1000;    // 完了後この時間内の同一リクエストは replay
const PENDING_TTL_MS = 15 * 60 * 1000; // 処理中とみなす上限（残骸対策）

// トランザクションで「なければ pending を作成」。戻り値:
//   { state: 'new' }                   … 初回。処理を続行してよい
//   { state: 'pending' }               … 同一リクエストが処理中
//   { state: 'done', response: {...} } … 完了済み。保存レスポンスを replay する
export async function beginUploadDedup(hash, subId) {
  const ref = dedupCol.doc(hash);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const d = snap.data();
      const ttl = d.status === 'done' ? DONE_TTL_MS : PENDING_TTL_MS;
      if (now - (d.createdAtMs || 0) < ttl) {
        return d.status === 'done'
          ? { state: 'done', response: d.response || null }
          : { state: 'pending' };
      }
      // 失効した残骸は上書きして初回扱い
    }
    tx.set(ref, {
      subId: subId,
      status: 'pending',
      createdAtMs: now,
      expireAt: new Date(now + PENDING_TTL_MS)
    });
    return { state: 'new' };
  });
}

// 成功完了: レスポンスJSONを保存して done 化（以後 DONE_TTL_MS の間 replay 対象）
export async function markUploadDedupDone(hash, response) {
  const now = Date.now();
  await dedupCol.doc(hash).update({
    status: 'done',
    response: response,
    createdAtMs: now,
    expireAt: new Date(now + DONE_TTL_MS)
  });
}

// 失敗・上限到達などで処理しなかった場合: 削除して再試行可能に戻す
export async function clearUploadDedup(hash) {
  await dedupCol.doc(hash).delete();
}
