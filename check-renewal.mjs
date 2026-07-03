// 7/3更新で premiumSince がリセットされたかの確認（読み取り専用、確認後削除OK）
import { Firestore } from '@google-cloud/firestore';

const fs = new Firestore({ projectId: 'oneshot-rebuild', databaseId: '(default)' });
const prem = await fs.collection('users').where('isPremium', '==', true).get();
for (const doc of prem.docs) {
  const u = doc.data();
  const hist = u.history || [];
  let cycleCount = hist.length;
  if (u.premiumSince) {
    const since = new Date(u.premiumSince);
    cycleCount = hist.filter(h => new Date(h) >= since).length;
  }
  console.log(`user ${doc.id.slice(0, 6)}...${doc.id.slice(-4)}`);
  console.log(`  premiumSince: ${u.premiumSince}`);
  console.log(`  今サイクル消費: ${cycleCount} / 30`);
}
