import express from 'express';
import { google } from 'googleapis';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { VertexAI } from '@google-cloud/vertexai';
import Stripe from 'stripe';
import cookieSession from 'cookie-session';
import busboy from 'busboy';
import cors from 'cors';
import 'dotenv/config';
import * as db from './db.js';
import * as dbGrid from './db-grid.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { randomUUID, createHash } from 'crypto';
import { beginUploadDedup, markUploadDedupDone, clearUploadDedup } from './db-dedup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 起動時バリデーション ──────────────────────────────────────
// ALLOWED_ORIGINS と SESSION_KEY が未設定の場合は起動を拒否する。
// 本番で「設定漏れのまま動き続ける」より「設定漏れで起動しない」方が安全。
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

if (!ALLOWED_ORIGINS) {
  console.error('FATAL: ALLOWED_ORIGINS is not set. Set it in .env or Cloud Run env vars. Exiting.');
  process.exit(1);
}

if (!process.env.SESSION_KEY) {
  console.error('FATAL: SESSION_KEY is not set. Set it in .env or Cloud Run env vars. Exiting.');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────

const app = express();

app.set('trust proxy', 1);

app.use(cors({
  origin: (origin, callback) => {
    // Origin ヘッダなし = Stripe Webhook / curl 等サーバー間リクエスト → 通す
    // ブラウザリクエストは ALLOWED_ORIGINS に含まれるドメインのみ許可
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin not allowed: ${origin}`));
  },
  allowedHeaders: ['Content-Type', 'x-is-first-of-batch'],
  credentials: true
}));

app.use((req, res, next) => {
res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
res.set('Pragma', 'no-cache');
res.set('Expires', '0');
next();
});

// メンテナンス設定
const IS_MAINTENANCE = false;
const ALLOWED_IP = '111.108.24.199';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim());

const visionClient = new ImageAnnotatorClient();
const vertexAI = new VertexAI({
project: 'oneshot-rebuild',
location: 'us-central1'
});
// gemini-2.0-flash-001 は提供終了(404 NOT_FOUND)のため後継の安定版へ切替 (2026-07)
const generativeModel = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Webhook endpoint MUST be defined before express.json() to maintain raw body for signature verification
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
const sig = req.headers['stripe-signature'];
let event;
try {
event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
} catch (err) {
return res.status(400).send(`Webhook Error: ${err.message}`);
}

if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
const session = event.data.object;
// 新しいStripe APIバージョン(2025-03-31以降)では invoice のサブスクリプション情報が
// parent.subscription_details 配下に移動したため、そのパスも参照する
const subId = session.metadata?.subId
  || session.subscription_details?.metadata?.subId
  || session.parent?.subscription_details?.metadata?.subId;
const subscriptionId = session.subscription;
const customerId = session.customer;

if (subId) {
  // フォールバック: Webhook時に顧客メタデータにsubIdを強制書き込み（名寄せの確実化）
  try {
    await stripe.customers.update(customerId, { metadata: { subId: subId } });
  } catch (e) {
    console.error("Webhook Customer Update Error:", e.message);
  }

  const isProcessed = await db.checkAndRecordStripeEvent(event.id);
  if (!isProcessed) {
    await db.upgradeToPremium(subId, subscriptionId);
  }
}
}
res.json({received: true});
});

app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_KEY],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  secure: true,
  httpOnly: true
}));

// セッションの自動更新（スライディング・セッション）
app.use((req, res, next) => {
    if (req.session) {
        req.session.nowInMs = Date.now();
    }
    next();
});

// メンテナンス・ミドルウェア
app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const isOwner = clientIp && clientIp.includes(ALLOWED_IP);

    if (IS_MAINTENANCE && !isOwner) {
        const path = req.path;
        if (path === '/' || path === '/app' || path === '/upload') {
            const acceptLang = req.headers['accept-language'] || '';
            const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
            
            let title, h1, p;
            if (userLang === 'ja') {
                title = "メンテナンス中 - OneShotCal";
                h1 = "只今サーバー調整中です";
                p = "しばらくたってから再度お試しください。";
            } else if (userLang === 'de') {
                title = "Wartungsarbeiten - OneShotCal";
                h1 = "Servereinstellungen werden angepasst";
                p = "Bitte versuchen Sie es nach einer Weile erneut.";
            } else if (userLang === 'fr') {
                title = "Maintenance - OneShotCal";
                h1 = "Maintenance du serveur en cours";
                p = "Veuillez réessayer après un moment.";
            } else if (userLang === 'es') {
                title = "Mantenimiento - OneShotCal";
                h1 = "Ajuste del servidor en curso";
                p = "Por favor, inténtelo de nuevo después de un tiempo.";
            } else {
                title = "Maintenance - OneShotCal";
                h1 = "Maintenance in progress";
                p = "Please try again after a while.";
            }

            return res.status(503).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${title}</title>
                    <style>
                        body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
                        .container { text-align: center; padding: 20px; }
                        h1 { font-size: 24px; margin-bottom: 10px; }
                        p { font-size: 16px; color: #64748b; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>${h1}</h1>
                        <p>${p}</p>
                    </div>
                </body>
                </html>
            `);
        }
    }
    next();
});

// 既知のAIクローラーのUser-Agent（GEO対策: 英語版LPを配信）
// ※Google-Extended / Applebot-Extended はrobots.txt用トークンでUAとしては通常出現しないが念のため含める
const AI_CRAWLER_UA_RE = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Google-CloudVertexBot|Applebot-Extended|CCBot|Bytespider|meta-externalagent|FacebookBot|Amazonbot|cohere-ai|MistralAI-User|DuckAssistBot|YouBot/i;

app.get('/', (req, res) => {
    // AIクローラーはUser-Agentで判定し、英語版LPを返す
    const ua = req.headers['user-agent'] || '';
    if (AI_CRAWLER_UA_RE.test(ua)) {
        return res.sendFile(path.join(__dirname, 'public', 'lp-en.html'));
    }
    const acceptLang = req.headers['accept-language'] || '';
    // Accept-Languageがない場合（Googlebot等）は日本語LPをデフォルトにする
    if (!acceptLang) {
        return res.sendFile(path.join(__dirname, 'public', 'lp.html'));
    }
    const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
    const fileMap = {
        ja: 'lp.html',
        de: 'lp-de.html',
        fr: 'lp-fr.html',
        es: 'lp-es.html',
        en: 'lp-en.html'
    };
    let fileName = fileMap[userLang] || 'lp-en.html';
    // 言語別LPが未作成の場合は lp-en.html → lp.html の順にフォールバック（非日本語アクセスのエラー防止）
    if (!fs.existsSync(path.join(__dirname, 'public', fileName))) {
        fileName = fs.existsSync(path.join(__dirname, 'public', 'lp-en.html')) ? 'lp-en.html' : 'lp.html';
    }
    res.sendFile(path.join(__dirname, 'public', fileName));
});

app.get('/travel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lp-travel.html'));
});

app.get('/guide', (req, res) => {
    const acceptLang = req.headers['accept-language'] || '';
    const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
    if (userLang === 'ja') return res.sendFile(path.join(__dirname, 'public', 'guide.html'));
    if (userLang === 'de') return res.sendFile(path.join(__dirname, 'public', 'guide-de.html'));
    if (userLang === 'fr') return res.sendFile(path.join(__dirname, 'public', 'guide-fr.html'));
    if (userLang === 'es') return res.sendFile(path.join(__dirname, 'public', 'guide-es.html'));
    res.sendFile(path.join(__dirname, 'public', 'guide-en.html'));
});

app.get('/how-to', (req, res) => {
    const acceptLang = req.headers['accept-language'] || '';
    console.log('DEBUG accept-language:', acceptLang);
    const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
    console.log('DEBUG userLang:', userLang);
    const fileMap = {
        ja: 'how-to.html',
        de: 'how-to-de.html',
        fr: 'how-to-fr.html',
        es: 'how-to-es.html',
        en: 'how-to-en.html'
    };
    const fileName = fileMap[userLang] || 'how-to-en.html';
    const filePath = path.join(__dirname, 'public', fileName);
    console.log('DEBUG filePath:', filePath);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('sendFile ERROR:', err);
            res.status(404).send('File not found: ' + filePath);
        }
    });
});

app.get('/app', (req, res) => {
    const isLogined = (req.session && req.session.subId) || req.query.login === 'success';
    if (isLogined) {
        const acceptLang = req.headers['accept-language'] || '';
        const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
        if (userLang === 'ja') return res.sendFile(path.join(__dirname, 'public', 'index.html'));
        if (userLang === 'de') return res.sendFile(path.join(__dirname, 'public', 'index-de.html'));
        if (userLang === 'fr') return res.sendFile(path.join(__dirname, 'public', 'index-fr.html'));
        if (userLang === 'es') return res.sendFile(path.join(__dirname, 'public', 'index-es.html'));
        res.sendFile(path.join(__dirname, 'public', 'index-en.html'));
    } else {
        res.redirect('/');
    }
});

// 特定商取引法に基づく表記 (Tokusho) エンドポイント
app.get('/tokusho', (req, res) => {
    const acceptLang = req.headers['accept-language'] || '';
    const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));

    if (userLang === 'ja') {
        res.send(`
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <title>特定商取引法に基づく表記</title>
                <link rel="icon" href="/img/icon2.png" type="image/png">
                <style>body{font-family:sans-serif;padding:40px;line-height:1.6;color:#334155;max-width:800px;margin:auto;}h1{border-bottom:2px solid #e2e8f0;padding-bottom:10px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{padding:15px;border-bottom:1px solid #e2e8f0;text-align:left;}th{width:30%;background:#f8fafc;}</style>
            </head>
            <body>
                <h1>特定商取引法に基づく表記</h1>
                <table>
                    <tr><th>氏名（事業者名）</th><td>Yoshiyuki Kawakami</td></tr>
                    <tr><th>住所</th><td>〒600-8846 京都府京都市下京区朱雀宝蔵町44番地 協栄ビル2階 京都朱雀スタジオ AV-505</td></tr>
                    <tr><th>電話番号</th><td>075-313-3700<br><small>※受付時間: 平日10:00〜17:00</small></td></tr>
                    <tr><th>メールアドレス</th><td>a463311a@gmail.com</td></tr>
                    <tr><th>販売価格</th><td>プレミアムプラン：月額 $1.00 USD</td></tr>
                    <tr><th>対価以外に必要な費用</th><td>インターネット接続料金、パケット通信料、振込手数料等。</td></tr>
                    <tr><th>支払方法・時期</th><td>Stripeを通じたクレジットカード決済。各カード会社の規定に基づきます。</td></tr>
                    <tr><th>役務の提供時期</th><td>決済完了後、即時。</td></tr>
                    <tr><th>返品・キャンセル</th><td>デジタルコンテンツの性質上、決済完了後の返金・返品は不可となります。解約は翌月以降の自動更新停止として承ります。</td></tr>
                </table>
                <div style="margin-top:40px;text-align:center;"><button onclick="window.close();" style="padding:10px 20px;cursor:pointer;">閉じる</button></div>
            </body>
            </html>
        `);
    } else if (userLang === 'de') {
        res.send(`
            <!DOCTYPE html>
            <html lang="de">
            <head>
                <meta charset="UTF-8">
                <title>Impressum (SCTA)</title>
                <link rel="icon" href="/img/icon2.png" type="image/png">
                <style>body{font-family:sans-serif;padding:40px;line-height:1.6;color:#334155;max-width:800px;margin:auto;}h1{border-bottom:2px solid #e2e8f0;padding-bottom:10px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{padding:15px;border-bottom:1px solid #e2e8f0;text-align:left;}th{width:35%;background:#f8fafc;}</style>
            </head>
            <body>
                <h1>Impressum / Gesetz über spezifizierte Handelstransaktionen</h1>
                <table>
                    <tr><th>Name des Betreibers</th><td>Yoshiyuki Kawakami</td></tr>
                    <tr><th>Adresse</th><td>Kyoto Suzaku Studio AV-505, Kyoei Bldg 2F, 44 Suzakuhonmachi, Shimogyo-ku, Kyoto, 600-8846, Japan</td></tr>
                    <tr><th>Telefonnummer</th><td>+81 75-313-3700<br><small>Supportzeiten: 10:00-17:00 (JST) an Wochentagen.</small></td></tr>
                    <tr><th>E-Mail-Adresse</th><td>a463311a@gmail.com</td></tr>
                    <tr><th>Preis</th><td>Premium-Plan: $1.00 USD / Monat</td></tr>
                    <tr><th>Zusätzliche Kosten</th><td>Internetgebühren und Paketkommunikationsgebühren.</td></tr>
                    <tr><th>Zahlungsmethode</th><td>Kreditkartenzahlung über Stripe.</td></tr>
                    <tr><th>Leistungszeitraum</th><td>Sofort nach Zahlungseingang.</td></tr>
                    <tr><th>Rückgabe/Stornierung</th><td>Aufgrund der Beschaffenheit digitaler Inhalte sind Rückerstattungen nach der Zahlung nicht möglich. Kündigungen stoppen zukünftige Verlängerungen.</td></tr>
                </table>
                <div style="margin-top:40px;text-align:center;"><button onclick="window.close();" style="padding:10px 20px;cursor:pointer;">Schließen</button></div>
            </body>
            </html>
        `);
    } else if (userLang === 'fr') {
        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <title>Mentions Légales (SCTA)</title>
                <link rel="icon" href="/img/icon2.png" type="image/png">
                <style>body{font-family:sans-serif;padding:40px;line-height:1.6;color:#334155;max-width:800px;margin:auto;}h1{border-bottom:2px solid #e2e8f0;padding-bottom:10px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{padding:15px;border-bottom:1px solid #e2e8f0;text-align:left;}th{width:35%;background:#f8fafc;}</style>
            </head>
            <body>
                <h1>Mentions Légales / Loi sur les transactions commerciales spécifiées</h1>
                <table>
                    <tr><th>Nom de l'opérateur</th><td>Yoshiyuki Kawakami</td></tr>
                    <tr><th>Adresse</th><td>Kyoto Suzaku Studio AV-505, Kyoei Bldg 2F, 44 Suzakuhonmachi, Shimogyo-ku, Kyoto, 600-8846, Japan</td></tr>
                    <tr><th>Numéro de téléphone</th><td>+81 75-313-3700<br><small>Heures d'assistance : 10h00-17h00 (JST) les jours ouvrables.</small></td></tr>
                    <tr><th>Adresse e-mail</th><td>a463311a@gmail.com</td></tr>
                    <tr><th>Prix</th><td>Plan Premium : 1,00 $ USD / mois</td></tr>
                    <tr><th>Frais supplémentaires</th><td>Frais de connexion Internet et de communication par paquets.</td></tr>
                    <tr><th>Mode de paiement</th><td>Paiement par carte de crédit via Stripe.</td></tr>
                    <tr><th>Délai de prestation</th><td>Immédiatement after la finalisation du paiement.</td></tr>
                    <tr><th>Retours/Annulations</th><td>En raison de la nature du contenu numérique, aucun remboursement/retour n'est accepté after le paiement. Les annulations arrêtent les renouvellements automatiques futurs.</td></tr>
                </table>
                <div style="margin-top:40px;text-align:center;"><button onclick="window.close();" style="padding:10px 20px;cursor:pointer;">Fermer</button></div>
            </body>
            </html>
        `);
    } else if (userLang === 'es') {
        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Aviso Legal (SCTA)</title>
                <link rel="icon" href="/img/icon2.png" type="image/png">
                <style>body{font-family:sans-serif;padding:40px;line-height:1.6;color:#334155;max-width:800px;margin:auto;}h1{border-bottom:2px solid #e2e8f0;padding-bottom:10px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{padding:15px;border-bottom:1px solid #e2e8f0;text-align:left;}th{width:35%;background:#f8fafc;}</style>
            </head>
            <body>
                <h1>Aviso Legal / Ley sobre Transacciones Comerciales Especificadas</h1>
                <table>
                    <tr><th>Nombre del operador</th><td>Yoshiyuki Kawakami</td></tr>
                    <tr><th>Dirección</th><td>Kyoto Suzaku Studio AV-505, Kyoei Bldg 2F, 44 Suzakuhonmachi, Shimogyo-ku, Kyoto, 600-8846, Japan</td></tr>
                    <tr><th>Número de teléfono</th><td>+81 75-313-3700<br><small>Horario de soporte: 10:00-17:00 (JST) los días laborables.</small></td></tr>
                    <tr><th>Correo electrónico</th><td>a463311a@gmail.com</td></tr>
                    <tr><th>Precio</th><td>Plan Premium: $1.00 USD / mes</td></tr>
                    <tr><th>Gastos adicionales</th><td>Gastos de conexión a Internet y de comunicación de datos.</td></tr>
                    <tr><th>Método de pago</th><td>Pago con tarjeta de crédito a través de Stripe.</td></tr>
                    <tr><th>Plazo de prestación</th><td>Inmediatamente after de completar el pago.</td></tr>
                    <tr><th>Devoluciones/Cancelaciones</th><td>Debido a la naturaleza del contenido digital, no se aceptan reembolsos ni devoluciones after del pago. Las cancelaciones detienen futuras renovaciones automáticas.</td></tr>
                </table>
                <div style="margin-top:40px;text-align:center;"><button onclick="window.close();" style="padding:10px 20px;cursor:pointer;">Cerrar</button></div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Legal Notice (SCTA)</title>
                <link rel="icon" href="/img/icon2.png" type="image/png">
                <style>body{font-family:sans-serif;padding:40px;line-height:1.6;color:#334155;max-width:800px;margin:auto;}h1{border-bottom:2px solid #e2e8f0;padding-bottom:10px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{padding:15px;border-bottom:1px solid #e2e8f0;text-align:left;}th{width:35%;background:#f8fafc;}</style>
            </head>
            <body>
                <h1>Act on Specified Commercial Transactions</h1>
                <table>
                    <tr><th>Operator Name</th><td>Yoshiyuki Kawakami</td></tr>
                    <tr><th>Address</th><td>Kyoto Suzaku Studio AV-505, Kyoei Bldg 2F, 44 Suzakuhonmachi, Shimogyo-ku, Kyoto, 600-8846, Japan</td></tr>
                    <tr><th>Phone Number</th><td>+81 75-313-3700<br><small>Support hours: 10:00-17:00 (JST) on weekdays.</small></td></tr>
                    <tr><th>Email Address</th><td>a463311a@gmail.com</td></tr>
                    <tr><th>Price</th><td>Premium Plan: $1.00 USD / month</td></tr>
                    <tr><th>Additional Fees</th><td>Internet connection fees and packet communication fees.</td></tr>
                    <tr><th>Payment Method/Timing</th><td>Credit card payment via Stripe. Billing follows credit card issuer terms.</td></tr>
                    <tr><th>Service Timing</th><td>Immediately after payment completion.</td></tr>
                    <tr><th>Returns/Cancellations</th><td>Due to the nature of digital content, refunds/returns are not accepted after payment. Cancellations stop future auto-renewals.</td></tr>
                </table>
                <div style="margin-top:40px;text-align:center;"><button onclick="window.close();" style="padding:10px 20px;cursor:pointer;">Close</button></div>
            </body>
            </html>
        `);
    }
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function getOAuth2Client() {
const rUri = process.env.GOOGLE_REDIRECT_URI;
return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, rUri);
}

app.get('/privacy', (req, res) => {
    const acceptLang = req.headers['accept-language'] || '';
    const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
    if (userLang === 'ja') return res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
    if (userLang === 'de') return res.sendFile(path.join(__dirname, 'public', 'privacy-de.html'));
    if (userLang === 'fr') return res.sendFile(path.join(__dirname, 'public', 'privacy-fr.html'));
    if (userLang === 'es') return res.sendFile(path.join(__dirname, 'public', 'privacy-es.html'));
    res.sendFile(path.join(__dirname, 'public', 'privacy-en.html'));
});

app.get('/terms', (req, res) => {
    const acceptLang = req.headers['accept-language'] || '';
    const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
    if (userLang === 'ja') return res.sendFile(path.join(__dirname, 'public', 'terms.html'));
    if (userLang === 'de') return res.sendFile(path.join(__dirname, 'public', 'terms-de.html'));
    if (userLang === 'fr') return res.sendFile(path.join(__dirname, 'public', 'terms-fr.html'));
    if (userLang === 'es') return res.sendFile(path.join(__dirname, 'public', 'terms-es.html'));
    res.sendFile(path.join(__dirname, 'public', 'terms-en.html'));
});

app.get('/auth/google', (req, res) => {
const oauth2Client = getOAuth2Client();
const forceConsent = req.query.force === '1';
const authUrl = oauth2Client.generateAuthUrl({
access_type: 'offline',
scope: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
prompt: forceConsent ? 'consent' : 'select_account'
});
res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
try {
const oauth2Client = getOAuth2Client();
if (!req.query.code) throw new Error("No code returned from Google");

const { tokens } = await oauth2Client.getToken(req.query.code);
oauth2Client.setCredentials(tokens);

const ticket = await oauth2Client.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
const subId = ticket.getPayload().sub;

req.session.tokens = tokens;
req.session.subId = subId;

if (tokens.refresh_token) {
  await db.saveRefreshToken(subId, tokens.refresh_token);
}

res.redirect(`/app?login=success`); 

} catch (e) {
console.error("Auth Callback Detailed Error:", e.message);
req.session = null;
res.status(500).send(`Auth Error: ${e.message}`);
}
});

app.get('/portal', async (req, res) => {
  const subId = req.session?.subId; // セッションからのみ取得（IDORを防ぐためクエリパラメータは使用しない）
  
  if (!subId) {
    return res.redirect('/auth/google');
  }
  
  try {
    const search = await stripe.customers.search({
      query: `metadata['subId']:'${subId}'`,
    });

    let customer = search.data[0];

    if (!customer) {
      const list = await stripe.customers.list({ limit: 10 });
      customer = list.data.find(c => c.metadata && c.metadata.subId === subId);
    }

    if (!customer) {
      return res.status(404).send(`管理画面にアクセスできません。ID(${subId})がStripe側に登録されていません。`);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: 'https://oneshotcal.com/app',
    });

    res.redirect(session.url);
  } catch (err) {
    console.error('Portal Error:', err);
    res.status(500).send('Error creating portal session');
  }
});

app.post('/upload', async (req, res) => {
const subId = req.session?.subId; // セッションからのみ取得（Bearer token によるなりすましを防ぐ）

if (!subId) return res.status(401).json({ error: 'Unauthorized' });

let userStatus;
try {
  userStatus = await db.getUserStatus(subId);
} catch (e) {
  console.error("GUARDRAIL: db.getUserStatus failed:", e.message);
  return res.status(500).json({ error: 'Database service error. Please try again later.' });
}

if (userStatus.isBanned) {
  return res.status(403).json({ error: 'Account suspended due to excessive errors.' });
}

let isLimitReached = false;
let stripeUrl = "";
let isPremiumLimit = false;
let premiumResetDate = "";

try {
const isPremium = userStatus.isPremium === true;

let currentCycleHistory = userStatus.history || [];
if (isPremium && userStatus.premiumSince) {
  const since = new Date(userStatus.premiumSince);
  currentCycleHistory = currentCycleHistory.filter(h => new Date(h) >= since);
}
const usageCount = currentCycleHistory.length;

if (req.session) req.session.isPremium = isPremium;

if (isPremium && usageCount >= 30) {
  // 二重課金防止ガード: 既にプレミアムのユーザーには新たなcheckoutを作らず、
  // 次回リセット日の案内のみ返す（アップグレードモーダルに誘導しない）
  isLimitReached = true;
  isPremiumLimit = true;
  if (userStatus.premiumSince) {
    const resetDate = new Date(userStatus.premiumSince);
    resetDate.setMonth(resetDate.getMonth() + 1);
    premiumResetDate = `${resetDate.getMonth() + 1}/${resetDate.getDate()}`;
  }
} else if (!isPremium && usageCount >= 3) {
  let customerId;
  try {
    const search = await stripe.customers.search({
      query: `metadata['subId']:'${subId}'`,
    });
    customerId = search.data[0]?.id;
  } catch (searchErr) {
    console.warn("Stripe customer search skipped or failed, proceeding with new customer creation.");
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    allow_promotion_codes: true,
    line_items: [{
      price: 'price_1SykCGPrBnxNYpRKAVLXLZ5q',
      quantity: 1,
    }],
    mode: 'subscription',
    success_url: `https://oneshotcal.com/success`,
    cancel_url: `https://oneshotcal.com/app`,
    metadata: { subId: subId },
    subscription_data: { metadata: { subId: subId } }
  });
  isLimitReached = true;
  stripeUrl = checkoutSession.url;
}

} catch (err) {
  console.error("GUARDRAIL: PRE-CHECK ERROR:", err.message);
  return res.status(500).json({ error: 'Subscription service error. Please try again later.' });
}

const bb = busboy({ headers: req.headers });
let buffer = Buffer.alloc(0);
let pastedText = "";
let colorId = null;
let userTimeZone = 'Asia/Tokyo';
let targetLang = 'auto';

bb.on('field', (name, val) => {
if (name === 'colorId' && val !== '0') colorId = val;
if (name === 'timeZone') userTimeZone = val;
if (name === 'targetLang') targetLang = val;
if (name === 'text') pastedText = val;
});

bb.on('file', (n, file) => {
    // 上限到達時もバイト列は収集する（べき等判定のハッシュ計算に必要。
    // 「初回がタイムアウト後に完走・消費済み → 再試行で limitReached」のケースで
    // 課金モーダルではなく初回の成功レスポンスを replay するため）。
    // フロントはリサイズ済み(≦1600px JPEG)を送るためメモリ影響は軽微
    file.on('data', (d) => { buffer = Buffer.concat([buffer, d]); });
});

bb.on('finish', async () => {
const acceptLang = req.headers['accept-language'] || '';
const userLang = acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));

// ── べき等化: 同一ユーザー×同一コンテンツの短時間の再送を検知 ──
// done なら limitReached より優先して初回の成功レスポンスを replay する。
// dedupストア障害時は重複排除なしで通常処理に落とす（安全側＝従来動作）
let dedupHash = null;
try {
  const content = (buffer && buffer.length > 0) ? buffer : Buffer.from(pastedText || '', 'utf8');
  if (content.length > 0) {
    dedupHash = createHash('sha256').update(subId).update('|').update(content).digest('hex');
    const dedup = await beginUploadDedup(dedupHash, subId);
    if (dedup.state === 'done' && dedup.response) {
      console.log('UPLOAD DEDUP: replayed previous success response');
      return res.json(dedup.response);
    }
    if (dedup.state === 'pending') {
      console.log('UPLOAD DEDUP: duplicate request while first is still processing');
      const pendingMsg = {
        ja: '処理に時間がかかっています。少し待ってから、直前の予定が登録済みでないかご確認のうえ、再度お試しください。',
        en: 'This is taking longer than usual. Please wait a moment, check whether the event was already added to your calendar, and then try again.',
        de: 'Die Verarbeitung dauert länger als üblich. Bitte warten Sie einen Moment, prüfen Sie, ob der Termin bereits im Kalender eingetragen wurde, und versuchen Sie es dann erneut.',
        fr: "Le traitement prend plus de temps que prévu. Patientez un instant, vérifiez si l'événement a déjà été ajouté à votre agenda, puis réessayez.",
        es: 'El proceso está tardando más de lo habitual. Espere un momento, compruebe si el evento ya se añadió a su calendario y vuelva a intentarlo.'
      };
      return res.json({ success: false, error: pendingMsg[userLang] || pendingMsg.en });
    }
  }
} catch (e) {
  console.error('UPLOAD DEDUP: begin failed, continuing without dedup:', e.message);
  dedupHash = null;
}

// 登録まで到達せずに終わる全経路（上限・解析失敗・認証エラー等）で pending を
// 確実に消すための共通ヘルパー。消さないと同一内容の再試行が最大15分 pending 扱いになる
const dedupAbort = async () => {
  if (dedupHash) await clearUploadDedup(dedupHash).catch(() => {});
};

if (isLimitReached) {
    await dedupAbort(); // 上限解消後の再試行をブロックしない
    return res.json({ limitReached: true, premiumLimit: isPremiumLimit, nextResetDate: premiumResetDate, redirectUrl: stripeUrl });
}

try {
  let ocrText = "";
  if (buffer && buffer.length > 0) {
    const processedImage = await sharp(buffer)
      .rotate()
      .modulate({ brightness: 1.1, contrast: 1.2 })
      .sharpen()
      .toBuffer();

    const [result] = await visionClient.textDetection({
      image: { content: processedImage },
      imageContext: { languageHints: ['ja', 'en', 'de', 'fr', 'es'] }
    });
    ocrText = result.fullTextAnnotation?.text;
  } else if (pastedText) {
    ocrText = pastedText;
  }
  
  if (!ocrText) throw new Error('Input data empty');

  const now = new Date();
  const nowStr = now.toLocaleString(userLang === 'ja' ? 'ja-JP' : (userLang === 'de' ? 'de-DE' : (userLang === 'fr' ? 'fr-FR' : (userLang === 'es' ? 'es-ES' : 'en-US'))), { timeZone: userTimeZone });
  
  let langInstruction = "Maintain the ORIGINAL language of the event details as found in the text; DO NOT translate.";
  if (targetLang === 'ja') langInstruction = "Translate the event title and details into Japanese.";
  else if (targetLang === 'en') langInstruction = "Translate the event title and details into English.";
  else if (targetLang === 'de') langInstruction = "Translate the event title and details into German.";
  else if (targetLang === 'fr') langInstruction = "Translate the event title and details into French.";
  else if (targetLang === 'es') langInstruction = "Translate the event title and details into Spanish.";

  let prompt;
  if (userLang === 'ja') {
      prompt = `以下のテキストから単一の予定（または期間を伴う一連の滞在予定）を抽出し、Googleカレンダー形式のJSONのみを出力してください。${langInstruction}
    
    【厳格なガードレール】
    1. 解析不能な構造: 画像内に月間カレンダー（マス目状）、週間予定表、リスト形式の年間行事、または「月」と「日」の両方の情報がなく特定不可能な場合は解析を中止し、必ず {"events": [], "error": "GUIDE_REQUIRED", "message": "解析エラー: 詳細はGuideを確認してください。"} と出力してください。
    2. 結合の原則: 宿泊予約、フライト、レンタカーなどの「期間」を伴う情報は、開始から終了までを繋いだ1つのイベントとして出力せよ。朝食時間やチェックイン可能時間などのサブ情報は独立したイベントにせず、メイン予定のdescription（説明欄）に箇条書きで含めること。
    3. 捏造禁止の最優先ルール: 
       - まず画像内のテキストから「月の名前または数字」と「日の数字」を物理的な証いることとして抽出せよ。
       - 画像内に具体的な「月」の文字と「日」の数字の両方が物理的に存在しない場合、絶対にデフォルト値で補完せず、必ずエラー（events: []）を返せ。
    
    【日付フォーマット曖昧性解決ルール】
    - 「03/05/2026」のような数字スラッシュ形式は、以下の優先順位で判定すること:

      ★最優先: 米国式 MM/DD/YYYY と判定する強いシグナル（1つでも該当すれば米国式とする）
      * 国名表記: "USA", "U.S.A.", "United States", "US"（独立した語として）
      * 米国の州名・州コード: "CA", "NY", "TX", "FL", "California", "New York"等の50州 + DC
      * 米国ZIPコード: 5桁の郵便番号（例: 94558）または5桁+4桁（例: 94558-1234）
      * 米国の都市名（New York, Los Angeles, San Francisco, Chicago, Yountville等）
      * 通貨記号: "$" 単独表記または "USD"
      * 時刻表記が "AM/PM" 形式（特に "7:00 PM" のような大文字AM/PM）
      * 米国の電話番号形式: "(XXX) XXX-XXXX" や "+1-XXX-XXX-XXXX"
      * .com の中でも明確に米国系サービス（OpenTable, Resy, Yelp等）
      → これらが1つでも検出されたら MM/DD/YYYY（月/日/年）として解釈し「2026年3月5日」とすること

      次点: 欧州式 DD/MM/YYYY と判定するシグナル
      * 言語がドイツ語/フランス語/スペイン語/イタリア語の場合
      * 国名: "Germany", "Deutschland", "France", "Spain", "Italy", "UK", "United Kingdom"等
      * 通貨記号: "€", "EUR", "£", "GBP"
      * 欧州都市名（Berlin, Paris, London, Madrid, Rome等）
      * 24時間表記の時刻（"15:00" のようにAM/PMなし）
      → これらが該当すれば DD/MM/YYYY として解釈し「2026年5月3日」とすること

      日本語の場合: YYYY/MM/DD または年月日表記
    - 月名が英単語/独単語/仏単語等で書かれている場合（例: "May 3, 2026" / "3. Mai 2026"）はそれを最優先し、数字スラッシュより信頼すること
    - 米国シグナルと欧州シグナルが両方検出された場合は、より多く検出された側を採用すること
    
    【タイムゾーン処理ルール】
    - テキスト内に明示的な場所情報（都市名・国名・空港コード(IATA)・ホテル所在地・会場住所）がある場合、その場所のIANAタイムゾーン名を推測し、start/end の timeZone フィールドにそれを設定すること
      * 例: ベルリンのホテル → "Europe/Berlin"
      * 例: パリ発フライト → 出発時刻は "Europe/Paris"、到着時刻は到着地のタイムゾーン
      * 例: JFK空港発 → "America/New_York"
      * 例: ロンドン → "Europe/London"

      ★米国内タイムゾーン判定（必須参照・州コードを最優先で見ること）:
      - America/Los_Angeles (太平洋時間 PT): カリフォルニア(CA), ワシントン(WA), オレゴン(OR), ネバダ(NV)
      - America/Denver (山岳時間 MT): コロラド(CO), ユタ(UT), モンタナ(MT), ニューメキシコ(NM), ワイオミング(WY), アイダホ(ID 大部分)
      - America/Phoenix (アリゾナ ※DST非採用): アリゾナ(AZ)
      - America/Chicago (中部時間 CT): イリノイ(IL/Chicago), テキサス(TX 大部分), ミネソタ(MN), ウィスコンシン(WI), ミズーリ(MO), アイオワ(IA), ルイジアナ(LA), アラバマ(AL), アーカンソー(AR), オクラホマ(OK), カンザス(KS), ネブラスカ(NE 東部), ノースダコタ(ND 東部), サウスダコタ(SD 東部), ミシシッピ(MS), テネシー(TN 西部), ケンタッキー(KY 西部)
      - America/New_York (東部時間 ET): ニューヨーク(NY), ワシントンDC, フロリダ(FL), ジョージア(GA), マサチューセッツ(MA), ペンシルベニア(PA), ノースカロライナ(NC), サウスカロライナ(SC), バージニア(VA), ウェストバージニア(WV), オハイオ(OH), ミシガン(MI), インディアナ(IN 大部分), メイン(ME), バーモント(VT), ニューハンプシャー(NH), コネチカット(CT), ロードアイランド(RI), ニュージャージー(NJ), デラウェア(DE), メリーランド(MD)
      - America/Anchorage (アラスカ): アラスカ(AK)
      - Pacific/Honolulu (ハワイ ※DST非採用): ハワイ(HI)
      → 都市名と州コードの両方が書かれている場合、州コードを優先せよ。例: "Chicago, IL" → America/Chicago（決して America/New_York にしない）
      → 米国の都市・州・住所が出てきたら、必ず上記マッピングから選ぶこと。デフォルトでNew_Yorkを選ぶことは禁止。
    - dateTime フィールドには「現地時間そのままの値」を入れること（UTC変換やユーザータイムゾーン変換を自分で行わない）。Google Calendar APIが timeZone を見て自動変換する。
      * 例: ドイツのホテル「15:00 チェックイン」→ dateTime: "2026-05-03T15:00:00", timeZone: "Europe/Berlin"
    - フライトで出発地と到着地のタイムゾーンが異なる場合: start.timeZone は出発地、end.timeZone は到着地のIANA名を設定すること
    - 場所情報が一切特定できない場合のみ、ユーザータイムゾーン ${userTimeZone} を使用すること
    
    【解析ルール】
    - 現在時刻: ${nowStr}
    - ユーザータイムゾーン: ${userTimeZone}
    - 重要: 日付形式はISO 8601（YYYY-MM-DDTHH:mm:ss）を厳守。
    - 24:00厳禁: 時刻に「24:00」は絶対に使用するな。「23:59:59」とするか翌日の「00:00:00」に繰り上げろ。
    - 表記補正: 25時表記は翌日へ、和暦は西暦へ。
    - プライバシー保護: 取得したGoogleユーザーデータをAI/MLモデルのトレーニングや改善のために利用することはありません。
    
    出力形式: {"events": [{"summary": "..", "location": "..", "description": "..", "start": {"dateTime": "ISO形式", "timeZone": "IANA名"}, "end": {"dateTime": "ISO形式", "timeZone": "IANA名"}}], "error": null, "message": null}
    テキスト: ${ocrText}`;
  } else if (userLang === 'de') {
      prompt = `Extrahiere ein einzelnes Ereignis aus dem Text und gib NUR JSON aus. ${langInstruction}
    
    [Strikte Leitplanken]
    1. Kombinationsregel: Informationen mit einem Zeitraum (z. B. Hotelbuchungen, Flüge) müssen als EIN einzelnes Ereignis ausgegeben werden. Unterinformationen gehören in die „description“.
    2. Fälschungsverbot: Suchen Sie zuerst nach Beweisen für „Monat“ und „Tag“. Wenn diese NICHT physisch vorhanden sind, geben Sie ein leeres events-Array zurück.
    
    [Regeln zur Auflösung mehrdeutiger Datumsformate]
    - Numerische Schrägstrich-Formate wie "03/05/2026" sind nach folgender Priorität zu interpretieren:

      ★Höchste Priorität: Starke Signale für US-Format MM/DD/YYYY (eines reicht):
      * Ländername: "USA", "U.S.A.", "United States", "US" (als eigenständiges Wort)
      * US-Bundesstaaten/Codes: "CA", "NY", "TX", "FL", "California", "New York" usw.
      * US-PLZ: 5-stellige Postleitzahl (z. B. 94558) oder 5+4-stellig (z. B. 94558-1234)
      * US-Städte (New York, Los Angeles, San Francisco, Chicago, Yountville usw.)
      * Währung: "$" allein oder "USD"
      * Zeitformat mit "AM/PM" (besonders "7:00 PM" mit Großbuchstaben)
      * US-Telefonnummer: "(XXX) XXX-XXXX" oder "+1-XXX-XXX-XXXX"
      * Eindeutig US-basierte Dienste (OpenTable, Resy, Yelp usw.)
      → Wenn EINES davon erkannt wird, als MM/DD/YYYY (Monat/Tag/Jahr) interpretieren → "5. März 2026"

      Sekundär: Signale für EU-Format DD/MM/YYYY:
      * Sprache: Deutsch/Französisch/Spanisch/Italienisch
      * Länder: "Germany", "Deutschland", "France", "Spain", "Italy", "UK", "United Kingdom" usw.
      * Währung: "€", "EUR", "£", "GBP"
      * Europäische Städte (Berlin, Paris, London, Madrid, Rom usw.)
      * 24-Stunden-Format ohne AM/PM (z. B. "15:00")
      → Als DD/MM/YYYY interpretieren → "3. Mai 2026"

      Japanisch: YYYY/MM/DD

    - Wenn der Monat als Wort geschrieben ist (z. B. "3. Mai 2026", "May 3, 2026"), hat dies Vorrang vor Schrägstrich-Formaten.
    - Wenn sowohl US- als auch EU-Signale erkannt werden, die häufiger vorkommende Seite wählen.
    
    [Zeitzonen-Verarbeitungsregeln]
    - Wenn der Text einen klaren Ort (Stadt, Land, IATA-Code, Hoteladresse) enthält, leite den IANA-Zeitzonennamen ab und setze ihn in start/end.timeZone:
      * Hotel in Berlin → "Europe/Berlin"
      * Flug ab Paris → start.timeZone "Europe/Paris", end.timeZone = Zeitzone des Zielorts
      * JFK Airport → "America/New_York"

      ★Zeitzonen innerhalb der USA (Pflichtreferenz - Bundesstaaten-Codes haben Vorrang):
      - America/Los_Angeles (Pacific Time PT): CA, WA, OR, NV
      - America/Denver (Mountain Time MT): CO, UT, MT, NM, WY, ID (Großteil)
      - America/Phoenix (Arizona, kein DST): AZ
      - America/Chicago (Central Time CT): IL/Chicago, TX (Großteil), MN, WI, MO, IA, LA, AL, AR, OK, KS, MS, TN (West), KY (West)
      - America/New_York (Eastern Time ET): NY, DC, FL, GA, MA, PA, NC, SC, VA, WV, OH, MI, IN (Großteil), ME, VT, NH, CT, RI, NJ, DE, MD
      - America/Anchorage (Alaska): AK
      - Pacific/Honolulu (Hawaii, kein DST): HI
      → Wenn sowohl Stadt als auch Bundesstaaten-Code angegeben sind, hat der Bundesstaaten-Code Vorrang. Beispiel: "Chicago, IL" → America/Chicago (NIEMALS America/New_York).
      → Bei US-Städten/Bundesstaaten/Adressen IMMER aus obiger Tabelle wählen. Standard auf New_York ist verboten.
    - Das Feld dateTime enthält die LOKALE Zeit des Ortes (keine UTC- oder Benutzer-Zeitzonenumrechnung). Google Calendar konvertiert automatisch.
      * Beispiel: Hotel in Deutschland "15:00 Check-in" → dateTime: "2026-05-03T15:00:00", timeZone: "Europe/Berlin"
    - Bei Flügen mit unterschiedlichen Abflug-/Ankunftszeitzonen: start.timeZone = Abflugort, end.timeZone = Ankunftsort.
    - Nur wenn KEIN Ort identifizierbar ist, verwende die Benutzer-Zeitzone ${userTimeZone}.
    
    [Analyseregeln]
    - Heutiger Kontext: ${nowStr} (Zeitzone: ${userTimeZone})
    - ISO 8601 Standard einhalten. NIEMALS „24:00“ verwenden.
    - Datenschutz: Google-Nutzerdaten werden nicht für das Training oder die Verbesserung von KI/ML-Modellen verwendet.
    
    Ausgabeformat: {"events": [{"summary": "..", "location": "..", "description": "..", "start": {"dateTime": "ISO-Format", "timeZone": "IANA-Name"}, "end": {"dateTime": "ISO-Format", "timeZone": "IANA-Name"}}], "error": null, "message": null}
    Text: ${ocrText}`;
  } else if (userLang === 'fr') {
      prompt = `Extrayez un seul événement à partir du texte et donnez UNIQUEMENT du JSON. ${langInstruction}
    
    [Directives strictes]
    1. Règle de fusion : Les informations comportant une période (ex: réservations d'hôtel, vols) doivent être fusionnées en UN seul événement. Les détails vont dans la "description".
    2. Interdiction de falsification : Cherchez d'abord des preuves du « Mois » et du « Jour ». S'ils sont absents, renvoyez un tableau vide.
    
    [Règles de désambiguïsation des formats de date]
    - Les formats numériques avec barres obliques comme "03/05/2026" doivent être interprétés selon la priorité suivante :

      ★Priorité maximale : Signaux forts pour format US MM/JJ/AAAA (un seul suffit) :
      * Pays : "USA", "U.S.A.", "United States", "US" (en mot indépendant)
      * États US : "CA", "NY", "TX", "FL", "California", "New York" etc.
      * Code postal US : 5 chiffres (ex. 94558) ou 5+4 (ex. 94558-1234)
      * Villes US (New York, Los Angeles, San Francisco, Chicago, Yountville etc.)
      * Devise : "$" seul ou "USD"
      * Format horaire "AM/PM" (surtout "7:00 PM" en majuscules)
      * Numéro de téléphone US : "(XXX) XXX-XXXX" ou "+1-XXX-XXX-XXXX"
      * Services clairement basés aux US (OpenTable, Resy, Yelp etc.)
      → Si UN seul est détecté, interpréter comme MM/JJ/AAAA → "5 mars 2026"

      Secondaire : Signaux pour format EU JJ/MM/AAAA :
      * Langue : Français/Allemand/Espagnol/Italien
      * Pays : "Germany", "France", "Spain", "Italy", "UK" etc.
      * Devise : "€", "EUR", "£", "GBP"
      * Villes européennes (Berlin, Paris, London, Madrid, Rome etc.)
      * Format 24h sans AM/PM (ex. "15:00")
      → Interpréter comme JJ/MM/AAAA → "3 mai 2026"

      Japonais : AAAA/MM/JJ

    - Si le mois est écrit en lettres (ex: "3 mai 2026", "May 3, 2026"), cela prévaut sur le format numérique.
    - Si des signaux US et EU sont détectés, choisir celui qui apparaît le plus souvent.
    
    [Règles de gestion des fuseaux horaires]
    - Si le texte contient un lieu identifiable (ville, pays, code IATA, adresse d'hôtel), déduisez le nom IANA du fuseau horaire et placez-le dans start/end.timeZone :
      * Hôtel à Berlin → "Europe/Berlin"
      * Vol au départ de Paris → start.timeZone "Europe/Paris", end.timeZone = fuseau de destination
      * Aéroport JFK → "America/New_York"

      ★Fuseaux horaires aux États-Unis (référence obligatoire - les codes d'État sont prioritaires) :
      - America/Los_Angeles (Pacific Time PT) : CA, WA, OR, NV
      - America/Denver (Mountain Time MT) : CO, UT, MT, NM, WY, ID (majorité)
      - America/Phoenix (Arizona, sans DST) : AZ
      - America/Chicago (Central Time CT) : IL/Chicago, TX (majorité), MN, WI, MO, IA, LA, AL, AR, OK, KS, MS, TN (ouest), KY (ouest)
      - America/New_York (Eastern Time ET) : NY, DC, FL, GA, MA, PA, NC, SC, VA, WV, OH, MI, IN (majorité), ME, VT, NH, CT, RI, NJ, DE, MD
      - America/Anchorage (Alaska) : AK
      - Pacific/Honolulu (Hawaï, sans DST) : HI
      → Si la ville ET le code d'État sont fournis, le code d'État est prioritaire. Exemple : "Chicago, IL" → America/Chicago (JAMAIS America/New_York).
      → Pour les villes/États/adresses américains, TOUJOURS choisir dans le tableau ci-dessus. Par défaut sur New_York est interdit.
    - Le champ dateTime contient l'heure LOCALE du lieu (sans conversion UTC ni conversion vers le fuseau utilisateur). Google Calendar convertit automatiquement.
      * Exemple : Hôtel en Allemagne "Check-in 15:00" → dateTime: "2026-05-03T15:00:00", timeZone: "Europe/Berlin"
    - Pour les vols avec fuseaux différents au départ/arrivée : start.timeZone = départ, end.timeZone = arrivée.
    - Uniquement si AUCUN lieu n'est identifiable, utilisez le fuseau utilisateur ${userTimeZone}.
    
    [Règles d'analyse]
    - Contexte actuel : ${nowStr}
    - Respectez la norme ISO 8601. N'utilisez JAMAIS "24:00".
    
    Format de sortie : {"events": [{"summary": "..", "location": "..", "description": "..", "start": {"dateTime": "format ISO", "timeZone": "nom IANA"}, "end": {"dateTime": "format ISO", "timeZone": "nom IANA"}}], "error": null, "message": null}
    Texte : ${ocrText}`;
  } else if (userLang === 'es') {
      prompt = `Extraiga un único evento a partir del texte y devuelva SOLO JSON. ${langInstruction}
    
    [Reglas estrictas]
    1. Regla de combinación: La información con un período (ej. hoteles, vuelos) debe emitirse como UN solo evento. Los subdetalles van en la "description".
    2. Prohibición de falsificación: Busque evidencias físicas de «Mes» y «Día». Si no están presentes, devuelva un array vacío.
    
    [Reglas de desambiguación de formatos de fecha]
    - Los formatos numéricos con barras como "03/05/2026" deben interpretarse según la siguiente prioridad:

      ★Máxima prioridad: Señales fuertes para formato US MM/DD/AAAA (basta una):
      * País: "USA", "U.S.A.", "United States", "US" (como palabra independiente)
      * Estados US: "CA", "NY", "TX", "FL", "California", "New York" etc.
      * Código postal US: 5 dígitos (ej. 94558) o 5+4 (ej. 94558-1234)
      * Ciudades US (New York, Los Angeles, San Francisco, Chicago, Yountville etc.)
      * Moneda: "$" solo o "USD"
      * Formato horario "AM/PM" (sobre todo "7:00 PM" en mayúsculas)
      * Teléfono US: "(XXX) XXX-XXXX" o "+1-XXX-XXX-XXXX"
      * Servicios claramente con base en US (OpenTable, Resy, Yelp etc.)
      → Si se detecta UNA, interpretar como MM/DD/AAAA → "5 de marzo de 2026"

      Secundario: Señales para formato EU DD/MM/AAAA:
      * Idioma: Español/Alemán/Francés/Italiano
      * Países: "Germany", "France", "Spain", "Italy", "UK" etc.
      * Moneda: "€", "EUR", "£", "GBP"
      * Ciudades europeas (Berlín, París, Londres, Madrid, Roma etc.)
      * Formato 24h sin AM/PM (ej. "15:00")
      → Interpretar como DD/MM/AAAA → "3 de mayo de 2026"

      Japonés: AAAA/MM/DD

    - Si el mes está escrito con palabras (ej. "3 de mayo de 2026", "May 3, 2026"), tiene prioridad sobre el formato numérico.
    - Si se detectan señales US y EU, elegir la que aparece más veces.
    
    [Reglas de manejo de zonas horarias]
    - Si el texto contiene un lugar identificable (ciudad, país, código IATA, dirección de hotel), deduzca el nombre IANA de la zona horaria y colóquelo en start/end.timeZone:
      * Hotel en Berlín → "Europe/Berlin"
      * Vuelo desde París → start.timeZone "Europe/Paris", end.timeZone = zona horaria del destino
      * Aeropuerto JFK → "America/New_York"

      ★Zonas horarias dentro de EE.UU. (referencia obligatoria - los códigos de estado tienen prioridad):
      - America/Los_Angeles (Pacific Time PT): CA, WA, OR, NV
      - America/Denver (Mountain Time MT): CO, UT, MT, NM, WY, ID (mayoría)
      - America/Phoenix (Arizona, sin DST): AZ
      - America/Chicago (Central Time CT): IL/Chicago, TX (mayoría), MN, WI, MO, IA, LA, AL, AR, OK, KS, MS, TN (oeste), KY (oeste)
      - America/New_York (Eastern Time ET): NY, DC, FL, GA, MA, PA, NC, SC, VA, WV, OH, MI, IN (mayoría), ME, VT, NH, CT, RI, NJ, DE, MD
      - America/Anchorage (Alaska): AK
      - Pacific/Honolulu (Hawái, sin DST): HI
      → Si se proporcionan tanto la ciudad como el código de estado, el código de estado tiene prioridad. Ejemplo: "Chicago, IL" → America/Chicago (NUNCA America/New_York).
      → Para ciudades/estados/direcciones de EE.UU., SIEMPRE elegir de la tabla anterior. Predeterminar a New_York está prohibido.
    - El campo dateTime contiene la hora LOCAL del lugar (sin conversión UTC ni conversión a la zona horaria del usuario). Google Calendar convierte automáticamente.
      * Ejemplo: Hotel en Alemania "Check-in 15:00" → dateTime: "2026-05-03T15:00:00", timeZone: "Europe/Berlin"
    - Para vuelos con zonas horarias distintas en origen/destino: start.timeZone = origen, end.timeZone = destino.
    - Solo si NO se puede identificar ningún lugar, use la zona horaria del usuario ${userTimeZone}.
    
    [Analyseregeln]
    - Contexto actual: ${nowStr}
    - Siga el estándar ISO 8601. NUNCA use "24:00".
    
    Formato de salida: {"events": [{"summary": "..", "location": "..", "description": "..", "start": {"dateTime": "formato ISO", "timeZone": "nombre IANA"}, "end": {"dateTime": "formato ISO", "timeZone": "nombre IANA"}}], "error": null, "message": null}
    Texte : ${ocrText}`;
  } else {
      prompt = `Extract a single event from the text and output ONLY JSON. ${langInstruction}
    
    [Strict Guardrails]
    1. Merging Rule: Information involving a period (e.g., hotel bookings, flights, car rentals) MUST be output as ONE single merged event from start to end. Sub-information like meal times or check-in windows should be included as a list in the "description" field rather than separate events.
    2. Anti-Fabrication Rule: First, extract physical evidence of "Month" and "Day" from the text. If BOTH are NOT physically present, return an empty events array.
    
    [Date Format Disambiguation Rules]
    - Numeric slash formats like "03/05/2026" must be interpreted with the following priority:

      ★HIGHEST PRIORITY: Strong signals for US format MM/DD/YYYY (ANY ONE is sufficient):
      * Country: "USA", "U.S.A.", "United States", "US" (as a standalone word)
      * US states/codes: "CA", "NY", "TX", "FL", "California", "New York", and any of the 50 state names or 2-letter codes + DC
      * US ZIP code: 5-digit postal code (e.g., 94558) or 5+4 format (e.g., 94558-1234)
      * US city names (New York, Los Angeles, San Francisco, Chicago, Yountville, Napa, etc.)
      * Currency: "$" alone or "USD"
      * Time format with "AM/PM" (especially "7:00 PM" with uppercase AM/PM)
      * US phone format: "(XXX) XXX-XXXX" or "+1-XXX-XXX-XXXX"
      * Clearly US-based services (OpenTable, Resy, Yelp, etc.)
      → If ANY ONE of these is detected, interpret as MM/DD/YYYY (Month/Day/Year) → "March 5, 2026"

      SECONDARY: Signals for EU format DD/MM/YYYY:
      * Language: German/French/Spanish/Italian
      * Countries: "Germany", "Deutschland", "France", "Spain", "Italy", "UK", "United Kingdom", etc.
      * Currency: "€", "EUR", "£", "GBP"
      * European cities (Berlin, Paris, London, Madrid, Rome, etc.)
      * 24-hour time format without AM/PM (e.g., "15:00")
      → Interpret as DD/MM/YYYY → "May 3, 2026"

      Japanese: YYYY/MM/DD or kanji notation

    - If the month is written as a word (e.g., "May 3, 2026", "3. Mai 2026", "3 mai 2026"), this takes priority over numeric slash formats.
    - If both US and EU signals are detected, choose the side with more occurrences.
    
    [Timezone Handling Rules]
    - If the text contains identifiable location info (city, country, IATA airport code, hotel address, venue address), infer the IANA timezone name and set it in start/end.timeZone:
      * Hotel in Berlin → "Europe/Berlin"
      * Flight departing Paris → start.timeZone "Europe/Paris", end.timeZone = arrival location's timezone
      * JFK airport → "America/New_York"
      * London → "Europe/London"

      ★US INTERNAL TIMEZONE MAPPING (mandatory reference - state codes take priority):
      - America/Los_Angeles (Pacific Time PT): CA, WA, OR, NV
      - America/Denver (Mountain Time MT): CO, UT, MT, NM, WY, ID (most)
      - America/Phoenix (Arizona, no DST): AZ
      - America/Chicago (Central Time CT): IL/Chicago, TX (most), MN, WI, MO, IA, LA, AL, AR, OK, KS, MS, TN (west), KY (west)
      - America/New_York (Eastern Time ET): NY, DC, FL, GA, MA, PA, NC, SC, VA, WV, OH, MI, IN (most), ME, VT, NH, CT, RI, NJ, DE, MD
      - America/Anchorage (Alaska): AK
      - Pacific/Honolulu (Hawaii, no DST): HI
      → If both city AND state code are provided, state code takes priority. Example: "Chicago, IL" → America/Chicago (NEVER America/New_York).
      → For any US city/state/address, ALWAYS pick from the table above. Defaulting to New_York is prohibited.
    - The dateTime field MUST contain the LOCAL time of that location as-is (do NOT convert to UTC or to the user's timezone yourself). Google Calendar API will convert automatically based on the timeZone field.
      * Example: German hotel "15:00 check-in" → dateTime: "2026-05-03T15:00:00", timeZone: "Europe/Berlin"
    - For flights where departure and arrival are in different timezones: start.timeZone = departure location IANA, end.timeZone = arrival location IANA.
    - ONLY if no location can be identified at all, fall back to the user's timezone ${userTimeZone}.
    
    [Analysis Rules]
    - Today's Context: ${nowStr} (TimeZone: ${userTimeZone})
    - IMPORTANT: Date and time formats MUST strictly follow ISO 8601 (YYYY-MM-DDTHH:mm:ss).
    - NO "24:00" ALLOWED: Never use "24:00". Use "23:59:59" or "00:00:00" of the next day.
    - Privacy: Google user data is not used for training or improving AI/ML models.
    
    Output Format: {"events": [{"summary": "..", "location": "..", "description": "..", "start": {"dateTime": "ISO形式", "timeZone": "IANA name"}, "end": {"dateTime": "ISO形式", "timeZone": "IANA name"}}], "error": null, "message": null}
    Text: ${ocrText}`;
  }

  // thinking OFFで終日予定（時刻情報なし）の抽出が失敗する劣化を実測確認したため
  // thinking ON（既定）に据え置き。2026-07-08、triageと同様の理由で見送り
  const aiRes = await generativeModel.generateContent(prompt);
  const rawText = aiRes.response.candidates[0].content.parts[0].text;
  const cleanJson = rawText.replace(/```json|```/g, "").trim();
  const parsedData = JSON.parse(cleanJson);
  
  if (parsedData.error) {
    await dedupAbort();
    await db.incrementErrorCount(subId, 10);
    return res.json({ success: false, error: parsedData.message || (userLang === 'ja' ? "解析エラー: 詳細はGuideを確認してください。" : (userLang === 'de' ? "Analysefehler: Details finden Sie im Guide." : (userLang === 'fr' ? "Erreur d'analyse : veuillez vous référer au Guide pour plus de détails." : (userLang === 'es' ? "Error de análisis: consulte la Guía para más detalles." : "Analysis Error: Please refer to the Guide for details.")))) });
  }

  if (!parsedData.events || parsedData.events.length === 0) {
    await dedupAbort();
    await db.incrementErrorCount(subId, 10);
    return res.json({ success: false, error: userLang === 'ja' ? "解析エラー: 詳細はGuideを確認してください。" : (userLang === 'de' ? "Analysefehler: Details finden Sie im Guide." : (userLang === 'fr' ? "Erreur d'analyse : veuillez vous référer au Guide pour plus de détails." : (userLang === 'es' ? "Error de análisis: consulte la Guía para más detalles." : "Analysis Error: Please refer to the Guide for details."))) });
  }

  let events = parsedData.events;
  if (!events[0].summary || !events[0].start) {
    await dedupAbort();
    await db.incrementErrorCount(subId, 10);
    return res.json({ success: false, error: userLang === 'ja' ? "解析エラー: 詳細はGuideを確認してください。" : (userLang === 'de' ? "Analysefehler: Details finden Sie im Guide." : (userLang === 'fr' ? "Erreur d'analyse : veuillez vous référer au Guide pour plus de détails." : (userLang === 'es' ? "Error de análisis: consulte la Guía para más detalles." : "Analysis Error: Please refer to the Guide for details."))) });
  }

  const userAuth = getOAuth2Client();
  const savedRefreshToken = await db.getRefreshToken(subId);
  let currentTokens = req.session?.tokens;
  
  if (!savedRefreshToken && !currentTokens) {
    await dedupAbort();
    return res.status(401).json({ error: "Session expired. Please login again." });
  }

  if (savedRefreshToken) {
    userAuth.setCredentials({ refresh_token: savedRefreshToken });
  } else {
    userAuth.setCredentials(currentTokens);
  }

  userAuth.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      db.saveRefreshToken(subId, tokens.refresh_token);
    }
    if (req.session) req.session.tokens = { ...req.session.tokens, ...tokens };
  });

  const calendar = google.calendar({ version: 'v3', auth: userAuth });

  for (const e of events) {
    if (e.summary && e.start) {
      const resource = { 
        summary: e.summary, 
        location: e.location || "", 
        description: e.description || "", 
        start: e.start, 
        end: e.end
      };
      if (colorId) resource.colorId = colorId;

      await calendar.events.insert({
        calendarId: 'primary',
        resource: resource
      });
    }
  }

  let targetMonth = "";
  if (events.length > 0) {
    const sorted = events.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
    const firstD = new Date(sorted[0].start.dateTime);
    targetMonth = `${firstD.getFullYear()}/${firstD.getMonth() + 1}/1`;
  }

  await db.addUsageHistory(subId);
  await db.resetErrorCount(subId);
  
  const finalStatus = await db.getUserStatus(subId);
  let finalCount = 0;
  let nextResetDate = "";

  if (finalStatus?.isPremium) {
    const since = new Date(finalStatus.premiumSince);
    const cycleHistory = (finalStatus.history || []).filter(h => new Date(h) >= since);
    finalCount = Math.max(0, 30 - cycleHistory.length);
    
    const resetDate = new Date(since);
    resetDate.setMonth(resetDate.getMonth() + 1);
    nextResetDate = `${resetDate.getMonth() + 1}/${resetDate.getDate()}`;
  } else {
    finalCount = Math.max(0, 3 - (finalStatus?.history?.length || 0));
  }

  const successResponse = {
    success: true,
    count: finalStatus?.isPremium && finalCount > 30 ? 'Unlimited' : finalCount,
    isPremium: finalStatus?.isPremium || false,
    nextResetDate: nextResetDate,
    targetMonth: targetMonth,
    extracted: events[0]
  };

  // 登録・消費まで完走した場合のみ done 化（以後10分の同一再送はこのレスポンスをreplay）。
  // 保存失敗しても登録自体は成功として返す（重複排除が効かなくなるだけ＝従来動作）
  if (dedupHash) {
    try { await markUploadDedupDone(dedupHash, successResponse); }
    catch (e) { console.error('UPLOAD DEDUP: markDone failed:', e.message); }
  }

  res.json(successResponse);
} catch (e) {
  console.error("ANALYSIS ERROR:", e);
  await dedupAbort(); // 失敗時は dedup を消して再試行可能に戻す
  const isSystemError = e.status === 429 || e.message?.includes('quota') || e.message?.includes('limit');
  if (!isSystemError) {
    await db.incrementErrorCount(subId, 10);
  }
  // 認証エラー時は401を返し、フロントエンドで強制ログインさせる
  if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('invalid_token') || e.message?.includes('credentials')) {
      return res.status(401).json({ error: "Session expired." });
  }
  // カレンダー権限不足時は403を返す
  if (e.code === 403 || e.code === '403' || e.status === 403 || e.errors?.[0]?.reason === 'insufficientPermissions') {
      return res.status(403).json({ error: "Insufficient permission." });
  }
  res.status(500).json({ error: userLang === 'ja' ? "解析エラー: 詳細はGuideを確認してください。" : (userLang === 'de' ? "Analysefehler: Details finden Sie im Guide." : (userLang === 'fr' ? "Erreur d'analyse : consultez le Guide pour plus de détails." : (userLang === 'es' ? "Error de análisis: consulte la Guía para más detalles." : "Analysis Error: Please refer to the Guide for details."))) });
}

});
req.pipe(bb);
});

// ═══════════════════════════════════════════════════════════════
// グリッド（月間予定表）モード
// 幼稚園・保育園などの「日付 × クラス列」形式の月間予定表を
// 画像/PDFで受け取り、選択されたクラス列の予定を一括登録する新機能。
// 既存の /upload（1画像1予定）とは完全に独立しており、
// 決済(Stripe)・認証まわりの既存ハンドラには一切手を入れていない。
//
// フロー（画像はサーバーに保持しない。各ステップでフロントが再送信）:
//   1. POST /grid/columns  … クラス列見出しの検出（＋保存済み選択の返却）
//   2. POST /grid/extract  … 選択クラスの予定を構造化抽出（登録はしない）
//   3. POST /grid/register … ユーザー確認済みの予定のみ一括登録（回数1消費）
// ═══════════════════════════════════════════════════════════════

// Vertex AI の inlineData はリクエスト上限20MB。base64で約1.33倍に膨らむため10MBに制限
const GRID_MAX_FILE_SIZE = 10 * 1024 * 1024;
const GRID_MAX_EVENTS = 120;

const GRID_MESSAGES = {
  ja: {
    notGrid: 'グリッド形式の月間予定表として認識できませんでした。表全体が写った鮮明な画像またはPDFをお試しください。',
    parseError: '解析エラー: 画像/PDFを確認して再度お試しください。',
    empty: '選択したクラスの予定が見つかりませんでした。',
    badInput: 'ファイルまたは選択内容が不正です。',
    tooLarge: 'ファイルサイズが大きすぎます（上限10MB）。',
    undoNotFound: '取り消し対象が見つかりませんでした（取り消せるのは直近の登録のみです）。',
    undoError: '取り消し中にエラーが発生しました。もう一度お試しください。',
    notSchedule: '予定として登録できる内容を見つけられませんでした。予定表・献立表・行事チラシなどが写った鮮明な画像またはPDFをお試しください。',
    genericEmpty: '予定として読み取れる内容が見つかりませんでした。',
    qColumns: '登録する列（クラス・担当など）を選んでください'
  },
  en: {
    notGrid: 'Could not recognize this as a grid-style monthly schedule. Please try a clear image or PDF showing the whole table.',
    parseError: 'Analysis error: please check the image/PDF and try again.',
    empty: 'No events found for the selected class column(s).',
    badInput: 'Invalid file or selection.',
    tooLarge: 'File is too large (max 10MB).',
    undoNotFound: 'Nothing to undo (only the most recent registration can be undone).',
    undoError: 'An error occurred while undoing. Please try again.',
    notSchedule: 'Could not find any schedule content to register. Please try a clear image or PDF of a schedule, menu plan, or event flyer.',
    genericEmpty: 'No events could be read from this file.',
    qColumns: 'Select the column(s) to register (class, person, etc.)'
  },
  de: {
    notGrid: 'Konnte dies nicht als Monatsplan im Rasterformat erkennen. Bitte versuchen Sie ein klares Bild oder PDF der gesamten Tabelle.',
    parseError: 'Analysefehler: Bitte prüfen Sie die Datei und versuchen Sie es erneut.',
    empty: 'Keine Termine für die ausgewählten Spalten gefunden.',
    badInput: 'Ungültige Datei oder Auswahl.',
    tooLarge: 'Datei ist zu groß (max. 10MB).',
    undoNotFound: 'Nichts rückgängig zu machen (nur die letzte Registrierung kann rückgängig gemacht werden).',
    undoError: 'Beim Rückgängigmachen ist ein Fehler aufgetreten. Bitte erneut versuchen.',
    notSchedule: 'Es wurden keine Termininhalte zum Registrieren gefunden. Bitte versuchen Sie ein klares Bild oder PDF eines Plans, Speiseplans oder Flyers.',
    genericEmpty: 'Aus dieser Datei konnten keine Termine gelesen werden.',
    qColumns: 'Wählen Sie die zu registrierenden Spalten (Klasse, Person usw.)'
  },
  fr: {
    notGrid: 'Impossible de reconnaître un planning mensuel en grille. Essayez une image ou un PDF net montrant tout le tableau.',
    parseError: "Erreur d'analyse : vérifiez le fichier et réessayez.",
    empty: 'Aucun événement trouvé pour les colonnes sélectionnées.',
    badInput: 'Fichier ou sélection invalide.',
    tooLarge: 'Fichier trop volumineux (max 10MB).',
    undoNotFound: "Rien à annuler (seul l'enregistrement le plus récent peut être annulé).",
    undoError: "Une erreur s'est produite lors de l'annulation. Veuillez réessayer.",
    notSchedule: "Aucun contenu de planning à enregistrer n'a été trouvé. Essayez une image ou un PDF net d'un planning, d'un menu ou d'un prospectus.",
    genericEmpty: "Aucun événement n'a pu être lu dans ce fichier.",
    qColumns: 'Sélectionnez les colonnes à enregistrer (classe, personne, etc.)'
  },
  es: {
    notGrid: 'No se pudo reconocer como un horario mensual en cuadrícula. Pruebe una imagen o PDF nítido de toda la tabla.',
    parseError: 'Error de análisis: compruebe el archivo e inténtelo de nuevo.',
    empty: 'No se encontraron eventos para las columnas seleccionadas.',
    badInput: 'Archivo o selección no válidos.',
    tooLarge: 'Archivo demasiado grande (máx. 10MB).',
    undoNotFound: 'Nada que deshacer (solo se puede deshacer el registro más reciente).',
    undoError: 'Se produjo un error al deshacer. Inténtelo de nuevo.',
    notSchedule: 'No se encontró contenido de agenda para registrar. Pruebe una imagen o PDF nítido de un horario, menú o folleto.',
    genericEmpty: 'No se pudieron leer eventos de este archivo.',
    qColumns: 'Seleccione las columnas a registrar (clase, persona, etc.)'
  }
};

function gridUserLang(req) {
  const acceptLang = req.headers['accept-language'] || '';
  return acceptLang.startsWith('ja') ? 'ja' : (acceptLang.startsWith('de') ? 'de' : (acceptLang.startsWith('fr') ? 'fr' : (acceptLang.startsWith('es') ? 'es' : 'en')));
}

function gridMsg(lang, key) {
  return (GRID_MESSAGES[lang] || GRID_MESSAGES.en)[key];
}

// /upload の事前チェックと同等の利用上限判定（既存コードは変更せず、ここに複製）
async function gridCheckLimit(subId) {
  const userStatus = await db.getUserStatus(subId);
  if (userStatus.isBanned) return { banned: true };

  const isPremium = userStatus.isPremium === true;
  let currentCycleHistory = userStatus.history || [];
  if (isPremium && userStatus.premiumSince) {
    const since = new Date(userStatus.premiumSince);
    currentCycleHistory = currentCycleHistory.filter(h => new Date(h) >= since);
  }
  const usageCount = currentCycleHistory.length;

  if (isPremium && usageCount >= 30) {
    // 二重課金防止ガード: 既にプレミアムのユーザーには新たなcheckoutを作らない
    let nextResetDate = '';
    if (userStatus.premiumSince) {
      const resetDate = new Date(userStatus.premiumSince);
      resetDate.setMonth(resetDate.getMonth() + 1);
      nextResetDate = `${resetDate.getMonth() + 1}/${resetDate.getDate()}`;
    }
    return { limitReached: true, premiumLimit: true, nextResetDate: nextResetDate };
  }

  if (!isPremium && usageCount >= 3) {
    let customerId;
    try {
      const search = await stripe.customers.search({
        query: `metadata['subId']:'${subId}'`,
      });
      customerId = search.data[0]?.id;
    } catch (searchErr) {
      console.warn('Stripe customer search skipped or failed (grid), proceeding with new customer creation.');
    }
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items: [{
        price: 'price_1SykCGPrBnxNYpRKAVLXLZ5q',
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `https://oneshotcal.com/success`,
      cancel_url: `https://oneshotcal.com/app`,
      metadata: { subId: subId },
      subscription_data: { metadata: { subId: subId } }
    });
    return { limitReached: true, stripeUrl: checkoutSession.url };
  }
  return { ok: true, isPremium };
}

// multipart を Promise で収集（ファイル1つ＋テキストフィールド）
function collectGridUpload(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: GRID_MAX_FILE_SIZE, files: 1 } });
    let buffer = Buffer.alloc(0);
    let mimeType = '';
    let truncated = false;
    const fields = {};
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, file, info) => {
      mimeType = (info && info.mimeType) || '';
      file.on('data', (d) => { buffer = Buffer.concat([buffer, d]); });
      file.on('limit', () => { truncated = true; });
    });
    bb.on('finish', () => resolve({ buffer, mimeType, fields, truncated }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

// Gemini へ渡す inlineData パートを作る。
// グリッドは空間構造（列・帯・矢印・点線）が本質なので、OCRテキストではなく
// 画像/PDFをそのままマルチモーダル入力する。PDFはGeminiがネイティブ対応。
async function prepareGridPart(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    return { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } };
  }
  // グリッドはセルの文字が小さいため、幅が小さい画像は2倍にアップスケールして
  // Gemini側のタイル解像度で文字が潰れるのを防ぐ（スマホのスクリーンショット対策）
  const meta = await sharp(buffer).metadata();
  let img = sharp(buffer).rotate();
  const w = meta.width || 0;
  if (w > 0 && w < 1800) {
    img = img.resize({ width: Math.min(w * 2, 3000), kernel: 'lanczos3' });
  }
  const processed = await img
    .modulate({ brightness: 1.05 })
    .sharpen()
    .jpeg({ quality: 90 })
    .toBuffer();
  return { inlineData: { mimeType: 'image/jpeg', data: processed.toString('base64') } };
}

// thinking: Gemini 2.5 Flash はVertex AI既定で動的thinkingがON（可視出力の
// 数倍のthinkingトークンが「Thinking Text Output」として別課金される）。
// コスト削減のためtriage呼び出しをthinking OFF化して試したが、2026-07-08の
// 実測でtriageの年月推測（date_confirm、過去年しか候補にしない誤り）と
// /uploadの終日予定抽出（抽出失敗）の両方で再現性のある精度劣化を確認したため
// 見送り、全呼び出しをthinking=true（既定）に統一した。第4引数の仕組み自体は
// 将来の再検討用に残す（現状すべての呼び出しがtrue/省略）
async function gridGenerateJson(filePart, prompt, temperature = 0, thinking = true) {
  const generationConfig = { responseMimeType: 'application/json', temperature: temperature };
  if (!thinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const aiRes = await generativeModel.generateContent({
    contents: [{ role: 'user', parts: [filePart, { text: prompt }] }],
    generationConfig: generationConfig
  });
  const rawText = aiRes.response.candidates[0].content.parts[0].text;
  return JSON.parse(rawText.replace(/```json|```/g, '').trim());
}

const GRID_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRID_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function gridNextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── 1. クラス列見出しの検出 ─────────────────────────────────
app.post('/grid/columns', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  const lang = gridUserLang(req);

  try {
    const status = await db.getUserStatus(subId);
    if (status.isBanned) return res.status(403).json({ error: 'Account suspended due to excessive errors.' });
  } catch (e) {
    console.error('GRID: db.getUserStatus failed:', e.message);
    return res.status(500).json({ error: 'Database service error. Please try again later.' });
  }

  try {
    const { buffer, mimeType, truncated } = await collectGridUpload(req);
    if (truncated) return res.json({ success: false, error: gridMsg(lang, 'tooLarge') });
    if (!buffer || buffer.length === 0 || !(mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    const filePart = await prepareGridPart(buffer, mimeType);
    const prompt = `この添付ファイルは幼稚園・保育園・学校などの「月間予定表」の可能性があります。日付の行(または列)と、クラス・学年ごとの列(または行)で構成されたグリッド表かどうかを判定してください。

以下のJSONのみを出力してください:
{"isGrid": true または false, "columns": ["列見出し1", "列見出し2", ...], "year": 数値 または null, "month": 数値 または null}

ルール:
- columns には、日付・曜日以外の「クラス列（学年・組）の見出しテキスト」を、表に書かれている表記のまま、左から順にすべて列挙する。園・学校によって名称は完全に自由（例: 年長組/ばら組/ひよこ/3歳児 など。特定の名称を想定しないこと）。
- 「全園児」「共通」など全クラス共通の列があれば、それも columns に含める。
- 見出しが読み取れない列は "列2" のように機械的な名前を付けず、読み取れた列だけを列挙する。
- タイトルや欄外から年・月が読み取れれば year / month に西暦の数値で設定。読み取れない場合は null。
- 日付×クラス列のグリッド表でない場合（1枚1予定のチラシ、リスト形式など）は {"isGrid": false, "columns": [], "year": null, "month": null} を返す。`;

    // thinking OFFで年月推測(date_confirm)の精度劣化を実測確認したため thinking ON に据え置き（2026-07-08）
    const parsed = await gridGenerateJson(filePart, prompt);

    if (!parsed.isGrid || !Array.isArray(parsed.columns) || parsed.columns.length === 0) {
      await db.incrementErrorCount(subId, 10);
      return res.json({ success: false, error: gridMsg(lang, 'notGrid') });
    }

    const columns = parsed.columns
      .filter(c => typeof c === 'string' && c.trim())
      .map(c => c.trim())
      .slice(0, 20);

    // 保存済みのクラス選択（列名が一致するものだけ自動適用の候補として返す）
    const saved = await dbGrid.getGridClassPrefs(subId);
    const savedClasses = saved ? saved.filter(s => columns.includes(s)) : [];

    res.json({
      success: true,
      columns: columns,
      year: Number.isInteger(parsed.year) ? parsed.year : null,
      month: Number.isInteger(parsed.month) ? parsed.month : null,
      savedClasses: savedClasses
    });
  } catch (e) {
    console.error('GRID COLUMNS ERROR:', e);
    const isSystemError = e.status === 429 || e.message?.includes('quota') || e.message?.includes('limit');
    if (!isSystemError) {
      await db.incrementErrorCount(subId, 10);
    }
    res.status(500).json({ error: gridMsg(lang, 'parseError') });
  }
});

// ── 2. 選択クラスの予定を構造化抽出（登録はしない） ─────────
app.post('/grid/extract', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  const lang = gridUserLang(req);

  let limitState;
  try {
    limitState = await gridCheckLimit(subId);
  } catch (e) {
    console.error('GRID: pre-check error:', e.message);
    return res.status(500).json({ error: 'Subscription service error. Please try again later.' });
  }
  if (limitState.banned) return res.status(403).json({ error: 'Account suspended due to excessive errors.' });
  if (limitState.limitReached) return res.json({ limitReached: true, premiumLimit: limitState.premiumLimit || false, nextResetDate: limitState.nextResetDate || '', redirectUrl: limitState.stripeUrl || '' });

  try {
    const { buffer, mimeType, fields, truncated } = await collectGridUpload(req);
    if (truncated) return res.json({ success: false, error: gridMsg(lang, 'tooLarge') });
    if (!buffer || buffer.length === 0 || !(mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    let selectedClasses = [];
    try {
      selectedClasses = JSON.parse(fields.classes || '[]');
    } catch (_) { /* fallthrough */ }
    selectedClasses = (Array.isArray(selectedClasses) ? selectedClasses : [])
      .filter(c => typeof c === 'string' && c.trim())
      .map(c => c.trim())
      .slice(0, 20);
    if (selectedClasses.length === 0) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    const userTimeZone = fields.timeZone || 'Asia/Tokyo';
    const targetLang = fields.targetLang || 'auto';

    // 次回以降の自動適用のため選択結果を保存
    await dbGrid.saveGridClassPrefs(subId, selectedClasses);

    const filePart = await prepareGridPart(buffer, mimeType);
    const result = await runGridExtraction(filePart, { selectedClasses, userTimeZone, targetLang });

    if (!result.isGrid) {
      await db.incrementErrorCount(subId, 10);
      return res.json({ success: false, error: gridMsg(lang, 'notGrid') });
    }
    if (result.events.length === 0 && result.notices.length === 0) {
      await db.incrementErrorCount(subId, 10);
      return res.json({ success: false, error: gridMsg(lang, 'empty') });
    }

    res.json({
      success: true,
      year: result.year,
      month: result.month,
      selectedClasses: selectedClasses,
      events: result.events,
      notices: result.notices
    });
  } catch (e) {
    console.error('GRID EXTRACT ERROR:', e);
    const isSystemError = e.status === 429 || e.message?.includes('quota') || e.message?.includes('limit');
    if (!isSystemError) {
      await db.incrementErrorCount(subId, 10);
    }
    res.status(500).json({ error: gridMsg(lang, 'parseError') });
  }
});

function gridLangInstruction(targetLang) {
  let langInstruction = '予定名(summary)は表に書かれている元の言語・表記のまま出力し、翻訳しないこと。';
  if (targetLang === 'ja') langInstruction = '予定名(summary)は日本語に翻訳して出力すること。';
  else if (targetLang === 'en') langInstruction = 'Translate each summary into English.';
  else if (targetLang === 'de') langInstruction = 'Translate each summary into German.';
  else if (targetLang === 'fr') langInstruction = 'Translate each summary into French.';
  else if (targetLang === 'es') langInstruction = 'Translate each summary into Spanish.';
  return langInstruction;
}

// ── 自動除外フィルタ（登録価値のない自明情報をカレンダー登録候補から外す） ──
// 1) 国民の祝日名そのもの（海の日 等）: 多くのカレンダーが自動表示するため
//    二重登録の価値がない。行ズレで日付がズレていても「名前」で消えるため、
//    土日祝の帯の境界（行ズレ多発地帯）の誤登録候補が表面化しなくなる。
// 2) 日曜・祝日の「素の休園」: 規則的で自明な休み。
//    完全一致方式なので「土曜日保育休園」「臨時休園」等の特別な休みは残る。
// プロンプト・3ラン多数決・notices生成には一切手を入れない後処理フィルタ。
// 祝日名は日本語のみ対応（本機能の主要利用者層に合わせたv1スコープ）。

const JP_HOLIDAY_NAMES = new Set([
  '元日', '元旦', '成人の日', '建国記念の日', '建国記念日', '天皇誕生日',
  '春分の日', '昭和の日', '憲法記念日', 'みどりの日', 'こどもの日',
  '海の日', '山の日', '敬老の日', '秋分の日', 'スポーツの日', '体育の日',
  '文化の日', '勤労感謝の日', '振替休日', '国民の休日'
]);

const JP_PLAIN_CLOSURE_NAMES = new Set(['休園', '休園日', '休み', 'お休み', '閉園']);

// 春分・秋分は天文計算によるため期限付きテーブル（範囲外の年は祝日判定から
// 単に外れるだけ＝除外されず登録候補に残る、という安全側の挙動になる）
const JP_EQUINOX = {
  2025: ['03-20', '09-23'], 2026: ['03-20', '09-23'], 2027: ['03-21', '09-23'],
  2028: ['03-20', '09-22'], 2029: ['03-20', '09-23'], 2030: ['03-20', '09-23'],
  2031: ['03-21', '09-23']
};

const jpHolidayCache = new Map();
function jpHolidaySet(year) {
  if (jpHolidayCache.has(year)) return jpHolidayCache.get(year);
  const pad = n => String(n).padStart(2, '0');
  const dstr = (m, d) => `${year}-${pad(m)}-${pad(d)}`;
  const dow = s => new Date(`${s}T00:00:00Z`).getUTCDay();
  const nthMonday = (m, nth) => {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const s = dstr(m, d);
      if (dow(s) === 1 && ++count === nth) return s;
    }
  };
  const base = new Set([
    dstr(1, 1),                          // 元日
    nthMonday(1, 2),                     // 成人の日
    dstr(2, 11),                         // 建国記念の日
    dstr(2, 23),                         // 天皇誕生日
    dstr(4, 29),                         // 昭和の日
    dstr(5, 3), dstr(5, 4), dstr(5, 5),  // 憲法記念日・みどりの日・こどもの日
    nthMonday(7, 3),                     // 海の日
    dstr(8, 11),                         // 山の日
    nthMonday(9, 3),                     // 敬老の日
    nthMonday(10, 2),                    // スポーツの日
    dstr(11, 3), dstr(11, 23)            // 文化の日・勤労感謝の日
  ]);
  for (const md of (JP_EQUINOX[year] || [])) base.add(`${year}-${md}`); // 春分・秋分
  const all = new Set(base);
  const next = s => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  // 振替休日: 日曜に当たった祝日は、直後の「祝日でない日」が休日になる
  for (const s of base) {
    if (dow(s) === 0) {
      let t = next(s);
      while (all.has(t)) t = next(t);
      all.add(t);
    }
  }
  // 国民の休日: 前日と翌日を祝日に挟まれた平日は休日になる（例: 2026-09-22）
  for (const s of [...base]) {
    const t = next(s);
    if (!all.has(t) && base.has(next(t)) && dow(t) !== 0) all.add(t);
  }
  jpHolidayCache.set(year, all);
  return all;
}

function jpIsHoliday(dateStr) {
  return jpHolidaySet(Number(dateStr.slice(0, 4))).has(dateStr);
}

// 照合用の正規化: 空白・行頭の絵文字/記号・末尾の短い括弧書き（祝・休園等）を剥がす
function bulkNormalizeName(summary) {
  return String(summary)
    .replace(/[\s　]+/g, '')
    .replace(/^[^0-9A-Za-zぁ-んァ-ヶ一-龠]+/, '')
    .replace(/[（(](祝日?|休園|休み|お休み)[)）]$/, '');
}

// 除外理由を返す（除外しない場合は null）。正規化前の生イベントを渡す。
// - 祝日名: 日付にかかわらず名前だけで除外（行ズレしていても消えるのが狙い）
// - 素の休園: 単日・時刻なし・note空・日曜または祝日の日付、のときのみ除外
function bulkAutoExcludeReason(ev) {
  const name = bulkNormalizeName(ev.summary);
  if (JP_HOLIDAY_NAMES.has(name)) return 'holiday';
  if (JP_PLAIN_CLOSURE_NAMES.has(name)) {
    const multiDay = typeof ev.endDate === 'string' && GRID_DATE_RE.test(ev.endDate) && ev.endDate > ev.date;
    const hasTime = typeof ev.startTime === 'string' && GRID_TIME_RE.test(ev.startTime);
    const hasNote = typeof ev.note === 'string' && ev.note.trim() !== '';
    const sunday = new Date(`${ev.date}T00:00:00Z`).getUTCDay() === 0;
    if (!multiDay && !hasTime && !hasNote && (sunday || jpIsHoliday(ev.date))) return 'closure';
  }
  return null;
}
// ── 自動除外フィルタここまで ──

// /grid/extract のハンドラー本体から切り出した3ラン多数決抽出（挙動は切り出し前と同一）。
// 旧 /grid/extract と新 /bulk/extract の両方がこれを呼ぶ。
// extraPrompt はユーザー回答（対象年月など）をプロンプト末尾に追記するためのもので、
// 旧エンドポイントからは常に空文字（＝従来とバイト同一のプロンプト）。
async function runGridExtraction(filePart, opts) {
    const { selectedClasses, userTimeZone, targetLang, extraPrompt = '' } = opts;
    const langInstruction = gridLangInstruction(targetLang);

    const now = new Date();
    const nowStr = now.toLocaleString('ja-JP', { timeZone: userTimeZone });

    const prompt = `添付は幼稚園・保育園・学校などの「月間予定表」（日付×クラス列のグリッド表）です。以下のルールに厳密に従い、対象クラス列の予定を抽出してJSONのみを出力してください。

【対象クラス列】
${selectedClasses.map(c => `- ${c}`).join('\n')}
上記の列（および複数列にまたがる帯状の記載のうち、上記の列にかかっているもの）だけを抽出対象とする。他の列だけの予定は出力しない。

【行（日付）の対応の厳密判定（行ズレ厳禁・最重要）】
- 日付の行境界とは「左端の日付欄に新しい日付番号が現れる位置の線」だけである。それ以外の線（セル内の点線・細い区切り線）は日付の境界ではない。
- 1つの日の行が縦に高く、セル内が点線などで上下複数段に分かれていても、左の日付番号が変わるまではすべて同じ日の予定である。段の上下は日付と無関係。
- 具体例: 左端に「8 金」とある行の縦幅の中に、点線を挟んで上段「音楽あそび」・下段「避難訓練(ほし)」が書かれている場合、両方とも8日の予定である。上段を7日に割り当てるのは典型的な誤りであり、絶対にしてはならない。
- 各予定がどの日に属するかは、予定テキストの垂直位置（Y座標）が「左端の日付番号の上下境界の内側」にあるかだけで判定する。迷ったら、その予定テキストの真横（同じ高さ）にある日付番号を読み直すこと。
- 出力前に、各イベントについて「その日付の行に本当にそのテキストが書かれているか」を1件ずつ照合すること。

【列の対応の厳密判定（混入厳禁）】
- あるテキストがどの列に属するかは、そのテキストの水平位置（X座標）が「対象列の見出しの真下の範囲」に収まっているかだけで判定する。
- 隣の列（例: 年長組・年中組など対象外の列）に書かれた予定を、対象列の予定として出力してはならない。内容が似ていても列が違えば別物である。
- 例外は、複数列の幅を物理的に貫いて描かれている帯・結合セルのみ。その場合も、実際にまたがっている列だけを columns に列挙する。

【抽出の手順（必ずこの順で行うこと）】
1. まず表の列構造を把握し、対象クラス列の左右の境界線の位置を特定する。
2. 次に1日から月末まで「1日ずつ」順に、対象列のセルだけを見る。
3. 各セルについて、セル内に書かれている項目（行）をすべて数え、1項目=1イベントとして漏れなく出力する。セル内が点線等で上下に分割されている場合、それぞれ独立した項目だが、日付はすべて同じ（その行の日付）である。
4. 最後に、複数列を貫く帯（休園・全体行事など）と矢印を処理する。

【年月の決定】
- 表のタイトル・欄外から年月を読み取る。年が明記されていない場合は、現在日時（${nowStr}）を基準に、その月が当月以降で最も近くなる年と解釈する。
- 日付は必ず "YYYY-MM-DD" 形式。その月に存在しない日付を絶対に出力しない。

【1セル内の複数予定の分離（見落とし厳禁）】
- 1つのセルに複数の予定が書かれていることは非常に多い。区切りは点線・実線・中黒(・)とは限らず、「改行だけ」で並んでいる場合も必ずそれぞれ別のイベントとして分離して出力する。
- 行頭にアイコン・絵文字・記号（🎈・★・♪ など）が付いた行や、括弧書きの学年・グループ名が付いた行（例:「身体測定(つくし)」「誕生会(ひよこ)」）も、それぞれ独立した1つの予定である。括弧書きやアイコンの有無を理由に予定を省略してはならない。括弧書きのグループ名は summary にそのまま含めて出力する。
- 例外は「1つの予定名が長くてセル内で折り返されているだけ」の場合のみ（行末が助詞や語の途中で終わり、次行と繋げて初めて意味が通るケース）。折り返しか別予定か迷う場合は、別予定として分離した上で confidence を "low" にする。
- 自己検証: 各セルについて書かれている行・項目の数を数え、出力した予定の数がそれより少なくなっていないか出力前に確認すること。セル内の2行目以降を捨てることは絶対に許されない。

【複数列にまたがる帯】
- 複数のクラス列を横断する帯状の記載（灰色の網掛け・セル結合など。例: 休園日、全体行事）は、その帯がまたいでいる列すべてに適用される予定である。
- "columns" にその帯がまたいでいる列見出し名をすべて列挙する。表のクラス列全体にまたがる場合は "allColumns": true とし columns は [] でよい。
- 帯が複数日にわたる場合は date に開始日、endDate に最終日を設定する。
- 帯は「その帯が実際に描かれている日（行）」のみに適用する。書かれていない前後の日（例: 隣の土曜日）に推測で複製・拡張してはならない。休園の帯が5日の行にだけあるなら、休園は5日だけである。

【矢印の処理（最重要・厳守）】
表内の矢印（→・⇒・点線矢印・日をまたぐ線）は次の2種類を厳密に区別する:
A) 矢印の始点と終点の両方に予定名テキストが明記されている場合（例: 始点「お泊まり保育」→ 終点「お泊まり保育予備日」）:
   → 始点・終点をそれぞれ独立した別イベントとして出力する。矢印で結ばれていても1つの期間予定にまとめない。
B) 終点（または経路上）に予定名テキストがなく、「同じ状態が続く」ことを示すだけの曖昧な矢印:
   → イベントとして出力してはならない。予定名を推測・創作することを固く禁止する。
   → 代わりに "notices" に {"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "nearbyText": "始点付近に書かれたテキスト(あれば、なければnull)"} を1件追加する。
C) notices の生成条件（厳守）:
   - notices を出してよいのは「矢印・継続を示す線・記号が、その日付範囲のセル上に物理的に描かれている」場合だけである。出力する前に、その矢印が画像のどこに描かれているかを自分で特定できていることを確認せよ。
   - 何も描かれていない空白のセル・空白の期間に対して、「予定が無い期間だから念のため」という理由で notices を作ることを固く禁止する。
   - 矢印が存在するかどうか自体が不確かな場合は、notices も出さない（何も出力しない）。notices は「矢印は確実に存在するが、終点にテキストがない」場合専用である。
   - 対象クラス列（またはそれを含む帯）にかかっていない矢印（対象外の列だけを通る矢印）については notices を出さない。
   - 表の欄外・脚注の案内文（例: 相談窓口のお知らせ）は予定でも notices でもない。無視する。

【confidence（未検証フラグ）】
- 文字が不鮮明、判読があいまい、日付やクラス列との対応が不確実、手書きで自信がない――など、少しでも確信が持てない項目は "confidence": "low" とする。
- 確実に読み取れた項目のみ "confidence": "high" とする。迷ったら必ず "low" にする。

【時刻】
- セル内に時刻表記（例: 10:00〜11:30、9時集合）があれば startTime / endTime に "HH:mm"（24時間表記）で設定。終了が不明なら endTime は null。時刻がなければ両方 null（終日予定）。
- "24:00" は使用禁止。

【その他】
- ${langInstruction}
- 曜日だけのセル、空欄、日付そのものはイベントにしない。
- 取得したユーザーデータをAI/MLモデルのトレーニングに利用することはありません。

【曜日の書き写し（必須）】
- 表に曜日欄がある場合、各イベントの "weekday" に「その予定の行に印字されている曜日」を月/火/水/木/金/土/日の一文字で設定する（曜日欄がない表では null）。
- weekday を date から計算してはならない。必ず画像に印字されている文字をそのまま書き写すこと。照合はこちらで行う。

【出力形式（このJSONのみを出力）】
{"isGrid": true, "year": 2026, "month": 7, "events": [{"summary": "予定名", "date": "YYYY-MM-DD", "weekday": "月〜日の一文字 または null", "endDate": "YYYY-MM-DD または null", "startTime": "HH:mm または null", "endTime": "HH:mm または null", "columns": ["列見出し名", ...], "allColumns": false, "confidence": "high または low", "note": "補足があれば文字列、なければ null"}], "notices": [{"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "nearbyText": "文字列 または null"}]}
グリッド表として解析できない場合は {"isGrid": false, "events": [], "notices": []} を返す。` + extraPrompt;

    // コンセンサス方式: 同じ画像で2回並列に抽出し、両方が一致した予定のみ high、
    // 食い違い・片方のみの予定は「未検証(low)」としてユーザー確認に回す。
    // 密度の高い実物の予定表では1回の抽出結果が実行ごとに揺らぐため、
    // 揺らぎを silent な誤登録ではなく確認対象として顕在化させる。
    // 3つの呼び出しに温度差とプロンプトの微差を持たせ、判定の独立性を確保する
    // （完全同一リクエストだと同じ解釈に収束し、コンセンサスの意味がなくなるため）
    const runs = await Promise.all([
      gridGenerateJson(filePart, prompt, 0),
      gridGenerateJson(filePart, prompt + '\n【追記】行と列の対応の検算は、日付欄を1日ずつ指差し確認するつもりで特に念入りに行うこと。', 0.3),
      gridGenerateJson(filePart, prompt + '\n【追記】出力前に、各セルの項目数と出力イベント数、および各イベントの日付の対応をもう一度点検すること。', 0.6)
    ]);
    const validRuns = runs.filter(r => r && r.isGrid);

    if (validRuns.length === 0) return { isGrid: false };
    const parsed = validRuns[0];

    // 照合キーは空白・全角空白を除去して正規化（「休園」と「休 園」の表記ゆれで
    // コンセンサス不一致＝重複候補になるのを防ぐ）
    const evKey = (ev) => `${(ev?.summary || '').replace(/[\s　]+/g, '')}|${ev?.allColumns === true ? '*' : (Array.isArray(ev?.columns) ? ev.columns.slice().sort().join(',') : '')}|${ev?.date}`;

    // 多数決: 3ラン中2ラン以上が一致（かつ全てhigh）した予定のみ high、
    // それ以外（1ランのみ・判定が割れた・自己申告low）は「未検証」として全候補を提示する
    const voteMap = new Map();
    for (const run of validRuns) {
      const seenInRun = new Set();
      for (const ev of (Array.isArray(run.events) ? run.events : [])) {
        const k = evKey(ev);
        if (seenInRun.has(k)) continue;
        seenInRun.add(k);
        const cur = voteMap.get(k);
        if (cur) {
          cur.count++;
          cur.allHigh = cur.allHigh && ev.confidence === 'high';
        } else {
          voteMap.set(k, { count: 1, allHigh: ev.confidence === 'high', ev });
        }
      }
    }
    const rawEvents = [];
    for (const { count, allHigh, ev } of voteMap.values()) {
      rawEvents.push({ ...ev, confidence: (count >= 2 && allHigh) ? 'high' : 'low' });
    }

    // notices もイベント同様に多数決: 3ラン中2ラン以上が検出した矢印のみ採用する
    // （1ランだけの notices は幻視の可能性が高いため捨てる）。
    // ランごとに開始日・終了日が±1日ぶれるため、完全一致ではなく
    // 「日付範囲が重なる（±1日の余裕あり）」もの同士を同じ矢印としてグルーピングし、
    // 採用時の日付は中央値を使う。
    const allNotices = [];
    validRuns.forEach((run, ri) => {
      (Array.isArray(run.notices) ? run.notices : []).forEach(n => {
        if (!n || typeof n.startDate !== 'string' || !GRID_DATE_RE.test(n.startDate)) return;
        const endDate = (typeof n.endDate === 'string' && GRID_DATE_RE.test(n.endDate) && n.endDate >= n.startDate) ? n.endDate : n.startDate;
        allNotices.push({ run: ri, startDate: n.startDate, endDate: endDate, nearbyText: typeof n.nearbyText === 'string' ? n.nearbyText : null });
      });
    });
    // グルーピングは各グループの代表（最初の項目）と「実際に日付範囲が重なる」場合のみ。
    // 連鎖マージ（AとB、BとCが重なるからAとCも同一扱い）で別々の矢印が融合するのを防ぐ。
    const noticeGroups = [];
    for (const n of allNotices) {
      const group = noticeGroups.find(gr => {
        const seed = gr.items[0];
        return seed.endDate >= n.startDate && n.endDate >= seed.startDate;
      });
      if (group) {
        group.items.push(n);
        group.runs.add(n.run);
      } else {
        noticeGroups.push({ items: [n], runs: new Set([n.run]) });
      }
    }
    const noticesUnion = [];
    for (const gr of noticeGroups) {
      if (gr.runs.size < 2) continue;
      const starts = gr.items.map(i => i.startDate).sort();
      const ends = gr.items.map(i => i.endDate).sort();
      noticesUnion.push({
        startDate: starts[Math.floor(starts.length / 2)],
        endDate: ends[Math.floor(ends.length / 2)],
        nearbyText: (gr.items.find(i => i.nearbyText) || {}).nearbyText || null
      });
    }
    parsed.notices = noticesUnion;
    const events = [];
    let autoExcluded = 0;
    for (const ev of rawEvents) {
      if (!ev || typeof ev.summary !== 'string' || !ev.summary.trim()) continue;
      if (typeof ev.date !== 'string' || !GRID_DATE_RE.test(ev.date)) continue;

      // 自動除外: 祝日名そのもの・日曜/祝日の素の休園は登録候補にしない
      if (bulkAutoExcludeReason(ev)) { autoExcluded++; continue; }

      const evColumns = Array.isArray(ev.columns) ? ev.columns.filter(c => typeof c === 'string') : [];
      // 帯(全列)は選択した全クラスへ複製。個別列はクラス名が一致するものだけ。
      const applicable = ev.allColumns === true
        ? selectedClasses
        : selectedClasses.filter(c => evColumns.includes(c));
      if (applicable.length === 0) continue;

      // 曜日の機械的検算: 表に印字された曜日と date の実際の曜日が食い違う場合は
      // 行ズレの可能性が高いので「未検証」に落とし、ユーザー確認へ回す
      let confidence = ev.confidence === 'high' ? 'high' : 'low';
      if (typeof ev.weekday === 'string' && ev.weekday) {
        const JP_DAYS = ['日', '月', '火', '水', '木', '金', '土'];
        const idx = JP_DAYS.indexOf(ev.weekday.replace(/曜日?$/, '').trim());
        if (idx >= 0 && new Date(`${ev.date}T00:00:00Z`).getUTCDay() !== idx) {
          confidence = 'low';
        }
      }

      for (const className of applicable) {
        events.push({
          summary: ev.summary.trim().slice(0, 200),
          date: ev.date,
          endDate: (typeof ev.endDate === 'string' && GRID_DATE_RE.test(ev.endDate) && ev.endDate > ev.date) ? ev.endDate : null,
          startTime: (typeof ev.startTime === 'string' && GRID_TIME_RE.test(ev.startTime)) ? ev.startTime : null,
          endTime: (typeof ev.endTime === 'string' && GRID_TIME_RE.test(ev.endTime)) ? ev.endTime : null,
          className: className,
          isCommon: ev.allColumns === true || evColumns.length > 1,
          confidence: confidence,
          note: typeof ev.note === 'string' ? ev.note.slice(0, 500) : null
        });
        if (events.length >= GRID_MAX_EVENTS) break;
      }
      if (events.length >= GRID_MAX_EVENTS) break;
    }

    // 最終重複排除: クラス展開後に (予定名[空白除去], 日付, クラス) が同一のものは
    // 1件にまとめる（highを優先）。ラン間の列解釈差による重複対策。
    {
      const byKey = new Map();
      for (const e of events) {
        const k = `${e.summary.replace(/[\s　]+/g, '')}|${e.date}|${e.className}`;
        const cur = byKey.get(k);
        if (!cur || (cur.confidence !== 'high' && e.confidence === 'high')) byKey.set(k, e);
      }
      events.length = 0;
      events.push(...byKey.values());
    }

    const notices = (Array.isArray(parsed.notices) ? parsed.notices : [])
      .filter(n => n && typeof n.startDate === 'string' && GRID_DATE_RE.test(n.startDate))
      .map(n => ({
        startDate: n.startDate,
        endDate: (typeof n.endDate === 'string' && GRID_DATE_RE.test(n.endDate)) ? n.endDate : n.startDate,
        nearbyText: typeof n.nearbyText === 'string' ? n.nearbyText.slice(0, 100) : null
      }))
      .slice(0, 20);

    // 日付順 → クラス順で安定ソート
    events.sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')) || a.className.localeCompare(b.className));

    if (autoExcluded > 0) console.log(`GRID EXTRACT FILTER: auto-excluded ${autoExcluded} candidate(s) (holiday name / regular closure)`);

    return {
      isGrid: true,
      year: Number.isInteger(parsed.year) ? parsed.year : null,
      month: Number.isInteger(parsed.month) ? parsed.month : null,
      events: events,
      notices: notices
    };
}

// ── 3. ユーザー確認済みの予定を一括登録（回数1消費） ─────────
app.post('/grid/register', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  const lang = gridUserLang(req);

  let limitState;
  try {
    limitState = await gridCheckLimit(subId);
  } catch (e) {
    console.error('GRID: pre-check error:', e.message);
    return res.status(500).json({ error: 'Subscription service error. Please try again later.' });
  }
  if (limitState.banned) return res.status(403).json({ error: 'Account suspended due to excessive errors.' });
  if (limitState.limitReached) return res.json({ limitReached: true, premiumLimit: limitState.premiumLimit || false, nextResetDate: limitState.nextResetDate || '', redirectUrl: limitState.stripeUrl || '' });

  try {
    const body = req.body || {};
    const colorId = (body.colorId && body.colorId !== '0') ? String(body.colorId) : null;
    const userTimeZone = typeof body.timeZone === 'string' && body.timeZone ? body.timeZone : 'Asia/Tokyo';
    const multiClass = body.multiClass === true; // 複数クラス選択時はクラス名を予定名に付ける

    const rawEvents = Array.isArray(body.events) ? body.events.slice(0, GRID_MAX_EVENTS) : [];
    const events = rawEvents.filter(ev =>
      ev && typeof ev.summary === 'string' && ev.summary.trim() &&
      typeof ev.date === 'string' && GRID_DATE_RE.test(ev.date) &&
      (ev.startTime == null || GRID_TIME_RE.test(ev.startTime)) &&
      (ev.endTime == null || GRID_TIME_RE.test(ev.endTime)) &&
      (ev.endDate == null || (typeof ev.endDate === 'string' && GRID_DATE_RE.test(ev.endDate)))
    );
    if (events.length === 0) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    // 既存 /upload と同じ認証情報の組み立て（リフレッシュトークン優先）
    const userAuth = getOAuth2Client();
    const savedRefreshToken = await db.getRefreshToken(subId);
    const currentTokens = req.session?.tokens;

    if (!savedRefreshToken && !currentTokens) {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    if (savedRefreshToken) {
      userAuth.setCredentials({ refresh_token: savedRefreshToken });
    } else {
      userAuth.setCredentials(currentTokens);
    }
    userAuth.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        db.saveRefreshToken(subId, tokens.refresh_token);
      }
      if (req.session) req.session.tokens = { ...req.session.tokens, ...tokens };
    });

    const calendar = google.calendar({ version: 'v3', auth: userAuth });

    let registered = 0;
    const insertedEventIds = []; // 取り消し(undo)用に登録したイベントIDを収集
    for (const ev of events) {
      const summary = (multiClass && ev.className ? `【${String(ev.className).slice(0, 30)}】` : '') + ev.summary.trim().slice(0, 200);
      const resource = {
        summary: summary,
        description: typeof ev.note === 'string' && ev.note ? ev.note.slice(0, 500) : ''
      };
      if (ev.startTime) {
        const endDate = ev.endDate || ev.date;
        // 終了時刻が無い場合は1時間の予定とする
        let endTime = ev.endTime;
        if (!endTime) {
          const [h, m] = ev.startTime.split(':').map(Number);
          endTime = `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        resource.start = { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: userTimeZone };
        resource.end = { dateTime: `${endDate}T${endTime}:00`, timeZone: userTimeZone };
      } else {
        // 終日予定: Google Calendar は end.date を排他的終端として扱う
        resource.start = { date: ev.date };
        resource.end = { date: gridNextDay(ev.endDate || ev.date) };
      }
      if (colorId) resource.colorId = colorId;

      const inserted = await calendar.events.insert({ calendarId: 'primary', resource: resource });
      if (inserted?.data?.id) insertedEventIds.push(inserted.data.id);
      registered++;
    }

    // 取り消し用バッチを保存。保存に失敗しても登録自体は成功として扱う
    // （その場合レスポンスの batchId が null になり、取り消しボタンが出ないだけ）
    let batchId = null;
    if (insertedEventIds.length > 0) {
      try {
        batchId = randomUUID();
        await dbGrid.saveGridBatch(subId, batchId, insertedEventIds);
      } catch (e) {
        console.error('GRID BATCH SAVE ERROR:', e.message);
        batchId = null;
      }
    }

    // 利用回数は登録バッチ1回につき1消費（既存フローの消費タイミングに合わせる）
    await db.addUsageHistory(subId);
    await db.resetErrorCount(subId);

    const finalStatus = await db.getUserStatus(subId);
    let finalCount = 0;
    let nextResetDate = '';
    if (finalStatus?.isPremium) {
      const since = new Date(finalStatus.premiumSince);
      const cycleHistory = (finalStatus.history || []).filter(h => new Date(h) >= since);
      finalCount = Math.max(0, 30 - cycleHistory.length);
      const resetDate = new Date(since);
      resetDate.setMonth(resetDate.getMonth() + 1);
      nextResetDate = `${resetDate.getMonth() + 1}/${resetDate.getDate()}`;
    } else {
      finalCount = Math.max(0, 3 - (finalStatus?.history?.length || 0));
    }

    const firstDate = events.map(e => e.date).sort()[0];
    const d = new Date(`${firstDate}T00:00:00`);
    const targetMonth = `${d.getFullYear()}/${d.getMonth() + 1}/1`;

    res.json({
      success: true,
      registered: registered,
      batchId: batchId,
      count: finalCount,
      isPremium: finalStatus?.isPremium || false,
      nextResetDate: nextResetDate,
      targetMonth: targetMonth
    });
  } catch (e) {
    console.error('GRID REGISTER ERROR:', e);
    if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('invalid_token') || e.message?.includes('credentials')) {
      return res.status(401).json({ error: 'Session expired.' });
    }
    if (e.code === 403 || e.code === '403' || e.status === 403 || e.errors?.[0]?.reason === 'insufficientPermissions') {
      return res.status(403).json({ error: 'Insufficient permission.' });
    }
    res.status(500).json({ error: gridMsg(lang, 'parseError') });
  }
});

// ── 4. 直近の一括登録の取り消し（undo） ─────────────────────
// batchId に紐づくカレンダーイベントをすべて削除し、Firestoreの一時データも消す。
// 利用回数・決済には一切触れない（取り消しても消費回数は戻さない＝悪用防止）。
app.post('/grid/undo', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  const lang = gridUserLang(req);

  try {
    const batchId = typeof req.body?.batchId === 'string' ? req.body.batchId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    // 所有者チェック: 他人のbatchIdを指定しても削除できない
    const batch = await dbGrid.getGridBatch(batchId);
    if (!batch || batch.subId !== subId) {
      return res.json({ success: false, error: gridMsg(lang, 'undoNotFound') });
    }

    // 既存 /upload・/grid/register と同じ認証情報の組み立て
    const userAuth = getOAuth2Client();
    const savedRefreshToken = await db.getRefreshToken(subId);
    const currentTokens = req.session?.tokens;
    if (!savedRefreshToken && !currentTokens) {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    if (savedRefreshToken) {
      userAuth.setCredentials({ refresh_token: savedRefreshToken });
    } else {
      userAuth.setCredentials(currentTokens);
    }
    userAuth.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        db.saveRefreshToken(subId, tokens.refresh_token);
      }
      if (req.session) req.session.tokens = { ...req.session.tokens, ...tokens };
    });

    const calendar = google.calendar({ version: 'v3', auth: userAuth });

    let deleted = 0;
    for (const eventId of (Array.isArray(batch.eventIds) ? batch.eventIds : [])) {
      try {
        await calendar.events.delete({ calendarId: 'primary', eventId: eventId });
        deleted++;
      } catch (e) {
        const code = Number(e.code || e.status);
        // ユーザーが手動で消した等、既に存在しないイベントは成功扱いで続行
        if (code === 404 || code === 410) { deleted++; continue; }
        throw e; // それ以外（認証エラー等）は中断。バッチは残すので再試行できる
      }
    }

    // 全件削除できた場合のみ一時データを消す
    await dbGrid.deleteGridBatch(batchId);

    res.json({ success: true, deleted: deleted });
  } catch (e) {
    console.error('GRID UNDO ERROR:', e);
    if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('invalid_token') || e.message?.includes('credentials')) {
      return res.status(401).json({ error: 'Session expired.' });
    }
    if (e.code === 403 || e.code === '403' || e.status === 403 || e.errors?.[0]?.reason === 'insufficientPermissions') {
      return res.status(403).json({ error: 'Insufficient permission.' });
    }
    res.status(500).json({ error: gridMsg(lang, 'undoError') });
  }
});

// ═══════════════════════════════════════════════════════════════
// 一括登録（bulk）モード = グリッドモードの汎用化
// Stage1+2統合の書類タイプ判定＋質問生成（/bulk/triage）と、
// 非対称ルーティング付きの抽出（/bulk/extract）。
// レビュー・登録・取り消しは既存の /grid/register・/grid/undo を無改修で流用。
// 旧 /grid/columns・/grid/extract は、ブラウザにキャッシュされた旧フロントの
// ために当面残す（次々回のデプロイで削除予定）。
// ═══════════════════════════════════════════════════════════════

const BULK_DOC_TYPES = ['grid_monthly', 'weekly_schedule', 'list_schedule', 'menu_monthly', 'single_flyer', 'shift_table', 'other'];
const BULK_QUESTION_TYPES = ['column_select', 'region_select', 'date_confirm', 'target_select', 'free'];
const BULK_LANG_NAMES = { ja: '日本語', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español' };

// 非対称ルーティング: LLMの分類を確率として信用せず、グリッド構造の可能性が
// 少しでも上位にあれば安全側（3ラン多数決の専用ハンドラー）に倒す。
// weekly_schedule も「日付×クラス列」構造（hasColumns=列が検出/選択済み）なら
// grid と同じ防御機構（多数決・notices・帯の複製）を適用する（2026-07-06拡張）。
// 誤判定のコストはGemini呼び出しの増加（内部フォールバック）に限定される。
function bulkIsGridRoute(docTypes, hasColumns) {
  const top2 = docTypes.slice(0, 2);
  return top2.includes('grid_monthly') || (top2.includes('weekly_schedule') && hasColumns === true);
}

// 曜日検算（汎用版）: 日本語一文字に加えて英語3文字（Mon〜Sun）も照合。
// それ以外の表記は検算スキップ（false = 不一致なし扱い）。
function bulkWeekdayMismatch(weekday, date) {
  if (typeof weekday !== 'string' || !weekday.trim()) return false;
  const w = weekday.replace(/曜日?$/, '').trim();
  const JP = ['日', '月', '火', '水', '木', '金', '土'];
  const EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let idx = JP.indexOf(w);
  if (idx < 0) idx = EN.indexOf(w.slice(0, 3).toLowerCase());
  if (idx < 0) return false;
  return new Date(`${date}T00:00:00Z`).getUTCDay() !== idx;
}

// 質問への回答をプロンプト追記用の行に整形する
function bulkAnswerLines(answers, { excludeColumns = false } = {}) {
  const lines = [];
  for (const a of answers) {
    if (excludeColumns && a.type === 'column_select') continue;
    if (!a.values.length) continue;
    lines.push(`- ${a.prompt || a.type}: ${a.values.join(' / ')}`);
  }
  return lines;
}

// 汎用抽出（1ラン・temperature 0）。グリッド以外の予定表・献立表・チラシ・
// シフト表向け。多数決の保険がない代わりに evidence（根拠の書き写し）を
// 要求して捏造を抑止し、low はレビューUIの「未検証」バッジで確認を促す。
async function runGenericExtraction(filePart, opts) {
  const { userTimeZone, targetLang, docTypes = [], answerLines = [] } = opts;
  const langInstruction = gridLangInstruction(targetLang);
  const now = new Date();
  const nowStr = now.toLocaleString('ja-JP', { timeZone: userTimeZone });
  const docHint = docTypes.filter(d => d !== 'other').join(' / ') || '種類不明';

  const answerSection = answerLines.length
    ? `\n【ユーザーの回答（厳守）】\n${answerLines.join('\n')}\n- 対象の年月に関する回答がある場合、year・month・各dateは必ずその回答に従うこと。\n- 対象の列・人・系列に関する回答がある場合、その対象の予定だけを抽出すること。\n`
    : '';

  const prompt = `添付は「${docHint}」タイプと思われる予定情報（予定表・献立表・行事チラシ・シフト表など）です。以下のルールに厳密に従い、カレンダーに登録する予定を抽出してJSONのみを出力してください。
${answerSection}
【抽出ルール】
- 各予定に必須のフィールド: summary（予定名）/ date（"YYYY-MM-DD"）/ endDate（複数日にわたる場合の最終日、なければ null）/ startTime・endTime（"HH:mm" 24時間表記、なければ null。"24:00" は使用禁止）/ target（その予定が属する列・人・系列名。なければ null）/ confidence（"high" または "low"）/ evidence（どの印字テキスト・記号から抽出したかの書き写し20字以内）/ weekday（その予定の行・欄に印字されている曜日の書き写し。月〜日の一文字または Mon〜Sun 形式。印字がなければ null。date から計算してはならない）
- 捏造禁止: 書類に物理的に書かれていない予定名・日付を出力しない。読み取りに少しでも自信がなければ confidence を "low" にする。
- ノイズ除外: 献立の材料・分量(g)・栄養価、事務的な脚注、発行元情報、相談窓口の案内、広告はイベントにしない。
- 献立表（menu_monthly）の場合: 1日につき1件の終日予定にまとめ、summary は主菜を中心とした短い献立名にする。時刻は付けない。
- 1つのセル・1行に複数の予定が並んでいる場合は、それぞれ別の予定として分離する。
- 年月の決定: 書類のタイトル・欄外から読み取る。年が明記されていない場合は、現在日時（${nowStr}）を基準に、その月が当月以降で最も近くなる年と解釈する。その月に存在しない日付を絶対に出力しない。
- ${langInstruction}
- 取得したユーザーデータをAI/MLモデルのトレーニングに利用することはありません。

【出力形式（このJSONのみを出力）】
{"hasEvents": true または false, "year": 数値 または null, "month": 数値 または null, "events": [{"summary": "予定名", "date": "YYYY-MM-DD", "endDate": "YYYY-MM-DD または null", "startTime": "HH:mm または null", "endTime": "HH:mm または null", "target": "文字列 または null", "weekday": "文字列 または null", "confidence": "high または low", "evidence": "根拠の書き写し"}]}
予定が1件も読み取れない場合は {"hasEvents": false, "year": null, "month": null, "events": []} を返す。`;

  const parsed = await gridGenerateJson(filePart, prompt, 0);
  const rawEvents = Array.isArray(parsed?.events) ? parsed.events : [];

  const events = [];
  let autoExcluded = 0;
  for (const ev of rawEvents) {
    if (!ev || typeof ev.summary !== 'string' || !ev.summary.trim()) continue;
    if (typeof ev.date !== 'string' || !GRID_DATE_RE.test(ev.date)) continue;

    // 自動除外: 祝日名そのもの・日曜/祝日の素の休園は登録候補にしない
    if (bulkAutoExcludeReason(ev)) { autoExcluded++; continue; }

    // 曜日の機械的検算: 印字曜日と date の実曜日が食い違う場合は行ズレの
    // 可能性が高いので「未検証」に落とす（グリッド側と同じ設計）
    let confidence = ev.confidence === 'high' ? 'high' : 'low';
    if (bulkWeekdayMismatch(ev.weekday, ev.date)) confidence = 'low';

    events.push({
      summary: ev.summary.trim().slice(0, 200),
      date: ev.date,
      endDate: (typeof ev.endDate === 'string' && GRID_DATE_RE.test(ev.endDate) && ev.endDate > ev.date) ? ev.endDate : null,
      startTime: (typeof ev.startTime === 'string' && GRID_TIME_RE.test(ev.startTime)) ? ev.startTime : null,
      endTime: (typeof ev.endTime === 'string' && GRID_TIME_RE.test(ev.endTime)) ? ev.endTime : null,
      className: (typeof ev.target === 'string' && ev.target.trim()) ? ev.target.trim().slice(0, 30) : null,
      isCommon: false,
      confidence: confidence,
      note: null
    });
    if (events.length >= GRID_MAX_EVENTS) break;
  }

  // (予定名[空白除去], 日付, 対象) が同一のものは1件にまとめる（highを優先）
  {
    const byKey = new Map();
    for (const e of events) {
      const k = `${e.summary.replace(/[\s　]+/g, '')}|${e.date}|${e.className || ''}`;
      const cur = byKey.get(k);
      if (!cur || (cur.confidence !== 'high' && e.confidence === 'high')) byKey.set(k, e);
    }
    events.length = 0;
    events.push(...byKey.values());
  }

  events.sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')) || (a.className || '').localeCompare(b.className || ''));

  if (autoExcluded > 0) console.log(`GENERIC EXTRACT FILTER: auto-excluded ${autoExcluded} candidate(s) (holiday name / regular closure)`);

  return {
    year: Number.isInteger(parsed?.year) ? parsed.year : null,
    month: Number.isInteger(parsed?.month) ? parsed.month : null,
    events: events,
    notices: []
  };
}

// ── 一括登録 1. 書類タイプ判定＋メタデータ＋質問生成（Stage1+2統合） ──
// ガードは /grid/columns と同一（セッション必須・BANチェックのみ・回数消費なし）
app.post('/bulk/triage', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  const lang = gridUserLang(req);

  try {
    const status = await db.getUserStatus(subId);
    if (status.isBanned) return res.status(403).json({ error: 'Account suspended due to excessive errors.' });
  } catch (e) {
    console.error('BULK: db.getUserStatus failed:', e.message);
    return res.status(500).json({ error: 'Database service error. Please try again later.' });
  }

  try {
    const { buffer, mimeType, truncated } = await collectGridUpload(req);
    if (truncated) return res.json({ success: false, error: gridMsg(lang, 'tooLarge') });
    if (!buffer || buffer.length === 0 || !(mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    const filePart = await prepareGridPart(buffer, mimeType);
    const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const langName = BULK_LANG_NAMES[lang] || 'English';
    const prompt = `この添付ファイルは、カレンダーに登録したい何らかの予定情報（月間予定表・週間予定表・献立表・行事チラシ・シフト表など）の可能性があります。内容を判定し、以下のJSONのみを出力してください:

{"docTypes": ["..."], "features": {"hasDateAxis": true/false, "hasEntityColumns": true/false, "isSingleItem": true/false, "multiDocument": true/false}, "year": 数値 または null, "month": 数値 または null, "columns": ["..."], "questions": [{"id": "q1", "type": "...", "prompt": "...", "options": ["..."], "multi": true/false}]}

ルール:
1. docTypes: 次の語彙から該当しうるものを可能性の高い順に最大3つ列挙する:
   grid_monthly（日付の行×クラス・学年などの列で構成されたグリッド月間予定表）/ weekly_schedule（週間予定表）/ list_schedule（日付リスト形式の予定一覧）/ menu_monthly（給食などの月間献立表）/ single_flyer（1つの行事の案内・チラシ）/ shift_table（勤務シフト表）/ other（予定情報ではない）
2. features: hasDateAxis（日付の軸があるか）/ hasEntityColumns（クラス・人などの列があるか）/ isSingleItem（単一の予定か）/ multiDocument（独立した複数の書類・掲示物が写っているか）の真偽値。
3. year / month: タイトル・欄外から読み取れれば西暦の数値、読み取れなければ null。
4. columns: 日付・曜日以外の列見出し（grid_monthly / weekly_schedule / shift_table のときのみ。表に書かれている表記のまま左から順に。読み取れない列は列挙しない。それ以外の書類タイプでは []）。
5. questions: ユーザーに確認すべき曖昧点。以下を厳守:
   - type は column_select / region_select / date_confirm / target_select / free のみ。最大3問。free は最大1問。
   - column_select: 対象列（クラス・人・組）の選択。columns を検出した場合は必ず1問生成し、options は columns と同一にする。multi は true。
   - region_select: 独立した複数の書類・掲示物が写っている場合のみ「どれを登録するか」を1問生成する。multi は false。
   - date_confirm: 年・月のどちらか（または両方）が書類から読み取れない場合のみ生成する。「2026年7月」のような年月一体の候補を、現在日時（${nowStr}）を基準に可能性の高い順に2〜3個 options に列挙する。multi は false。
   - target_select: 献立のA/B系列、午前の部/午後の部など、同種の系列が並存し選択が必要な場合。
   - free: 上記に当てはまらない曖昧点で、かつ選択肢を列挙できる場合のみ。自由記入の質問は禁止。multi は false。
   - すべての質問は options（選択肢）を必ず列挙する。選択肢を列挙できない曖昧さは質問にしない。
   - 書類から読み取れる・推測できることを質問してはならない（例: 年月が印字されているのに date_confirm を出す）。
   - 書類に手がかりが全くない曖昧さ（凡例なし・文字潰れ）は質問しても解決しないので質問にしない。
   - 質問文(prompt)と選択肢のラベルは${langName}で書く。ただし書類に印字された固有名（列名・クラス名・系列名等）は原文の表記のまま。
6. カレンダー予定として意味を成さない情報（献立の材料・分量・栄養価、事務的な脚注、発行元情報）は columns にも questions にも含めない。`;

    // thinking OFFで年月推測(date_confirm)の精度劣化を実測確認したため thinking ON に据え置き（2026-07-08）
    const parsed = await gridGenerateJson(filePart, prompt);

    const docTypes = (Array.isArray(parsed?.docTypes) ? parsed.docTypes : [])
      .filter(d => BULK_DOC_TYPES.includes(d))
      .slice(0, 3);

    if (docTypes.length === 0 || docTypes[0] === 'other') {
      await db.incrementErrorCount(subId, 10);
      return res.json({ success: false, error: gridMsg(lang, 'notSchedule') });
    }

    const columns = (Array.isArray(parsed.columns) ? parsed.columns : [])
      .filter(c => typeof c === 'string' && c.trim())
      .map(c => c.trim())
      .slice(0, 20);

    // 質問のサニタイズ: ホワイトリスト外の型・選択肢なしの質問は捨てる
    let freeSeen = false;
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .filter(q => q && BULK_QUESTION_TYPES.includes(q.type) && typeof q.prompt === 'string' && q.prompt.trim())
      .map(q => ({
        id: typeof q.id === 'string' ? q.id.slice(0, 20) : '',
        type: q.type,
        prompt: q.prompt.trim().slice(0, 200),
        options: (Array.isArray(q.options) ? q.options : [])
          .filter(o => typeof o === 'string' && o.trim())
          .map(o => o.trim().slice(0, 80))
          .slice(0, q.type === 'column_select' ? 20 : 12),
        multi: q.type === 'column_select' ? true : q.multi === true
      }))
      .filter(q => {
        if (q.options.length === 0) return false;
        if (q.type === 'free') {
          if (freeSeen) return false;
          freeSeen = true;
        }
        return true;
      })
      .slice(0, 3);

    // column_select は列検出結果と必ず整合させる（保存済み選択の自動適用のため）
    const colQ = questions.find(q => q.type === 'column_select');
    if (colQ && columns.length > 0) colQ.options = columns;
    if (!colQ && columns.length > 0 && bulkIsGridRoute(docTypes, true)) {
      questions.unshift({ id: 'columns', type: 'column_select', prompt: gridMsg(lang, 'qColumns'), options: columns, multi: true });
    }

    // 保存済みのクラス選択（列名が一致するものだけ自動適用の候補として返す）
    const saved = await dbGrid.getGridClassPrefs(subId);
    const savedClasses = saved ? saved.filter(s => columns.includes(s)) : [];

    // 利用状況集計用（usage-stats.mjs が参照）。件数・enum値のみで予定内容は出力しない
    console.log(`BULK TRIAGE: docTypes=${docTypes.join(',')} questions=${questions.slice(0, 3).map(q => q.type).join(',') || 'none'} likelyMode=${bulkIsGridRoute(docTypes, columns.length > 0) ? 'grid' : 'generic'}`);

    const f = parsed.features || {};
    res.json({
      success: true,
      docTypes: docTypes,
      features: {
        hasDateAxis: f.hasDateAxis === true,
        hasEntityColumns: f.hasEntityColumns === true,
        isSingleItem: f.isSingleItem === true,
        multiDocument: f.multiDocument === true
      },
      year: Number.isInteger(parsed.year) ? parsed.year : null,
      month: Number.isInteger(parsed.month) ? parsed.month : null,
      columns: columns,
      questions: questions.slice(0, 3),
      savedClasses: savedClasses,
      likelyMode: bulkIsGridRoute(docTypes, columns.length > 0) ? 'grid' : 'generic'
    });
  } catch (e) {
    console.error('BULK TRIAGE ERROR:', e);
    const isSystemError = e.status === 429 || e.message?.includes('quota') || e.message?.includes('limit');
    if (!isSystemError) {
      await db.incrementErrorCount(subId, 10);
    }
    res.status(500).json({ error: gridMsg(lang, 'parseError') });
  }
});

// ── 一括登録 2. 構造化抽出（Stage3・非対称ルーティング。登録はしない） ──
// 回数消費なし（消費は従来どおり /grid/register）。ガードは /grid/extract と同一。
app.post('/bulk/extract', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  const lang = gridUserLang(req);

  let limitState;
  try {
    limitState = await gridCheckLimit(subId);
  } catch (e) {
    console.error('BULK: pre-check error:', e.message);
    return res.status(500).json({ error: 'Subscription service error. Please try again later.' });
  }
  if (limitState.banned) return res.status(403).json({ error: 'Account suspended due to excessive errors.' });
  if (limitState.limitReached) return res.json({ limitReached: true, premiumLimit: limitState.premiumLimit || false, nextResetDate: limitState.nextResetDate || '', redirectUrl: limitState.stripeUrl || '' });

  try {
    const { buffer, mimeType, fields, truncated } = await collectGridUpload(req);
    if (truncated) return res.json({ success: false, error: gridMsg(lang, 'tooLarge') });
    if (!buffer || buffer.length === 0 || !(mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
      return res.json({ success: false, error: gridMsg(lang, 'badInput') });
    }

    let docTypes = [];
    try { docTypes = JSON.parse(fields.docTypes || '[]'); } catch (_) { /* fallthrough */ }
    docTypes = (Array.isArray(docTypes) ? docTypes : []).filter(d => BULK_DOC_TYPES.includes(d)).slice(0, 3);

    let answers = [];
    try { answers = JSON.parse(fields.answers || '[]'); } catch (_) { /* fallthrough */ }
    answers = (Array.isArray(answers) ? answers : [])
      .filter(a => a && BULK_QUESTION_TYPES.includes(a.type))
      .map(a => ({
        type: a.type,
        prompt: typeof a.prompt === 'string' ? a.prompt.trim().slice(0, 200) : '',
        values: (Array.isArray(a.values) ? a.values : [])
          .filter(v => typeof v === 'string' && v.trim())
          .map(v => v.trim().slice(0, 80))
          .slice(0, 20)
      }))
      .slice(0, 5);

    const selectedClasses = (answers.find(a => a.type === 'column_select') || { values: [] }).values.slice(0, 20);
    const userTimeZone = fields.timeZone || 'Asia/Tokyo';
    const targetLang = fields.targetLang || 'auto';
    const filePart = await prepareGridPart(buffer, mimeType);

    // グリッド抽出には対象列の選択が必須。gridが上位でも列回答がない場合
    // （列見出しを検出できなかった書類など）は最初から汎用ハンドラーに回す。
    // weekly_schedule は「列回答あり」がそのまま日付×クラス列構造の証左になる。
    let mode = (bulkIsGridRoute(docTypes, selectedClasses.length > 0) && selectedClasses.length > 0) ? 'grid' : 'generic';
    let result;

    if (mode === 'grid') {
      // 次回以降の自動適用のため選択結果を保存（旧 /grid/extract と同じ）
      await dbGrid.saveGridClassPrefs(subId, selectedClasses);

      const gridLines = bulkAnswerLines(answers, { excludeColumns: true });
      const extraPrompt = gridLines.length
        ? `\n【ユーザーの回答（厳守）】\n${gridLines.join('\n')}\n特に対象の年月に関する回答がある場合、year・month・各dateは必ずその回答に従うこと。`
        : '';
      result = await runGridExtraction(filePart, { selectedClasses, userTimeZone, targetLang, extraPrompt });

      if (!result.isGrid) {
        // 非対称ルーティングの内部フォールバック: グリッドとして解析できなければ
        // 汎用ハンドラーへ（画像は手元にあるので再アップロード不要）
        console.log('BULK EXTRACT: grid route returned isGrid:false, falling back to generic');
        mode = 'generic';
        result = await runGenericExtraction(filePart, { userTimeZone, targetLang, docTypes, answerLines: bulkAnswerLines(answers) });
      }
    } else {
      result = await runGenericExtraction(filePart, { userTimeZone, targetLang, docTypes, answerLines: bulkAnswerLines(answers) });
    }

    if (result.events.length === 0 && (result.notices || []).length === 0) {
      await db.incrementErrorCount(subId, 10);
      return res.json({ success: false, error: gridMsg(lang, mode === 'grid' ? 'empty' : 'genericEmpty') });
    }

    // デバッグ用に件数のみログ（予定内容はプライバシーポリシー整合のため記録しない）
    console.log(`BULK EXTRACT: mode=${mode} docTypes=${docTypes.join(',')} events=${result.events.length} low=${result.events.filter(ev => ev.confidence !== 'high').length} notices=${(result.notices || []).length}`);

    res.json({
      success: true,
      mode: mode,
      year: result.year,
      month: result.month,
      selectedClasses: mode === 'grid' ? selectedClasses : [],
      events: result.events,
      notices: result.notices || []
    });
  } catch (e) {
    console.error('BULK EXTRACT ERROR:', e);
    const isSystemError = e.status === 429 || e.message?.includes('quota') || e.message?.includes('limit');
    if (!isSystemError) {
      await db.incrementErrorCount(subId, 10);
    }
    res.status(500).json({ error: gridMsg(lang, 'parseError') });
  }
});

app.get('/api/status', async (req, res) => {
  const subId = req.session?.subId;
  if (!subId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const userStatus = await db.getUserStatus(subId);
    res.json({ isPremium: userStatus.isPremium || false });
  } catch (e) {
    console.error('Status API error:', e.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/success', (req, res) => {
  // セッション書き換えなし・DB操作なし・クエリパラメータ無視
  // プレミアム昇格は Stripe Webhook のみが行う
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Complete - OneShotCal</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
           align-items: center; height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
    .container { text-align: center; padding: 20px; }
    h1 { font-size: 22px; margin-bottom: 12px; }
    p  { font-size: 15px; color: #64748b; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0;
               border-top-color: #6366f1; border-radius: 50%;
               animation: spin 0.8s linear infinite; margin: 16px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ Payment Complete</h1>
    <p>Thank you! Activating your Premium plan…</p>
    <div class="spinner"></div>
    <p id="msg" style="font-size:13px;">Checking activation status…</p>
  </div>
  <script>
    let attempts = 0;
    const MAX = 20; // 最大20回 × 3秒 = 60秒でタイムアウト
    async function poll() {
      attempts++;
      try {
        const r = await fetch('/api/status', { credentials: 'include' });
        if (r.status === 401) {
          // 未ログイン（Stripeから直リンクで来た等）→ そのままアプリへ
          window.location.href = '/app';
          return;
        }
        const d = await r.json();
        if (d.isPremium) {
          document.getElementById('msg').textContent = 'Premium activated! Redirecting…';
          window.location.href = '/app';
          return;
        }
      } catch(_) {}
      if (attempts >= MAX) {
        // タイムアウト：Webhookが遅延している可能性。アプリへ送り出す
        document.getElementById('msg').textContent = 'Taking a bit longer than usual. Redirecting…';
        window.location.href = '/app';
        return;
      }
      setTimeout(poll, 3000);
    }
    setTimeout(poll, 2000); // 最初の確認は2秒後（Webhook処理待ち）
  </script>
</body>
</html>`);
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port} - Build Refresh: 20260416_v5`))