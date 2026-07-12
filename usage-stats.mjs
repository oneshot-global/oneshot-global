// 利用状況の手動集計スクリプト（Cloud Logging から直近N日分を集計）
// 使い方: node usage-stats.mjs [日数]   （既定30。Cloud Loggingの保持は既定30日）
// 前提: gcloud 認証済み・プロジェクト oneshot-rebuild へのアクセス権
//
// 集計指標:
//   1. /bulk/extract の呼び出し回数と mode(grid/generic) 内訳
//   2. confidence:low の割合（全イベント中）
//   3. notices の平均件数（1解析あたり）
//   4. undo率（register成功バッチ数に対するundo成功数）
//   5. triage の docTypes 分布（BULK TRIAGE ログはこのスクリプト導入時から蓄積）
//   6. /upload のタイムアウト率（latency>90s または status 499 の近似値）
//   ＋ 自動除外（祝日名・日曜/祝日の素の休園）の平均件数
//   ＋ triage の入力ファイル形式（image/pdf）比率（fileType フィールドは2026-07-11導入。
//     ベクターPDF直接パース機能の投資判断用データ。それ以前のログには含まれない）
import { execSync } from 'child_process';

const days = Math.min(30, Math.max(1, parseInt(process.argv[2] || '30', 10) || 30));
const PROJECT = 'oneshot-rebuild';

function gcloudJson(filter, extra = '') {
  const cmd = `gcloud logging read "${filter.replace(/"/g, '\\"')}" --project ${PROJECT} --freshness=${days}d --limit=1000 --format=json ${extra}`;
  const out = execSync(cmd, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return JSON.parse(out || '[]');
}

const pct = (a, b) => b > 0 ? (100 * a / b).toFixed(1) + '%' : '-';
const avg = (a, b) => b > 0 ? (a / b).toFixed(2) : '-';

// ── アプリログ（BULK EXTRACT / BULK TRIAGE / FILTER 行） ──
const appLogs = gcloudJson(
  'resource.type="cloud_run_revision" AND resource.labels.service_name="oneshot" AND (textPayload:"BULK EXTRACT: mode=" OR textPayload:"BULK TRIAGE: docTypes=" OR textPayload:"EXTRACT FILTER: auto-excluded")'
).map(e => e.textPayload || '');

const extract = { grid: 0, generic: 0, events: 0, low: 0, notices: 0 };
const triage = { total: 0, docTypes: {}, likelyMode: { grid: 0, generic: 0 }, fileType: { image: 0, pdf: 0, unknown: 0 } };
let excludedTotal = 0, excludedLines = 0;

for (const line of appLogs) {
  let m;
  if ((m = line.match(/BULK EXTRACT: mode=(grid|generic) docTypes=\S* events=(\d+) low=(\d+) notices=(\d+)/))) {
    extract[m[1]]++;
    extract.events += Number(m[2]);
    extract.low += Number(m[3]);
    extract.notices += Number(m[4]);
  } else if ((m = line.match(/BULK TRIAGE: docTypes=(\S+) questions=\S+ likelyMode=(grid|generic)(?: fileType=(image|pdf))?/))) {
    triage.total++;
    const top = m[1].split(',')[0];
    triage.docTypes[top] = (triage.docTypes[top] || 0) + 1;
    triage.likelyMode[m[2]]++;
    triage.fileType[m[3] || 'unknown']++;
  } else if ((m = line.match(/EXTRACT FILTER: auto-excluded (\d+)/))) {
    excludedTotal += Number(m[1]);
    excludedLines++;
  }
}
const extractCalls = extract.grid + extract.generic;

// ── リクエストログ（undo率・タイムアウト率） ──
const reqs = gcloudJson(
  'resource.type="cloud_run_revision" AND resource.labels.service_name="oneshot" AND httpRequest.requestMethod="POST" AND (httpRequest.requestUrl:"/upload" OR httpRequest.requestUrl:"/grid/register" OR httpRequest.requestUrl:"/grid/undo")'
).map(e => ({
  url: (e.httpRequest?.requestUrl || '').split('?')[0],
  status: Number(e.httpRequest?.status || 0),
  latency: parseFloat(String(e.httpRequest?.latency || '0').replace('s', ''))
}));

const reg200 = reqs.filter(r => r.url.endsWith('/grid/register') && r.status === 200).length;
const undo200 = reqs.filter(r => r.url.endsWith('/grid/undo') && r.status === 200).length;
const uploads = reqs.filter(r => r.url.endsWith('/upload') && r.status !== 401);
const uploadTimeouts = uploads.filter(r => r.latency > 90 || r.status === 499);

// ── 出力 ──
const rows = [
  ['指標', '値'],
  ['対象期間', `直近${days}日`],
  ['── 一括登録 ──', ''],
  ['1. /bulk/extract 呼び出し', `${extractCalls}回（grid ${extract.grid} / generic ${extract.generic}）`],
  ['2. confidence:low の割合', `${pct(extract.low, extract.events)}（${extract.low}/${extract.events}件）`],
  ['3. notices 平均件数/解析', avg(extract.notices, extractCalls)],
  ['＋ 自動除外 平均件数/解析', `${avg(excludedTotal, extractCalls)}（発生${excludedLines}解析・計${excludedTotal}件）`],
  ['4. undo率（バッチ単位）', `${pct(undo200, reg200)}（undo ${undo200} / register ${reg200}）`],
  ['5. triage docTypes 分布',
    triage.total === 0 ? 'データなし（ログ導入後に蓄積）'
      : Object.entries(triage.docTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' / ')
      + `（計${triage.total}回, likelyMode grid ${triage.likelyMode.grid}/generic ${triage.likelyMode.generic}）`],
  ['＋ 入力ファイル形式（PDF比率）',
    (triage.fileType.image + triage.fileType.pdf) === 0 ? 'データなし（fileType記録は2026-07-11導入、蓄積待ち）'
      : `pdf ${pct(triage.fileType.pdf, triage.fileType.image + triage.fileType.pdf)}（pdf ${triage.fileType.pdf} / image ${triage.fileType.image}${triage.fileType.unknown > 0 ? ` / 集計対象外(旧ログ) ${triage.fileType.unknown}` : ''}）`],
  ['── 通常モード ──', ''],
  ['6. /upload タイムアウト率(近似)', `${pct(uploadTimeouts.length, uploads.length)}（>90s or 499: ${uploadTimeouts.length} / ${uploads.length}件 ※401除外）`]
];

const w = Math.max(...rows.map(r => [...r[0]].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
for (const [k, v] of rows) {
  const kw = [...k].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  console.log(k + ' '.repeat(w - kw + 2) + v);
}
