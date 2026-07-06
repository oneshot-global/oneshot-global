(function() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // subIdがURLにある場合、URLクリーンアップ前に確実に取得・保存する
    const subIdFromUrl = urlParams.get('subId');
    if (subIdFromUrl) {
        localStorage.setItem('oneshot_subId', subIdFromUrl);
    }

    if (urlParams.get('premium') === 'true') {
        localStorage.setItem('oneshot_premium', 'true');
        const cleanUrl = window.location.origin + window.location.pathname + (subIdFromUrl ? `?subId=${subIdFromUrl}` : '');
        window.history.replaceState({}, document.title, cleanUrl);
    }

    const cameraInput = document.getElementById('cameraInput'),
          libraryInput = document.getElementById('libraryInput'),
          cameraBtn = document.getElementById('cameraBtn'),
          libraryBtn = document.getElementById('libraryBtn'),
          gateArea = document.getElementById('gateArea'),
          uploadBtn = document.getElementById('uploadBtn'),
          checkBtn = document.getElementById('checkBtn'),
          loginBtn = document.getElementById('loginBtn'),
          loginArea = document.getElementById('loginArea'),
          status = document.getElementById('status'),
          preview = document.getElementById('preview'),
          loader = document.getElementById('loader'),
          subTitle = document.getElementById('t-subTitle'),
          mainCard = document.getElementById('mainCard'),
          dropZone = document.getElementById('dropZone'),
          pcGuide = document.getElementById('pcGuide'),
          subModal = document.getElementById('subModal'),
          modalCloseBtn = document.getElementById('modalCloseBtn'),
          modalSubBtn = document.getElementById('modalSubBtn'),
          planLink = document.getElementById('t-planLink'),
          guideLink = document.getElementById('guideLink'),
          guideModal = document.getElementById('guideModal'),
          guideCloseBtn = document.getElementById('guideCloseBtn'),
          guideContent = document.getElementById('guideContent'),
          guideTitle = document.getElementById('t-guideTitle'),
          privacyLink = document.getElementById('privacyLink'),
          termsLink = document.getElementById('termsLink'),
          modalTermsLink = document.getElementById('modalTermsLink'),
          modalSubTitle = document.getElementById('t-modalSubTitle'),
          modalBody = document.getElementById('t-modalBody'),
          modalCancelBtn = document.getElementById('modalCloseBtn'),
          modalOkBtn = document.getElementById('modalSubBtn'),
          modalAgreement = document.getElementById('t-modalAgreement'),
          registrationResult = document.getElementById('registrationResult'),
          resTitle = document.getElementById('res-title'),
          resDateTime = document.getElementById('res-datetime'),
          resLocation = document.getElementById('res-location'),
          resLocationBox = document.getElementById('res-location-box');

    const i18n = {
        ja: {
            subTitle: "画像をスキャンして、即カレンダー登録",
            login: "1. Googleでログイン",
            camera: "📷 撮影スキャン",
            library: "🖼️ 写真選択",
            upload: "解析スタート",
            check: "📅 カレンダーで確認", 
            processing: "最適化中...",
            analyzing: "解析中...",
            allSuccess: "登録完了 🚀", 
            remaining: "残り",
            times: "回", 
            nextReset: "次回更新",
            portal: "管理・解約",
            anotherCamera: "📷 再スキャン",
            anotherLibrary: "🖼️ フォルダ選択",
            anotherSync: "同期中...",
            syncing: "同期中...",
            error_generic: "解析エラー: 詳細はGuideを確認してください。",
            guide_title: "OneShotCal ユーザーガイド",
            tokusho_link: '特定商取引法に基づく表記',
            labelTitle: "予定名",
            labelDate: "日時",
            labelLocation: "場所",
            guide_html: `
                <p style="margin-bottom: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px;">📋 ある程度の予定表フォーマットに対応していますが、レイアウトによっては正しく読み取れない場合があります。うまくいかない表があれば、<a href="mailto:a463311a@gmail.com?subject=${encodeURIComponent('読み取れない予定表の報告')}" style="color:#2563eb; text-decoration:underline;">サポート窓口（メール）</a>から画像をお送りください。対応を検討いたします。</p>
                <p style="font-weight: bold; border-left: 4px solid #007aff; padding-left: 10px; margin: 15px 0 10px;">■ 使い方</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>1枚につき1予定:</strong> 画像から1つの予定を抽出しカレンダーへ登録します。</li>
                    <li><strong>操作:</strong> 色を選んで実行。PCはドラッグ＆ドロップやCtrl+V（画像・テキスト両方）にも対応。</li>
                    <li><strong>クイック登録:</strong> テキストコピー済みの状態で色ボタンを<strong>「ダブルタップ」</strong>すると、色選択と解析を同時に実行できます。</li>
                </ul>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ 出力言語設定 (New!)</p>
                <div class="lang-selector-container" style="display:flex; flex-wrap:wrap; gap:8px; padding-left:10px; margin-bottom:15px;">
                    <button class="lang-set-btn" data-lang="auto" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">自動 (写真の言語)</button>
                    <button class="lang-set-btn" data-lang="ja" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">日本語</button>
                    <button class="lang-set-btn" data-lang="en" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">English</button>
                    <button class="lang-set-btn" data-lang="de" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Deutsch</button>
                    <button class="lang-set-btn" data-lang="fr" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Français</button>
                    <button class="lang-set-btn" data-lang="es" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Español</button>
                </div>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ さらに便利に使う</p>
                <p style="margin-bottom: 15px; padding-left: 10px;">iPhoneはSafariの「共有」から、AndroidはChromeのメニューから「ホーム画面に追加」をすると、通常のアプリと同じように1タップで起動できるようになります。</p>
                <p style="font-weight: bold; border-left: 4px solid #f6bf26; padding-left: 10px; margin: 15px 0 10px;">■ 注意事項</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>内容確認:</strong> AIの誤解析によるミスは責任を負いかねます。必ず内容をご確認してください。</li>
                    <li><strong>広域画像不可:</strong> 月間・週間予定表など、予定が密集した画像は正しく解析できません。</li>
                    <li><strong>エラー対応:</strong> 解析失敗時は利用回数は消費されませんが、連続エラーが多い場合はアカウントを停止（BAN）することがあります。</li>
                </ul>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ プライバシー・安全管理</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>データの不利用:</strong> 取得したGoogleユーザーデータをAI/MLモデルのトレーニングや改善のために利用することはありません。</li>
                    <li><strong>安全な通信:</strong> 業界標準の暗号化技術（SSL/TLS）を用い、厳格なアクセス制御を維持しています。</li>
                    <li><strong>第三者提供の禁止:</strong> ユーザーの明示的な同意なく、Googleユーザーデータを第三者に販売・提供することはありません。</li>
                </ul>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ 未来への成長</p>
                <p style="margin-bottom: 15px; padding-left: 10px;">手書き文字の解析は現在学習中です。Gemini AIの進化とともに、より正確に読み取れるよう成長していきます。現時点では活字（プリントや画面）を推奨します。</p>
                <p style="font-weight: bold; border-left: 4px solid #ef4444; padding-left: 10px; margin: 15px 0 10px;">■ 禁止事項</p>
                <p style="margin-bottom: 15px; padding-left: 10px;">悪用や不正な連続スキャンが検知された場合、アカウントを停止（BAN）することがあります。</p>
            `,
            privacy_title: "プライバシーポリシー",
            privacy_html: `
                <p><strong>1. 取得する情報および利用目的</strong><br>Googleアカウントの基本情報（ID、メールアドレス）およびカレンダー登録のためにアップロードされた画像を取得します。これらは認証、サブスクリプション管理、および予定追加のためにのみ利用されます。画像データは解析後、直ちにサーバーから削除されます。また、取得したGoogleユーザーデータをAI/MLモデルのトレーニングや改善のために利用することはありません。</p>
                <p><strong>2. AI解析に関する免責事項</strong><br>本サービスはGoogle Gemini APIを使用して画像解析を行います。解析精度は画像の状態に依存し、情報の正確性を保証するものではありません。解析結果の誤りに起因する損害（予定の誤登録等）について、運営者は一切の責任を負いません。登録内容は必ずユーザー自身で確認してください。</p>
                <p><strong>3. Google APIデータの限定的利用</strong><br>Google APIから受信した情報の使用および他アプリへの転送は、Google APIサービスユーザーデータポリシー（限定的利用要件を含む）を遵守します。取得したデータを広告配信に利用したり、ユーザーの明示的な同意なく第三者に販売、共有、または提供することはありません。</p>
                <p><strong>4. データの保持と安全管理</strong><br>ユーザーの個人データは、Google Cloud上のセキュアなデータベース（Firestore）で厳重に管理されます。データ保護のため、業界標準の暗号化技術（SSL/TLS）を用い、厳格なアクセス制御を維持しています。ユーザーはGoogleアカウントの設定からいつでも本サービスへのアクセス権を取り消すことができます。データの削除を希望される場合は、下記お問い合わせ先（a463311a@gmail.com）までご連絡ください。</p>
                <p><strong>5. ポリシーの変更</strong><br>運営者は本ポリシーを予告なく変更できるものとし、変更後の効力は本サイトに掲載した時点で発生するものとします。</p>
            `,
            terms_title: "利用規約",
            terms_html: `
                <p><strong>1. サービスの利用</strong><br>本サービスは画像を解析してカレンダーに登録するツールです。解析精度は画像の状態に依存し、情報の正確性を保証するものではありません。Gemini AIの解析結果を必ずユーザー自身で確認した上で登録を確定してください。</p>
                <p><strong>2. 決済およびサブスクリプション</strong><br>プレミアムプランは月額制の自動更新サービスです。有効期間が終了する前に解約手続きを行わない限り、翌月分が自動的に決済されます。月の途中で解約した場合でも、有効期間内はサービスを利用可能ですが、日割りによる返金は一切行いません。</p>
                <p><strong>3. 禁止事項</strong><br>意図的な大量のエラー発生、サーバーへの負荷をかける行為、および運営を妨害する行為を禁止します。違反が検知された場合、事前の通知なくアカウントを停止（BAN）することがあります。</p>
                <p><strong>4. 免責・返金</strong><br>本サービスによる登録ミス、データの不整合、またはサービスの一時的な中断について運営者は一切の責任を負いません。デジタルコンテンツおよびサブスクリプションの性質上、決済完了後の返金は理由を問わず受け付けておりません。</p>
            `,
            modal_subTitle: "プレミアムプランへのアップグレード",
            modal_body: `
                <div id="termsScrollArea" style="height:150px; overflow-y:auto; background:#f8fafc; border:1px solid #e2e8f0; padding:10px; border-radius:6px; font-size:12px; margin-bottom:10px;">
                    <p><strong>【プレミアムプラン内容】</strong><br>
                    ・月間30回までのスキャン登録<br>
                    ・月額 $1.00 USD (自動更新)<br>
                    ・解析失敗時は回数を消費しません</p>
                    <p><strong>【利用規約全文】</strong><br>
                    1. サービスの利用: 本サービスは画像を解析してカレンダーに登録するツールです。解析精度は画像の状態に依存し、情報の正確性を保証するものではありません。Gemini AIの解析結果を必ずユーザー自身で確認した上で登録を確定してください。<br>
                    2. 決済およびサブスクリプション: プレミアムプランは月額制の自動更新サービスです。有効期間が終了する前に解約手続きを行わない限り、翌月分が自動的に決済されます。月の途中で解約した場合でも、有効期間内はサービスを利用可能ですが、日割りによる返金は一切行いません。<br>
                    3. 禁止事項: 意図的な大量のエラー発生、サーバーへの負荷をかける行為、および運営を妨害する行為を禁止します。違反が検知された場合、事前の通知なくアカウントを停止（BAN）することがあります。<br>
                    4. 免責・返金: 本サービスによる登録ミス、データの不整合、またはサービスの一時的な中断について運営者は一切の責任を負いません。デジタルコンテンツおよびサブスクリプションの性質上、決済完了後の返金は理由を問わず受け付けておりません。</p>
                </div>
            `,
            modal_agreement: "スクロールして内容を確認してください。",
            modal_agreement_ready: "規約に同意して次へ進むことができます。",
            modal_cancel: "",
            modal_ok: "規約に同意して次へ",
            premium_limit_msg: function(d) { return `今月の利用上限（30回）に達しました。${d ? '次回リセット: ' + d : '翌月に自動で回復します'}`; },
            grid: {
                modeLink: "📥 一括登録モード（β）",
                backLink: "← 通常モード（1画像1予定）に戻る",
                fileBtn: "🗓️ 予定表・チラシを選択（画像・PDF）",
                hint: "月間予定表・献立表・行事チラシなどの画像/PDFから予定を一括登録できます",
                classTitle: "登録するクラスを選んでください（複数選択可）",
                savedApplied: "前回選択したクラスを自動適用しました",
                changeClass: "クラス選択を変更する",
                readyTitle: "内容を確認しました。そのまま抽出できます",
                consensusNote: "複数回照合して精度を高めています",
                extractBtn: "予定を抽出する",
                reviewTitle: "抽出結果を確認してください",
                itemCount: "件",
                unverifiedBadge: "未検証",
                unverifiedHint: "⚠️ 黄色の「未検証」項目は読み取りに自信がありません。元の予定表と見比べて、正しい場合のみチェックを入れてください。",
                registerBtn: "チェックした予定をカレンダーに登録",
                registering: "カレンダーに登録中...",
                registeredMsg: "件の予定を登録しました 🚀",
                noneSelected: "登録する予定にチェックを入れてください",
                selectClassFirst: "クラスを1つ以上選択してください",
                tooLarge: "ファイルサイズが大きすぎます（上限10MB）",
                undoBtn: "🗑️ この登録を取り消す",
                undoConfirm: "直前に一括登録した予定をすべてカレンダーから削除します。よろしいですか？（消費した利用回数は戻りません）",
                undoing: "登録を取り消し中...",
                undoneMsg: "件の予定を取り消しました",
                leaveNote: "このまま画面を離れても大丈夫です",
                noticeFmt: function(s, e) { const f = (d) => `${parseInt(d.slice(5,7),10)}月${parseInt(d.slice(8,10),10)}日`; return (s === e ? `${f(s)}ごろ` : `${f(s)}〜${f(e)}ごろ`) + '、内容をご確認ください'; },
                dateFmt: function(d) { return `${parseInt(d.slice(5,7),10)}/${parseInt(d.slice(8,10),10)}`; }
            },
            reauth_btn: "再ログイン",
            reauth_msg: "カレンダーへのアクセスが許可されていません。再連携してください。"
        },
        en: {
            subTitle: "Scan image, sync to calendar",
            login: "1. Login with Google",
            camera: "📷 Camera Scan",
            library: "🖼️ Select Photo",
            upload: "Run Analysis",
            check: "📅 Open Calendar",
            processing: "Optimizing...",
            analyzing: "Analyzing...",
            allSuccess: "Sync Completed 🚀",
            remaining: "",
            times: " left",
            nextReset: "Next reset",
            portal: "Manage Subscription",
            anotherCamera: "📷 Rescan",
            anotherLibrary: "🖼️ Select Photo",
            syncing: "Syncing...",
            error_generic: "Analysis Error: Please refer to the Guide for details.",
            guide_title: "OneShotCal User Guide",
            tokusho_link: "Legal Notice (SCTA)",
            labelTitle: "EVENT",
            labelDate: "DATE & TIME",
            labelLocation: "LOCATION",
            guide_html: `
                <p style="margin-bottom: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px;">📋 A wide range of schedule formats are supported, but some layouts may not be read correctly. If a schedule doesn't work, please send the image to our <a href="mailto:a463311a@gmail.com?subject=${encodeURIComponent('Report: schedule image that could not be read')}" style="color:#2563eb; text-decoration:underline;">support desk (email)</a>. We'll consider adding support for it.</p>
                <p><strong>■ How to use</strong><br>・Scan one event per image. It will be automatically added to your Google Calendar.<br>・PC supports Drag & Drop and Ctrl+V (Both Image and Text).<br>・<strong>Quick Sync:</strong> Double-tap a color dot when text is copied to start analysis immediately with that color.</p>
                <p><strong>■ Output Language (New!)</strong></p>
                <div class="lang-selector-container" style="display:flex; flex-wrap:wrap; gap:8px; padding-left:10px; margin-bottom:15px;">
                    <button class="lang-set-btn" data-lang="auto" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Auto (Original)</button>
                    <button class="lang-set-btn" data-lang="ja" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Japanese</button>
                    <button class="lang-set-btn" data-lang="en" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">English</button>
                    <button class="lang-set-btn" data-lang="de" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">German</button>
                    <button class="lang-set-btn" data-lang="fr" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">French</button>
                    <button class="lang-set-btn" data-lang="es" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Spanish</button>
                </div>
                <p><strong>■ Pro Tip</strong><br>Add to Home Screen: You can use this like a native app by selecting "Add to Home Screen" from Safari (iOS) or Chrome (Android) menu.</p>
                <p><strong>■ Note</strong><br>・Verify content: The operator is not liable for registration errors. Please always verify the content.<br>・Please avoid broad images like monthly/weekly calendars as they cause errors.<br>・Failed analysis does not count towards usage but accounts may be suspended (BAN) if excessive errors are detected.</p>
                <p><strong>■ Privacy & Security</strong><br>・Data Usage: Google user data is not used for training or improving AI/ML models.<br>・Secure Connection: We implement industry-standard encryption (SSL/TLS) and maintain strict access controls.<br>・No Third-party Sharing: We do not sell, share, or transfer Google user data to third parties without explicit user consent.</p>
                <p><strong>■ Future Growth</strong><br>Handwriting analysis is currently in learning. We will evolve with Gemini AI to read more accurately. Currently, printed text or digital screens are recommended.</p>
                <p><strong>■ Prohibitions</strong><br>・Accounts may be suspended (BAN) if excessive errors or malicious scanning are detected to prevent abuse.</p>
            `,
            privacy_title: "Privacy Policy",
            privacy_html: `
                <p><strong>1. Collection and Usage</strong><br>We collect basic Google account info (ID, email) and images uploaded for calendar registration. These are used solely for authentication, subscription management, and adding events. Images are deleted immediately after analysis. Google user data is not used for training or improving AI/ML models.</p>
                <p><strong>2. Disclaimer on AI Analysis</strong><br>This service performs analysis using Google Gemini API. Accuracy depends on image quality and is not guaranteed. The operator is not liable for damages arising from analysis errors (e.g., misregistration). Users must always verify the results.</p>
                <p><strong>3. Limited Use of Google API Data</strong><br>Use and transfer to any other app of information received from Google APIs will adhere to Google API Service User Data Policy, including the Limited Use requirements. We do not sell, share, or transfer Google user data to third parties without explicit user consent.</p>
                <p><strong>4. Data Security</strong><br>Personal data is securely managed via Firestore on Google Cloud. We implement industry-standard encryption (SSL/TLS) and maintain strict access controls to protect your data. Users may revoke access via Google account settings at any time. For deletion requests, contact a463311a@gmail.com.</p>
                <p><strong>5. Policy Changes</strong><br>We reserve the right to modify this policy at any time. Changes take effect upon posting on this site.</p>
            `,
            terms_title: "Terms of Service",
            terms_html: `
                <p><strong>1. Service</strong><br>This tool adds events to your calendar via image analysis. Accuracy is not guaranteed and depends on image quality. Always verify Gemini AI analysis before confirming registration.</p>
                <p><strong>2. Payment and Subscription</strong><br>The Premium Plan is a monthly auto-renewing service. You will be billed automatically unless you cancel before the period ends. No pro-rated refunds are provided for mid-month cancellations.</p>
                <p><strong>3. Restrictions</strong><br>Intentional error generation or overloading the server is prohibited. Violations may result in an immediate account ban without notice.</p>
                <p><strong>4. Liability and Refunds</strong><br>The operator is not liable for registration errors, data mismatch, or service interruptions. Refunds are not accepted for digital content or subscriptions for any reason.</p>
            `,
            modal_subTitle: "Upgrade to Premium Plan",
            modal_body: `
                <div id="termsScrollArea" style="height:150px; overflow-y:auto; background:#f8fafc; border:1px solid #e2e8f0; padding:10px; border-radius:6px; font-size:12px; margin-bottom:10px;">
                    <p><strong>[Premium Plan Details]</strong><br>
                    ・Up to 30 scans per month<br>
                    ・$1.00 USD / month (Auto-renewal)<br>
                    ・Failed analysis does not count</p>
                    <p><strong>[Full Terms of Service]</strong><br>
                    1. Service: This tool adds events to your calendar via image analysis. Accuracy is not guaranteed and depends on image quality. Always verify Gemini AI analysis before confirming registration.<br>
                    2. Payment and Subscription: The Premium Plan is a monthly auto-renewing service. You will be billed automatically unless you cancel before the period ends. No pro-rated refunds are provided for mid-month cancellations.<br>
                    3. Restrictions: Intentional error generation or overloading the server is prohibited. Violations may result in an immediate account ban without notice.<br>
                    4. Liability and Refunds: The operator is not liable for registration errors, data mismatch, or service interruptions. Refunds are not accepted for digital content or subscriptions for any reason.</p>
                </div>
            `,
            modal_agreement: "Please scroll to review the terms.",
            modal_agreement_ready: "You can now agree and proceed.",
            modal_cancel: "",
            modal_ok: "Agree and Proceed",
            premium_limit_msg: function(d) { return `You've reached this month's limit (30 scans).${d ? ' Next reset: ' + d : ''}`; },
            grid: {
                modeLink: "📥 Bulk Import Mode (β)",
                backLink: "← Back to standard mode (one event per image)",
                fileBtn: "🗓️ Select a schedule or flyer (image / PDF)",
                hint: "Bulk-register events from monthly schedules, menu plans, event flyers and more (image / PDF)",
                classTitle: "Select the class column(s) to register (multiple allowed)",
                savedApplied: "Your previous class selection was applied automatically",
                changeClass: "Change class selection",
                readyTitle: "Looks good — you can start extracting",
                consensusNote: "Cross-checking multiple passes for accuracy",
                extractBtn: "Extract events",
                reviewTitle: "Review the extracted events",
                itemCount: " items",
                unverifiedBadge: "UNVERIFIED",
                unverifiedHint: "⚠️ Yellow 'unverified' items could not be read with confidence. Compare with the original schedule and tick them only if correct.",
                registerBtn: "Add checked events to Calendar",
                registering: "Adding to Calendar...",
                registeredMsg: " events added 🚀",
                noneSelected: "Please tick at least one event to register",
                selectClassFirst: "Please select at least one class",
                tooLarge: "File is too large (max 10MB)",
                undoBtn: "🗑️ Undo this registration",
                undoConfirm: "Delete all events you just registered from your calendar? (Used scans will not be refunded)",
                undoing: "Undoing registration...",
                undoneMsg: " events removed from calendar",
                leaveNote: "You can step away from this screen",
                noticeFmt: function(s, e) { const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'}); return 'Around ' + (s === e ? f(s) : `${f(s)} – ${f(e)}`) + ': an ambiguous arrow was found — please check the original schedule.'; },
                dateFmt: function(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'}); }
            },
            reauth_btn: "Re-login",
            reauth_msg: "Calendar access not granted. Please reconnect."
        },
        de: {
            subTitle: "Bild scannen, im Kalender speichern",
            login: "1. Mit Google anmelden",
            camera: "📷 Kamera-Scan",
            library: "🖼️ Foto auswählen",
            upload: "Analyse starten",
            check: "📅 Kalender öffnen",
            processing: "Optimierung...",
            analyzing: "Analyse läuft...",
            allSuccess: "Synchronisiert 🚀",
            remaining: "Noch",
            times: "mal",
            nextReset: "Nächster Reset",
            portal: "Abo verwalten",
            anotherCamera: "📷 Erneut scannen",
            anotherLibrary: "🖼️ Foto wählen",
            syncing: "Synchronisierung...",
            error_generic: "Analysefehler: Details finden Sie im Guide.",
            guide_title: "OneShotCal Benutzerhandbuch",
            tokusho_link: "Impressum (SCTA)",
            labelTitle: "EREIGNIS",
            labelDate: "DATUM & ZEIT",
            labelLocation: "ORT",
            guide_html: `
                <p style="margin-bottom: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px;">📋 Viele Planformate werden unterstützt, aber je nach Layout kann das Lesen fehlschlagen. Wenn ein Plan nicht richtig gelesen wird, senden Sie uns das Bild bitte über den <a href="mailto:a463311a@gmail.com?subject=${encodeURIComponent('Meldung: nicht lesbarer Terminplan')}" style="color:#2563eb; text-decoration:underline;">Support (E-Mail)</a> – wir prüfen eine Unterstützung.</p>
                <p style="font-weight: bold; border-left: 4px solid #007aff; padding-left: 10px; margin: 15px 0 10px;">■ Nutzung</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>Ein Ereignis pro Bild:</strong> Extrahiert ein einzelnes Ereignis aus einem Bild und registriert es im Kalender.</li>
                    <li><strong>Bedienung:</strong> Farbe wählen und ausführen. PC unterstützt Drag & Drop und Strg+V (Bild und Text).</li>
                    <li><strong>Quick Sync:</strong> Doppeltippen Sie auf einen Farbpunk, wenn Text kopiert wurde, um die Analyse sofort mit dieser Farbe zu starten.</li>
                </ul>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ Ausgabesprache (Neu!)</p>
                <div class="lang-selector-container" style="display:flex; flex-wrap:wrap; gap:8px; padding-left:10px; margin-bottom:15px;">
                    <button class="lang-set-btn" data-lang="auto" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Auto (Original)</button>
                    <button class="lang-set-btn" data-lang="ja" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Japanisch</button>
                    <button class="lang-set-btn" data-lang="en" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Englisch</button>
                    <button class="lang-set-btn" data-lang="de" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Deutsch</button>
                    <button class="lang-set-btn" data-lang="fr" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Französisch</button>
                    <button class="lang-set-btn" data-lang="es" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Spanisch</button>
                </div>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ Tipp</p>
                <p style="margin-bottom: 15px; padding-left: 10px;">Zum Home-Bildschirm hinzufügen: Sie können dies wie eine App nutzen, indem Sie im Safari- oder Chrome-Menü „Zum Home-Bildschirm hinzufügen“ wählen.</p>
                <p style="font-weight: bold; border-left: 4px solid #f6bf26; padding-left: 10px; margin: 15px 0 10px;">■ Hinweis</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>Inhalt prüfen:</strong> Der Betreiber haftet nicht für Registrierungsfehler durch die KI. Bitte prüfen Sie immer den Inhalt.</li>
                    <li><strong>Keine Breitbildkalender:</strong> Monats- oder Wochenkalender können nicht korrekt analysiert werden.</li>
                    <li><strong>Fehlerlimit:</strong> Fehlgeschlagene Analysen zählen nicht zum Limit, aber bei übermäßigen Fehlern kann das Konto gesperrt (BAN) werden.</li>
                </ul>
            `,
            privacy_title: "Privacy Policy",
            privacy_html: `
                <p><strong>1. Collection and Usage</strong><br>We collect basic Google account info (ID, email) and images uploaded for calendar registration. These are used solely for authentication, subscription management, and adding events. Images are deleted immediately after analysis. Google user data is not used for training or improving AI/ML models.</p>
                <p><strong>2. Disclaimer on AI Analysis</strong><br>This service performs analysis using Google Gemini API. Accuracy depends on image quality and is not guaranteed. The operator is not liable for damages arising from analysis errors (e.g., misregistration). Users must always verify the results.</p>
                <p><strong>3. Limited Use of Google API Data</strong><br>Use and transfer to any other app of information received from Google APIs will adhere to Google API Service User Data Policy, including the Limited Use requirements. We do not sell, share, or transfer Google user data to third parties without explicit user consent.</p>
                <p><strong>4. Data Security</strong><br>Personal data is securely managed via Firestore on Google Cloud. We implement industry-standard encryption (SSL/TLS) and maintain strict access controls to protect your data. Users may revoke access via Google account settings at any time. For deletion requests, contact a463311a@gmail.com.</p>
                <p><strong>5. Policy Changes</strong><br>We reserve the right to modify this policy at any time. Changes take effect upon posting on this site.</p>
            `,
            terms_title: "Terms of Service",
            terms_html: `
                <p><strong>1. Service</strong><br>This tool adds events to your calendar via image analysis. Accuracy is not guaranteed and depends on image quality. Always verify Gemini AI analysis before confirming registration.</p>
                <p><strong>2. Payment and Subscription</strong><br>The Premium Plan is a monthly auto-renewing service. You will be billed automatically unless you cancel before the period ends. No pro-rated refunds are provided for mid-month cancellations.</p>
                <p><strong>3. Restrictions</strong><br>Intentional error generation or overloading the server is prohibited. Violations may result in an immediate account ban without notice.</p>
                <p><strong>4. Liability and Refunds</strong><br>The operator is not liable for registration errors, data mismatch, or service interruptions. Refunds are not accepted for digital content or subscriptions for any reason.</p>
            `,
            modal_subTitle: "Upgrade auf Premium",
            modal_body: `<div>$1.00 USD / Monat. Bis zu 30 Scans pro Monat. Automatische Verlängerung.</div>`,
            modal_agreement: "Bitte scrollen Sie, um die Bedingungen zu lesen.",
            modal_agreement_ready: "Sie können nun zustimmen.",
            modal_cancel: "",
            modal_ok: "Zustimmen und weiter",
            premium_limit_msg: function(d) { return `Monatslimit (30 Scans) erreicht.${d ? ' Nächster Reset: ' + d : ''}`; },
            grid: {
                modeLink: "📥 Sammelimport-Modus (β)",
                backLink: "← Zurück zum Standardmodus (ein Termin pro Bild)",
                fileBtn: "🗓️ Plan oder Flyer auswählen (Bild / PDF)",
                hint: "Termine aus Monatsplänen, Speiseplänen, Flyern u. a. gesammelt registrieren (Bild / PDF)",
                classTitle: "Klassenspalte(n) auswählen (Mehrfachauswahl möglich)",
                savedApplied: "Ihre letzte Klassenauswahl wurde automatisch übernommen",
                changeClass: "Klassenauswahl ändern",
                readyTitle: "Alles klar – Sie können die Extraktion starten",
                consensusNote: "Mehrfacher Abgleich für höhere Genauigkeit",
                extractBtn: "Termine extrahieren",
                reviewTitle: "Extrahierte Termine prüfen",
                itemCount: " Einträge",
                unverifiedBadge: "UNGEPRÜFT",
                unverifiedHint: "⚠️ Gelbe 'ungeprüfte' Einträge konnten nicht sicher gelesen werden. Bitte mit dem Original vergleichen und nur ankreuzen, wenn korrekt.",
                registerBtn: "Angekreuzte Termine in den Kalender eintragen",
                registering: "Wird in den Kalender eingetragen...",
                registeredMsg: " Termine eingetragen 🚀",
                noneSelected: "Bitte mindestens einen Termin ankreuzen",
                selectClassFirst: "Bitte mindestens eine Klasse auswählen",
                tooLarge: "Datei ist zu groß (max. 10MB)",
                undoBtn: "🗑️ Diese Registrierung rückgängig machen",
                undoConfirm: "Alle soeben eingetragenen Termine aus dem Kalender löschen? (Verbrauchte Scans werden nicht erstattet)",
                undoing: "Wird rückgängig gemacht...",
                undoneMsg: " Termine aus dem Kalender entfernt",
                leaveNote: "Sie können diese Ansicht währenddessen verlassen",
                noticeFmt: function(s, e) { const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString('de-DE', {month:'short', day:'numeric'}); return 'Um ' + (s === e ? f(s) : `${f(s)} – ${f(e)}`) + ': ein mehrdeutiger Pfeil wurde gefunden — bitte prüfen Sie den Originalplan.'; },
                dateFmt: function(d) { return new Date(d + 'T00:00:00').toLocaleDateString('de-DE', {month:'numeric', day:'numeric'}); }
            },
            reauth_btn: "Erneut anmelden",
            reauth_msg: "Kalenderzugriff nicht erteilt. Bitte erneut verbinden."
        },
        fr: {
            subTitle: "Scanner l'image, synchroniser avec l'agenda",
            login: "1. Connexion avec Google",
            camera: "📷 Scanner Photo",
            library: "🖼️ Choisir Photo",
            upload: "Lancer l'analyse",
            check: "📅 Ouvrir l'agenda",
            processing: "Optimisation...",
            analyzing: "Analyse en cours...",
            allSuccess: "Synchronisé 🚀",
            remaining: "Reste",
            times: "fois",
            nextReset: "Prochain reset",
            portal: "Gérer l'abonnement",
            anotherCamera: "📷 Rescanner",
            anotherLibrary: "🖼️ Choisir Photo",
            syncing: "Synchronisation...",
            error_generic: "Erreur d'analyse : consultez le Guide.",
            guide_title: "Guide Utilisateur OneShotCal",
            tokusho_link: "Mentions Légales (SCTA)",
            labelTitle: "ÉVÉNEMENT",
            labelDate: "DATE & HEURE",
            labelLocation: "LIEU",
            guide_html: `
                <p style="margin-bottom: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px;">📋 De nombreux formats de planning sont pris en charge, mais certaines mises en page peuvent être mal lues. Si un planning ne fonctionne pas, envoyez-nous l'image via le <a href="mailto:a463311a@gmail.com?subject=${encodeURIComponent('Signalement : planning illisible')}" style="color:#2563eb; text-decoration:underline;">support (e-mail)</a> — nous étudierons sa prise en charge.</p>
                <p style="font-weight: bold; border-left: 4px solid #007aff; padding-left: 10px; margin: 15px 0 10px;">■ Utilisation</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>Un événement par image:</strong> Extrait un seul événement et l'ajoute à votre Google Agenda.</li>
                    <li><strong>Opération:</strong> Choisissez une couleur et lancez. Le PC supporte le glisser-déposer et Ctrl+V.</li>
                    <li><strong>Quick Sync:</strong> Double-cliquez sur un point de couleur pour lancer l'analyse immédiatement.</li>
                </ul>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ Langue de sortie (Nouveau!)</p>
                <div class="lang-selector-container" style="display:flex; flex-wrap:wrap; gap:8px; padding-left:10px; margin-bottom:15px;">
                    <button class="lang-set-btn" data-lang="auto" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Auto (Original)</button>
                    <button class="lang-set-btn" data-lang="ja" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Japonais</button>
                    <button class="lang-set-btn" data-lang="en" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Anglais</button>
                    <button class="lang-set-btn" data-lang="de" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Allemand</button>
                    <button class="lang-set-btn" data-lang="fr" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Français</button>
                    <button class="lang-set-btn" data-lang="es" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Español</button>
                </div>
            `,
            privacy_title: "Privacy Policy",
            privacy_html: `
                <p><strong>1. Collection and Usage</strong><br>We collect basic Google account info (ID, email) and images uploaded for calendar registration. These are used solely for authentication, subscription management, and adding events. Images are deleted immediately after analysis. Google user data is not used for training or improving AI/ML models.</p>
                <p><strong>2. Disclaimer on AI Analysis</strong><br>This service performs analysis using Google Gemini API. Accuracy depends on image quality and is not guaranteed. The operator is not liable for damages arising from analysis errors (e.g., misregistration). Users must always verify the results.</p>
                <p><strong>3. Limited Use of Google API Data</strong><br>Use and transfer to any other app of information received from Google APIs will adhere to Google API Service User Data Policy, including the Limited Use requirements. We do not sell, share, or transfer Google user data to third parties without explicit user consent.</p>
                <p><strong>4. Data Security</strong><br>Personal data is securely managed via Firestore on Google Cloud. We implement industry-standard encryption (SSL/TLS) and maintain strict access controls to protect your data. Users may revoke access via Google account settings at any time. For deletion requests, contact a463311a@gmail.com.</p>
                <p><strong>5. Policy Changes</strong><br>We reserve the right to modify this policy at any time. Changes take effect upon posting on this site.</p>
            `,
            terms_title: "Terms of Service",
            terms_html: `
                <p><strong>1. Service</strong><br>This tool adds events to your calendar via image analysis. Accuracy is not guaranteed and depends on image quality. Always verify Gemini AI analysis before confirming registration.</p>
                <p><strong>2. Payment and Subscription</strong><br>The Premium Plan is a monthly auto-renewing service. You will be billed automatically unless you cancel before the period ends. No pro-rated refunds are provided for mid-month cancellations.</p>
                <p><strong>3. Restrictions</strong><br>Intentional error generation or overloading the server is prohibited. Violations may result in an immediate account ban without notice.</p>
                <p><strong>4. Liability and Refunds</strong><br>The operator is not liable for registration errors, data mismatch, or service interruptions. Refunds are not accepted for digital content or subscriptions for any reason.</p>
            `,
            modal_subTitle: "Passer au Plan Premium",
            modal_body: `<div>1,00 $ USD / mois. Jusqu'à 30 scans par mois. Renouvellement automatique.</div>`,
            modal_agreement: "Défilez pour lire les conditions.",
            modal_agreement_ready: "Vous pouvez maintenant accepter.",
            modal_cancel: "",
            modal_ok: "Accepter et continuer",
            premium_limit_msg: function(d) { return `Limite mensuelle atteinte (30 scans).${d ? ' Prochain reset : ' + d : ''}`; },
            grid: {
                modeLink: "📥 Mode import groupé (β)",
                backLink: "← Retour au mode standard (un événement par image)",
                fileBtn: "🗓️ Choisir un planning ou prospectus (image / PDF)",
                hint: "Enregistrez en une fois les événements de plannings mensuels, menus, prospectus, etc. (image / PDF)",
                classTitle: "Sélectionnez la ou les colonnes de classe (choix multiple)",
                savedApplied: "Votre sélection précédente a été appliquée automatiquement",
                changeClass: "Modifier la sélection de classes",
                readyTitle: "C'est bon — vous pouvez lancer l'extraction",
                consensusNote: "Vérifications croisées répétées pour plus de précision",
                extractBtn: "Extraire les événements",
                reviewTitle: "Vérifiez les événements extraits",
                itemCount: " éléments",
                unverifiedBadge: "NON VÉRIFIÉ",
                unverifiedHint: "⚠️ Les éléments jaunes « non vérifiés » n'ont pas pu être lus avec certitude. Comparez avec le planning original et cochez-les uniquement s'ils sont corrects.",
                registerBtn: "Ajouter les événements cochés à l'agenda",
                registering: "Ajout à l'agenda...",
                registeredMsg: " événements ajoutés 🚀",
                noneSelected: "Veuillez cocher au moins un événement",
                selectClassFirst: "Veuillez sélectionner au moins une classe",
                tooLarge: "Fichier trop volumineux (max 10MB)",
                undoBtn: "🗑️ Annuler cet enregistrement",
                undoConfirm: "Supprimer de l'agenda tous les événements que vous venez d'ajouter ? (Les scans utilisés ne seront pas remboursés)",
                undoing: "Annulation en cours...",
                undoneMsg: " événements supprimés de l'agenda",
                leaveNote: "Vous pouvez quitter cet écran pendant ce temps",
                noticeFmt: function(s, e) { const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {month:'short', day:'numeric'}); return 'Vers ' + (s === e ? f(s) : `${f(s)} – ${f(e)}`) + ' : une flèche ambiguë a été détectée — veuillez vérifier le planning original.'; },
                dateFmt: function(d) { return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {month:'numeric', day:'numeric'}); }
            },
            reauth_btn: "Reconnexion",
            reauth_msg: "Accès à l'agenda refusé. Veuillez vous reconnecter."
        },
        es: {
            subTitle: "Escanear imagen, sincronizar con calendario",
            login: "1. Iniciar sesión con Google",
            camera: "📷 Escanear Foto",
            library: "🖼️ Elegir Foto",
            upload: "Iniciar análisis",
            check: "📅 Ver calendario",
            processing: "Optimización...",
            analyzing: "Analizando...",
            allSuccess: "Sincronizado 🚀",
            remaining: "Restan",
            times: "veces",
            nextReset: "Siguiente reset",
            portal: "Gestionar suscripción",
            anotherCamera: "📷 Re-escanear",
            anotherLibrary: "🖼️ Elegir Foto",
            syncing: "Sincronizando...",
            error_generic: "Error de análisis: ver Guía.",
            guide_title: "Guía de Usuario OneShotCal",
            tokusho_link: "Aviso Legal (SCTA)",
            labelTitle: "EVENTO",
            labelDate: "FECHA Y HORA",
            labelLocation: "UBICACIÓN",
            guide_html: `
                <p style="margin-bottom: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px;">📋 Se admiten muchos formatos de horario, pero según el diseño la lectura puede fallar. Si un horario no funciona, envíenos la imagen a través del <a href="mailto:a463311a@gmail.com?subject=${encodeURIComponent('Informe: horario que no se pudo leer')}" style="color:#2563eb; text-decoration:underline;">soporte (correo)</a>; estudiaremos su compatibilidad.</p>
                <p style="font-weight: bold; border-left: 4px solid #007aff; padding-left: 10px; margin: 15px 0 10px;">■ Uso</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li><strong>Un evento por imagen:</strong> Extrae un evento y lo añade a Google Calendar automáticamente.</li>
                    <li><strong>Operación:</strong> Elige color y ejecuta. PC soporta Arrastrar y Soltar y Ctrl+V.</li>
                    <li><strong>Quick Sync:</strong> Doble toque en un punto de color para iniciar el análisis inmediatamente.</li>
                </ul>
                <p style="font-weight: bold; border-left: 4px solid #10b981; padding-left: 10px; margin: 15px 0 10px;">■ Idioma de salida (¡Nuevo!)</p>
                <div class="lang-selector-container" style="display:flex; flex-wrap:wrap; gap:8px; padding-left:10px; margin-bottom:15px;">
                    <button class="lang-set-btn" data-lang="auto" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Auto (Original)</button>
                    <button class="lang-set-btn" data-lang="ja" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Japonés</button>
                    <button class="lang-set-btn" data-lang="en" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Inglés</button>
                    <button class="lang-set-btn" data-lang="de" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Alemán</button>
                    <button class="lang-set-btn" data-lang="fr" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Francés</button>
                    <button class="lang-set-btn" data-lang="es" style="border:1px solid #cbd5e1; background:#fff; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:12px;">Español</button>
                </div>
            `,
            privacy_title: "Privacy Policy",
            privacy_html: `
                <p><strong>1. Collection and Usage</strong><br>We collect basic Google account info (ID, email) and images uploaded for calendar registration. These are used solely for authentication, subscription management, and adding events. Images are deleted immediately after analysis. Google user data is not used for training or improving AI/ML models.</p>
                <p><strong>2. Disclaimer on AI Analysis</strong><br>This service performs analysis using Google Gemini API. Accuracy depends on image quality and is not guaranteed. The operator is not liable for damages arising from analysis errors (e.g., misregistration). Users must always verify the results.</p>
                <p><strong>3. Limited Use of Google API Data</strong><br>Use and transfer to any other app of information received from Google APIs will adhere to Google API Service User Data Policy, including the Limited Use requirements. We do not sell, share, or transfer Google user data to third parties without explicit user consent.</p>
                <p><strong>4. Data Security</strong><br>Personal data is securely managed via Firestore on Google Cloud. We implement industry-standard encryption (SSL/TLS) and maintain strict access controls to protect your data. Users may revoke access via Google account settings at any time. For deletion requests, contact a463311a@gmail.com.</p>
                <p><strong>5. Policy Changes</strong><br>We reserve the right to modify this policy at any time. Changes take effect upon posting on this site.</p>
            `,
            terms_title: "Terms of Service",
            terms_html: `
                <p><strong>1. Service</strong><br>This tool adds events to your calendar via image analysis. Accuracy is not guaranteed and depends on image quality. Always verify Gemini AI analysis before confirming registration.</p>
                <p><strong>2. Payment and Subscription</strong><br>The Premium Plan is a monthly auto-renewing service. You will be billed automatically unless you cancel before the period ends. No pro-rated refunds are provided for mid-month cancellations.</p>
                <p><strong>3. Restrictions</strong><br>Intentional error generation or overloading the server is prohibited. Violations may result in an immediate account ban without notice.</p>
                <p><strong>4. Liability and Refunds</strong><br>The operator is not liable for registration errors, data mismatch, or service interruptions. Refunds are not accepted for digital content or subscriptions for any reason.</p>
            `,
            modal_subTitle: "Upgrade a Plan Premium",
            modal_body: `<div>$1.00 USD / mes. Hasta 30 escaneos al mes. Renovación automática.</div>`,
            modal_agreement: "Desplace para leer los términos.",
            modal_agreement_ready: "Ya puede aceptar.",
            modal_cancel: "",
            modal_ok: "Aceptar y continuar",
            premium_limit_msg: function(d) { return `Límite mensual alcanzado (30 escaneos).${d ? ' Próximo reinicio: ' + d : ''}`; },
            grid: {
                modeLink: "📥 Modo de importación masiva (β)",
                backLink: "← Volver al modo estándar (un evento por imagen)",
                fileBtn: "🗓️ Elegir horario o folleto (imagen / PDF)",
                hint: "Registre de una vez eventos de horarios mensuales, menús, folletos, etc. (imagen / PDF)",
                classTitle: "Seleccione la(s) columna(s) de clase (selección múltiple)",
                savedApplied: "Se aplicó automáticamente su selección anterior",
                changeClass: "Cambiar selección de clases",
                readyTitle: "Listo: puede iniciar la extracción",
                consensusNote: "Cotejo en varias pasadas para mayor precisión",
                extractBtn: "Extraer eventos",
                reviewTitle: "Revise los eventos extraídos",
                itemCount: " elementos",
                unverifiedBadge: "SIN VERIFICAR",
                unverifiedHint: "⚠️ Los elementos amarillos «sin verificar» no se pudieron leer con seguridad. Compárelos con el horario original y márquelos solo si son correctos.",
                registerBtn: "Añadir los eventos marcados al calendario",
                registering: "Añadiendo al calendario...",
                registeredMsg: " eventos añadidos 🚀",
                noneSelected: "Marque al menos un evento para registrar",
                selectClassFirst: "Seleccione al menos una clase",
                tooLarge: "Archivo demasiado grande (máx. 10MB)",
                undoBtn: "🗑️ Deshacer este registro",
                undoConfirm: "¿Eliminar del calendario todos los eventos que acaba de añadir? (Los escaneos usados no se reembolsan)",
                undoing: "Deshaciendo...",
                undoneMsg: " eventos eliminados del calendario",
                leaveNote: "Puede apartarse de esta pantalla mientras tanto",
                noticeFmt: function(s, e) { const f = (d) => new Date(d + 'T00:00:00').toLocaleDateString('es-ES', {month:'short', day:'numeric'}); return 'Hacia ' + (s === e ? f(s) : `${f(s)} – ${f(e)}`) + ': se detectó una flecha ambigua — compruebe el horario original.'; },
                dateFmt: function(d) { return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', {month:'numeric', day:'numeric'}); }
            },
            reauth_btn: "Reiniciar",
            reauth_msg: "Acceso al calendario no concedido. Por favor, reconecte."
        }
    };
    const ua = navigator.language.slice(0, 2);
    const lang = i18n[ua] ? ua : 'en';
    const t = i18n[lang];
    let currentMonthPath = "";
    let resizedBlob = null;
    let pastedText = null;
    let selectedColorId = "8"; 
    let baseThemeColor = "#616161"; 
    let tempHoverColorId = null;
    let pendingStripeUrl = null;

    let lastTapTime = 0;

    function initLangButtons() {
        const savedLang = localStorage.getItem('oneshot_target_lang') || 'auto';
        document.querySelectorAll('.lang-set-btn').forEach(btn => {
            if (btn.dataset.lang === savedLang) {
                btn.style.background = "#1e293b";
                btn.style.color = "#fff";
                btn.style.borderColor = "#1e293b";
            } else {
                btn.style.background = "#fff";
                btn.style.color = "#64748b";
                btn.style.borderColor = "#cbd5e1";
            }
            btn.onclick = () => {
                localStorage.setItem('oneshot_target_lang', btn.dataset.lang);
                initLangButtons();
            };
        });
    }

    window.onload = async () => {
        subTitle.innerText = t.subTitle;
        loginBtn.innerText = t.login;
        cameraBtn.innerText = t.camera;
        libraryBtn.innerText = t.library;
        uploadBtn.innerText = t.upload;
        checkBtn.innerText = t.check;
        guideTitle.innerText = t.guide_title;
        guideContent.innerHTML = t.guide_html;
        
        const tokushoLink = document.getElementById('tokushoLink');
        if (tokushoLink) tokushoLink.innerHTML = t.tokusho_link;

        document.getElementById('t-labelTitle').innerText = t.labelTitle;
        document.getElementById('t-labelDate').innerText = t.labelDate;
        document.getElementById('t-labelLocation').innerText = t.labelLocation;
        
        if (modalSubTitle) modalSubTitle.innerText = t.modal_subTitle;
        if (modalBody) modalBody.innerHTML = t.modal_body;
        if (modalAgreement) modalAgreement.innerHTML = t.modal_agreement;
        if (modalCancelBtn) modalCancelBtn.innerText = t.modal_cancel;
        if (modalOkBtn) {
            modalOkBtn.innerText = t.modal_ok;
            modalOkBtn.disabled = true;
            modalOkBtn.style.opacity = "0.5";
        }

        const subIdFromCurrentUrl = new URLSearchParams(window.location.search).get('subId');
        const storedSubId = subIdFromCurrentUrl || localStorage.getItem('oneshot_subId');
        const isPremium = localStorage.getItem('oneshot_premium') === 'true';

        if (isPremium) {
            mainCard.classList.add('premium');
            if (planLink) planLink.style.display = 'none';
            const portalUrl = storedSubId ? `/portal?subId=${storedSubId}` : '/portal';
            status.innerHTML = `<small style="color:#94a3b8">PREMIUM PLAN <a href="${portalUrl}" target="_blank" style="color:#64748b; text-decoration:underline; margin-left:8px; pointer-events: auto !important; position: relative; z-index: 10000;">[${t.portal}]</a></small>`;
        }

        const isLoggedIn = document.cookie.includes('session') || new URLSearchParams(window.location.search).get('login') === 'success' || !!storedSubId;
        if (isLoggedIn) {
            loginArea.classList.add('hidden');
            gateArea.classList.remove('hidden');
        }
        
        updateThemeColorsPermanent("8", "#616161");

        const scrollArea = document.getElementById('termsScrollArea');
        if (scrollArea) {
            scrollArea.onscroll = () => {
                const isBottom = scrollArea.scrollHeight - scrollArea.scrollTop <= scrollArea.clientHeight + 20;
                if (isBottom && modalOkBtn.disabled) {
                    modalOkBtn.disabled = false;
                    modalOkBtn.style.opacity = "1";
                    modalOkBtn.style.background = "#d4af37";
                    modalAgreement.innerText = t.modal_agreement_ready;
                    modalAgreement.style.color = "#10b981";
                    modalAgreement.style.fontWeight = "bold";
                }
            };
        }
    };

    modalCloseBtn.onclick = () => {
        subModal.classList.add('hidden');
        subModal.style.display = 'none';
        pendingStripeUrl = null;
    };

    modalSubBtn.onclick = () => {
        if (pendingStripeUrl) window.location.href = pendingStripeUrl;
    };

    guideLink.onclick = (e) => {
        e.preventDefault();
        guideTitle.innerText = t.guide_title;
        guideContent.innerHTML = t.guide_html;
        guideModal.classList.remove('hidden');
        guideModal.style.display = 'flex';
        initLangButtons();
    };

    privacyLink.onclick = (e) => {
        e.preventDefault();
        guideTitle.innerText = t.privacy_title;
        guideContent.innerHTML = t.privacy_html;
        guideModal.classList.remove('hidden');
        guideModal.style.display = 'flex';
    };

    termsLink.onclick = (e) => {
        e.preventDefault();
        guideTitle.innerText = t.terms_title;
        guideContent.innerHTML = t.terms_html;
        guideModal.classList.remove('hidden');
        guideModal.style.display = 'flex';
    };

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'modalTermsLink') {
            e.preventDefault();
            guideTitle.innerText = t.terms_title;
            guideContent.innerHTML = t.terms_html;
            guideModal.classList.remove('hidden');
            guideModal.style.display = 'flex';
        }
    });

    guideCloseBtn.onclick = () => {
        guideModal.classList.add('hidden');
        guideModal.style.display = 'none';
    };

    function updateThemeColorsPermanent(id, color) {
        selectedColorId = id;
        baseThemeColor = color;
        cameraBtn.style.backgroundColor = color;
        libraryBtn.style.backgroundColor = color;
        cameraBtn.style.color = "#ffffff";
        libraryBtn.style.color = "#ffffff";
        mainCard.style.setProperty('border-color', color, 'important');
    }

    function previewZoneColor(id, color) {
        tempHoverColorId = id;
        mainCard.style.setProperty('border-color', color, 'important');
    }

    async function handleQuickPaste(targetId, targetColor) {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                if (window.navigator.vibrate) window.navigator.vibrate(20);
                updateThemeColorsPermanent(targetId, targetColor);
                processText(text);
            }
        } catch (err) {
            console.error("Clipboard access denied or error:", err);
        }
    }

    document.querySelectorAll('.color-dot').forEach(dot => {
        const dotId = dot.id ? dot.id : dot.dataset.id;
        const dotColor = dot.style.backgroundColor;

        dot.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTapTime;
            
            if (tapLength < 350 && tapLength > 0) {
                e.preventDefault();
                handleQuickPaste(dotId, dotColor);
                lastTapTime = 0;
            } else {
                lastTapTime = currentTime;
                // Single tap behavior is handled by click
            }
        });

        dot.onclick = (e) => {
            // PC or touch fallback
            if (e.pointerType === 'mouse' || lastTapTime === 0) {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                updateThemeColorsPermanent(dotId, dotColor);
            }
        };

        dot.ondblclick = (e) => {
            // PC Double click fallback
            e.preventDefault();
            handleQuickPaste(dotId, dotColor);
        };
    });

    document.querySelectorAll('.pc-zone').forEach(zone => {
        zone.onmouseenter = () => {
            previewZoneColor(zone.dataset.id, zone.style.backgroundColor);
        };
        zone.onmouseleave = () => {
            tempHoverColorId = null;
            mainCard.style.setProperty('border-color', baseThemeColor, 'important');
        };
    });

    cameraBtn.onclick = () => { cameraInput.click(); };
    libraryBtn.onclick = () => { libraryInput.click(); };

    const processFile = async (filesList, dropColorId = null) => {
        const file = Array.from(filesList).filter(f => f.type.startsWith('image/'))[0];
        if (!file) return;

        if (dropColorId !== null) {
            selectedColorId = dropColorId;
        }

        status.innerText = t.processing;
        status.className = '';
        checkBtn.style.display = 'none';
        registrationResult.style.display = 'none';
        
        pastedText = null;
        resizedBlob = await resizeImage(file);
        
        startUploadFlow();
    };

    const processText = async (text, dropColorId = null) => {
        if (!text || !text.trim()) return;

        if (dropColorId !== null) {
            selectedColorId = dropColorId;
        }

        status.innerText = t.processing;
        status.className = '';
        checkBtn.style.display = 'none';
        registrationResult.style.display = 'none';

        resizedBlob = null;
        pastedText = text;

        startUploadFlow();
    };

    uploadBtn.onclick = () => {
        startUploadFlow();
    };

    const handleFiles = (e) => processFile(e.target.files);
    cameraInput.onchange = handleFiles;
    libraryInput.onchange = handleFiles;

    window.addEventListener('paste', (e) => {
        if (gateArea.classList.contains('hidden') || gateArea.style.display === 'none') return;
        const items = e.clipboardData.items;
        let foundImage = false;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                processFile([items[i].getAsFile()], tempHoverColorId);
                foundImage = true;
                break;
            }
        }

        if (!foundImage) {
            const text = e.clipboardData.getData('text');
            if (text) {
                processText(text, tempHoverColorId);
            }
        }
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        window.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    window.addEventListener('dragover', (e) => {
        if (gateArea.classList.contains('hidden') || gateArea.style.display === 'none') return;
        mainCard.classList.add('drag-over');
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target && target.classList.contains('pc-zone')) {
            previewZoneColor(target.dataset.id, target.style.backgroundColor);
            document.querySelectorAll('.pc-zone').forEach(z => z.classList.remove('drag-active'));
            target.classList.add('drag-active');
        }
    });

    window.addEventListener('dragleave', (e) => { 
        if (e.relatedTarget === null) {
            mainCard.classList.remove('drag-over');
            tempHoverColorId = null;
            mainCard.style.setProperty('border-color', baseThemeColor, 'important');
            document.querySelectorAll('.pc-zone').forEach(z => z.classList.remove('drag-active'));
        }
    });

    window.addEventListener('drop', (e) => {
        mainCard.classList.remove('drag-over');
        document.querySelectorAll('.pc-zone').forEach(z => z.classList.remove('drag-active'));
        if (gateArea.classList.contains('hidden') || gateArea.style.display === 'none') return;
        
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const dropColorId = (target && target.classList.contains('pc-zone')) ? target.dataset.id : null;
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files, dropColorId);
        } else {
            const text = e.dataTransfer.getData('text');
            if (text) {
                processText(text, dropColorId);
            }
        }
    });

    function resizeImage(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height, max = 800; 
                    if (w > h && w > max) { h *= max / w; w = max; } else if (h > max) { w *= max / h; h = max; }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function startUploadFlow() {
        mainCard.classList.add('analyzing');
        loader.style.display = 'block';
        status.innerText = t.analyzing;
        currentMonthPath = "";
        uploadBtn.style.display = 'none';
        registrationResult.style.display = 'none';
        const subId = localStorage.getItem('oneshot_subId');
        
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
        const targetLang = localStorage.getItem('oneshot_target_lang') || 'auto';
        
        const formData = new FormData();
        formData.append('colorId', selectedColorId);
        if (resizedBlob) formData.append('image', resizedBlob);
        if (pastedText) formData.append('text', pastedText);
        formData.append('timeZone', timeZone);
        formData.append('targetLang', targetLang);
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);
            const headers = {};
            headers['x-is-first-of-batch'] = 'true';
            if (subId) headers['Authorization'] = `Bearer ${subId}`;
            const res = await fetch(`/upload?cache-bust=${Date.now()}`, { 
                method: 'POST', body: formData, headers: headers, signal: controller.signal 
            });
            clearTimeout(timeoutId);
            
            const data = await res.json();
            
            const isAuthError = (res.status === 401) || (res.status === 403) ||
                               (data.error && /session|token|credential|invalid_grant|insufficient|permission/i.test(data.error));
            
            if (isAuthError) {
                localStorage.removeItem('oneshot_subId');
                localStorage.removeItem('oneshot_premium');
                mainCard.classList.remove('analyzing');
                loader.style.display = 'none';
                status.className = 'error-msg';
                status.innerHTML = `${t.reauth_msg || t.error_generic}<br><a href="/auth/google?force=1" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;font-size:12px;font-weight:bold;">${t.reauth_btn}</a>`;
                return;
            }
            
            if (data.limitReached && data.premiumLimit) {
                // 既にプレミアム: アップグレードモーダルは出さず案内のみ（二重課金防止）
                mainCard.classList.remove('analyzing');
                loader.style.display = 'none';
                status.className = '';
                status.innerHTML = `<small style="color:#94a3b8">${t.premium_limit_msg(data.nextResetDate)}</small>`;
                return;
            }

            if (data.limitReached) {
                pendingStripeUrl = data.redirectUrl;
                subModal.classList.remove('hidden');
                subModal.style.display = 'flex';
                const scrollArea = document.getElementById('termsScrollArea');
                if (scrollArea) {
                    scrollArea.scrollTop = 0;
                    modalOkBtn.disabled = true;
                    modalOkBtn.style.opacity = "0.5";
                    modalAgreement.innerText = t.modal_agreement;
                    modalAgreement.style.color = "#64748b";
                }
                mainCard.classList.remove('analyzing');
                loader.style.display = 'none';
                status.innerText = "";
                return;
            }
            
            if (data.success) {
                if (data.targetMonth) currentMonthPath = data.targetMonth;
                if (data.isPremium) {
                    localStorage.setItem('oneshot_premium', 'true');
                    if (planLink) planLink.style.display = 'none';
                }
                
                const prefix = data.isPremium ? 'PREMIUM ' : '';
                const resetInfo = data.nextResetDate ? ` / ${t.nextReset}: ${data.nextResetDate}` : '';
                const sId = localStorage.getItem('oneshot_subId');
                const portalUrl = sId ? `/portal?subId=${sId}` : '/portal';
                const portalLink = data.isPremium ? ` <a href="${portalUrl}" target="_blank" style="color:#64748b; text-decoration:underline; margin-left:8px; pointer-events: auto !important; position: relative; z-index: 10000;">[${t.portal}]</a>` : '';
                
                const countText = `${prefix}(${t.remaining} ${data.count} ${t.times}${resetInfo})${portalLink}`;
                
                status.innerHTML = `<span class="success-msg">${t.allSuccess}</span><br><small style="color:#94a3b8">${countText}</small>`;
                
                if (data.extracted) {
                    resTitle.innerText = data.extracted.summary || "-";
                    const startStr = data.extracted.start?.dateTime || data.extracted.start?.date || "-";
                    resDateTime.innerText = startStr.replace('T', ' ').substring(0, 16);
                    
                    if (data.extracted.location) {
                        resLocation.innerText = data.extracted.location;
                        resLocationBox.style.display = 'block';
                    } else {
                        resLocationBox.style.display = 'none';
                    }
                    registrationResult.style.display = 'block';
                }
                
                checkBtn.style.display = 'block';
            } else {
                status.className = 'error-msg';
                status.innerText = data.error || t.error_generic;
            }
        } catch (err) { 
            status.className = 'error-msg';
            status.innerHTML = `${t.error_generic}<br><a href="/auth/google" style="color:#64748b; text-decoration:underline; font-size:11px;">[${t.reauth_btn}]</a>`;
            
            if (err.name === 'AbortError') {
                window.location.reload();
            }
        } finally {
            mainCard.classList.remove('analyzing');
            loader.style.display = 'none';
        }
    }

    checkBtn.onclick = () => { 
        const path = currentMonthPath ? `month/${currentMonthPath}` : 'month';
        const targetUrl = `https://calendar.google.com/calendar/u/0/r/${path}`;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && /Android/i.test(navigator.userAgent)) {
            sessionStorage.setItem('kill_bfcache', 'true');
            window.location.href = `intent://calendar.google.com/calendar/u/0/r/${path}#Intent;scheme=https;package=com.google.android.calendar;end`;
        } else if (!isMobile || window.innerWidth >= 768) {
            const newWindow = window.open(targetUrl, '_blank');
            if (!newWindow || newWindow.closed || typeof newWindow.closed == 'undefined') {
                sessionStorage.setItem('kill_bfcache', 'true');
                window.location.href = targetUrl;
            }
        } else {
            sessionStorage.setItem('kill_bfcache', 'true');
            window.location.href = targetUrl;
        }
    };

    // ═══════════════════════════════════════════════════════════
    // グリッド（月間予定表）モード
    // 既存の1画像1予定フローとは独立した追加機能。
    // 要素が存在しないページでは何もしない（既存ページを壊さない）。
    // ═══════════════════════════════════════════════════════════
    (function initGridMode() {
        const gridModeLink = document.getElementById('gridModeLink');
        const gridArea = document.getElementById('gridArea');
        if (!gridModeLink || !gridArea || !t.grid) return;

        const g = t.grid;
        const gridFileBtn = document.getElementById('gridFileBtn'),
              gridFileInput = document.getElementById('gridFileInput'),
              gridHint = document.getElementById('gridHint'),
              gridClassStep = document.getElementById('gridClassStep'),
              gridClassTitle = document.getElementById('gridClassTitle'),
              gridClassList = document.getElementById('gridClassList'),
              gridChangeClassLink = document.getElementById('gridChangeClassLink'),
              gridExtractBtn = document.getElementById('gridExtractBtn'),
              gridReviewStep = document.getElementById('gridReviewStep'),
              gridReviewTitle = document.getElementById('gridReviewTitle'),
              gridNotices = document.getElementById('gridNotices'),
              gridUnverifiedHint = document.getElementById('gridUnverifiedHint'),
              gridEventList = document.getElementById('gridEventList'),
              gridRegisterBtn = document.getElementById('gridRegisterBtn'),
              gridBackLink = document.getElementById('gridBackLink');

        let gridBlob = null;        // 送信ファイル（画像はリサイズ済みJPEG、PDFは原本）
        let gridIsPdf = false;
        let gridColumns = [];       // 検出された列見出し
        let gridSelected = [];      // 選択中のクラス列（column_select の回答）
        let gridAutoApplied = false;
        let gridEvents = [];        // 抽出結果
        let gridLastBatchId = null; // 直近の一括登録の取り消し用batchId
        let bulkDocTypes = [];      // /bulk/triage の書類タイプ判定（可能性の高い順）
        let bulkQuestions = [];     // /bulk/triage が生成した確認質問（chip選択式）
        let bulkAnswers = [];       // 質問index → 選択された選択肢の配列
        let bulkLikelyMode = 'grid';// 進捗UIの切り替え用: 'grid'（4段階） | 'generic'（簡略）
        let bulkMode = 'grid';      // 抽出結果のモード（レビュー表示の分岐用）

        // 取り消しボタンは動的生成（HTML6ファイルを変更しないため）
        const gridUndoBtn = document.createElement('button');
        gridUndoBtn.id = 'gridUndoBtn';
        gridUndoBtn.className = 'grid-undo-btn';
        gridUndoBtn.style.display = 'none';
        gridArea.insertBefore(gridUndoBtn, gridBackLink.parentElement);

        // ── 解析進捗の%カウンター表示（動的生成: HTML6ファイルを変更しないため） ──
        // 疑似進捗: 実測中央値 medianSec で 80% に達する指数漸近カーブ
        // p = 90(1-e^(-t/τ))、τ = medianSec/ln(9)。カーブが寝てきたら
        // +0.15%/秒 の微増を足して 97% を上限に動き続ける（凍結感の防止）。
        // 100% は完了イベント（progressFinish）だけが到達させ、後退はしない。
        const gridProgress = document.createElement('div');
        gridProgress.id = 'gridProgress';
        gridProgress.className = 'grid-progress';
        gridProgress.style.display = 'none';
        const progressCaption = document.createElement('div');
        progressCaption.className = 'grid-progress-caption';
        const progressPct = document.createElement('div');
        progressPct.className = 'grid-progress-pct';
        const progressBar = document.createElement('div');
        progressBar.className = 'grid-progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'grid-progress-fill';
        progressBar.appendChild(progressFill);
        const progressNote = document.createElement('div');
        progressNote.className = 'grid-progress-note';
        gridProgress.appendChild(progressCaption);
        gridProgress.appendChild(progressPct);
        gridProgress.appendChild(progressBar);
        gridProgress.appendChild(progressNote);
        gridArea.insertBefore(gridProgress, gridClassStep);

        let progressTimer = null;
        let progressValue = 0;

        function progressRender() {
            progressPct.textContent = Math.floor(progressValue) + '%';
            progressFill.style.width = progressValue + '%';
        }

        function progressStop() {
            if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        }

        // medianSec: フェーズの実測中央値（本番ログ由来。この時点で80%に達する）
        // noteLines: %の下に出す静的な一文の配列（空なら非表示）
        function progressStart(medianSec, noteLines) {
            progressStop();
            const tau = medianSec / Math.log(9);
            const t0 = Date.now();
            progressValue = 0;
            progressCaption.textContent = t.analyzing;
            const note = (noteLines || []).filter(Boolean).join('\n');
            progressNote.textContent = note;
            progressNote.style.display = note ? 'block' : 'none';
            progressRender();
            gridProgress.style.display = 'block';
            progressTimer = setInterval(() => {
                const sec = (Date.now() - t0) / 1000;
                // 基本カーブ＋（カーブが88%相当で寝てきた後の）0.15%/秒の微増。上限97%
                const crawl = Math.max(0, sec - 3.81 * tau) * 0.15;
                const p = Math.min(97, 90 * (1 - Math.exp(-sec / tau)) + crawl);
                if (p > progressValue) progressValue = p;
                progressRender();
            }, 100);
        }

        // 完了: 現在値→100%へ約250msでイージングし、少し見せてから隠して cb を呼ぶ
        function progressFinish(cb) {
            progressStop();
            const from = progressValue;
            const t0 = Date.now();
            const anim = setInterval(() => {
                const k = Math.min(1, (Date.now() - t0) / 250);
                progressValue = from + (100 - from) * k;
                progressRender();
                if (k >= 1) {
                    clearInterval(anim);
                    setTimeout(() => {
                        gridProgress.style.display = 'none';
                        if (cb) cb();
                    }, 150);
                }
            }, 40);
        }

        function progressReset() {
            progressStop();
            progressValue = 0;
            gridProgress.style.display = 'none';
        }

        // 進捗中はボタンだけ無効化する（青い線スキャン演出とローダーは
        // 通常モード専用に戻し、一括登録モードでは%表示に一本化）
        function gridSetBusyQuiet() {
            status.className = '';
            status.innerText = '';
            gridFileBtn.disabled = true;
            gridExtractBtn.disabled = true;
            gridRegisterBtn.disabled = true;
            gridUndoBtn.disabled = true;
        }

        // ラベル初期化（app.jsはbody末尾で読み込まれるためDOMは利用可能）
        gridModeLink.innerText = g.modeLink;
        gridBackLink.innerText = g.backLink;
        gridFileBtn.innerText = g.fileBtn;
        gridHint.innerText = g.hint;
        gridChangeClassLink.innerText = g.changeClass;
        gridExtractBtn.innerText = g.extractBtn;
        gridRegisterBtn.innerText = g.registerBtn;
        gridUndoBtn.innerText = g.undoBtn;

        function gridReset() {
            gridBlob = null;
            gridIsPdf = false;
            gridColumns = [];
            gridSelected = [];
            gridAutoApplied = false;
            gridEvents = [];
            bulkDocTypes = [];
            bulkQuestions = [];
            bulkAnswers = [];
            bulkLikelyMode = 'grid';
            bulkMode = 'grid';
            gridClassTitle.style.display = '';
            gridClassStep.style.display = 'none';
            gridReviewStep.style.display = 'none';
            gridNotices.innerHTML = '';
            gridEventList.innerHTML = '';
            gridLastBatchId = null;
            gridUndoBtn.style.display = 'none';
            progressReset();
        }

        gridModeLink.onclick = (e) => {
            e.preventDefault();
            gateArea.classList.add('hidden');
            gridArea.classList.remove('hidden');
            gridArea.style.display = 'block';
            status.innerText = '';
            status.className = '';
            registrationResult.style.display = 'none';
            checkBtn.style.display = 'none';
        };

        gridBackLink.onclick = (e) => {
            e.preventDefault();
            gridReset();
            gridArea.classList.add('hidden');
            gridArea.style.display = 'none';
            gateArea.classList.remove('hidden');
            status.innerText = '';
            status.className = '';
        };

        function gridSetBusy(msg, showLoader = true) {
            mainCard.classList.add('analyzing');
            loader.style.display = showLoader ? 'block' : 'none';
            status.className = '';
            status.innerText = msg;
            gridFileBtn.disabled = true;
            gridExtractBtn.disabled = true;
            gridRegisterBtn.disabled = true;
            gridUndoBtn.disabled = true;
        }

        function gridClearBusy() {
            mainCard.classList.remove('analyzing');
            loader.style.display = 'none';
            gridFileBtn.disabled = false;
            gridExtractBtn.disabled = false;
            gridRegisterBtn.disabled = false;
            gridUndoBtn.disabled = false;
        }

        function gridShowError(msg) {
            status.className = 'error-msg';
            status.innerText = msg || t.error_generic;
        }

        // 既存 startUploadFlow の認証エラー処理と同じ挙動
        function gridHandleAuthError(res, data) {
            const isAuthError = (res.status === 401) || (res.status === 403) ||
                (data && data.error && /session|token|credential|invalid_grant|insufficient|permission|unauthorized/i.test(data.error));
            if (!isAuthError) return false;
            localStorage.removeItem('oneshot_subId');
            localStorage.removeItem('oneshot_premium');
            status.className = 'error-msg';
            status.innerHTML = `${t.reauth_msg || t.error_generic}<br><a href="/auth/google?force=1" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;font-size:12px;font-weight:bold;">${t.reauth_btn}</a>`;
            return true;
        }

        // limitReached 応答の共通処理。プレミアム上限は案内のみ（二重課金防止）、
        // 無料ユーザーは既存どおりアップグレードモーダルへ。
        function gridHandleLimit(data) {
            if (!data.limitReached) return false;
            if (data.premiumLimit) {
                status.className = '';
                status.innerHTML = `<small style="color:#94a3b8">${t.premium_limit_msg(data.nextResetDate)}</small>`;
            } else {
                gridOpenSubModal(data.redirectUrl);
            }
            return true;
        }

        // 既存 startUploadFlow の limitReached 処理と同じ挙動（Stripeモーダル）
        function gridOpenSubModal(url) {
            pendingStripeUrl = url;
            subModal.classList.remove('hidden');
            subModal.style.display = 'flex';
            const scrollArea = document.getElementById('termsScrollArea');
            if (scrollArea) {
                scrollArea.scrollTop = 0;
                modalOkBtn.disabled = true;
                modalOkBtn.style.opacity = "0.5";
                modalAgreement.innerText = t.modal_agreement;
                modalAgreement.style.color = "#64748b";
            }
            status.innerText = '';
        }

        async function gridFetch(url, options, timeoutMs) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await fetch(url, { ...options, credentials: 'include', signal: controller.signal });
            } finally {
                clearTimeout(tid);
            }
        }

        // グリッドは文字が細かいため、既存(800px)より大きい1600pxでリサイズ
        function gridResizeImage(file) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let w = img.width, h = img.height, max = 1600;
                        if (w > h && w > max) { h *= max / w; w = max; } else if (h > max) { w *= max / h; h = max; }
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        gridFileBtn.onclick = () => gridFileInput.click();

        gridFileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            gridReset();
            gridIsPdf = file.type === 'application/pdf';
            if (gridIsPdf) {
                if (file.size > 10 * 1024 * 1024) { gridShowError(g.tooLarge); return; }
                gridBlob = file;
            } else {
                gridBlob = await gridResizeImage(file);
            }
            await bulkTriage();
        };

        function gridFileName() { return gridIsPdf ? 'schedule.pdf' : 'schedule.jpg'; }

        // STEP 1: 書類タイプ判定＋確認質問の取得（フェーズ1: %進捗）
        async function bulkTriage() {
            gridSetBusyQuiet();
            progressStart(9.5, []); // 本番実測中央値 約9.5秒（triage 1呼び出し）
            try {
                const fd = new FormData();
                fd.append('file', gridBlob, gridFileName());
                const res = await gridFetch(`/bulk/triage?cache-bust=${Date.now()}`, { method: 'POST', body: fd }, 60000);
                const data = await res.json();
                if (gridHandleAuthError(res, data)) { progressReset(); return; }
                if (!data.success) { progressReset(); gridShowError(data.error); return; }

                bulkDocTypes = data.docTypes || [];
                bulkQuestions = (data.questions || []).filter(q => q && q.prompt && Array.isArray(q.options) && q.options.length > 0);
                bulkLikelyMode = data.likelyMode === 'generic' ? 'generic' : 'grid';
                gridColumns = data.columns || [];
                bulkAnswers = bulkQuestions.map(() => []);

                // 保存済みの選択が現在の表の列名と一致すれば自動適用（再選択の導線あり）
                gridSelected = (data.savedClasses && data.savedClasses.length > 0) ? data.savedClasses.slice() : [];
                gridAutoApplied = gridSelected.length > 0;
                const colIdx = bulkQuestions.findIndex(q => q.type === 'column_select');
                if (colIdx >= 0 && gridAutoApplied) bulkAnswers[colIdx] = gridSelected.slice();
                // date_confirm は最有力候補（先頭）を既定選択にして、年月の推測を
                // silent にせずユーザーの目に見える形にする（変更はワンタップ）
                bulkQuestions.forEach((q, i) => {
                    if (q.type === 'date_confirm' && bulkAnswers[i].length === 0) bulkAnswers[i] = [q.options[0]];
                });

                status.innerText = '';
                progressFinish(() => renderQuestionsStep());
            } catch (err) {
                progressReset();
                gridShowError(t.error_generic);
            } finally {
                gridClearBusy();
            }
        }

        // STEP 1.5: 確認質問（chip選択式）。質問ゼロなら見出しのみ表示して即抽出へ。
        // column_select は従来のクラス選択と同じ挙動（保存済み選択の自動適用＋変更導線）。
        function renderQuestionsStep() {
            gridReviewStep.style.display = 'none';
            gridClassStep.style.display = 'block';
            gridClassList.innerHTML = '';
            gridChangeClassLink.style.display = 'none';
            gridClassTitle.style.display = '';

            if (bulkQuestions.length === 0) {
                gridClassTitle.innerText = g.readyTitle;
                return;
            }

            const colIdx = bulkQuestions.findIndex(q => q.type === 'column_select');
            const colAuto = gridAutoApplied && colIdx >= 0;
            if (colAuto) {
                gridClassTitle.innerText = g.savedApplied;
                gridChangeClassLink.style.display = 'inline';
            } else {
                // 各質問が自前の見出しを持つのでタイトル行は畳む
                gridClassTitle.innerText = '';
                gridClassTitle.style.display = 'none';
            }

            bulkQuestions.forEach((q, qi) => {
                const isCol = q.type === 'column_select';

                if (!(isCol && colAuto)) {
                    const head = document.createElement('div');
                    head.style.cssText = 'width:100%;font-size:13px;color:#334155;font-weight:bold;margin:10px 0 2px;text-align:left;';
                    head.textContent = q.prompt || (isCol ? g.classTitle : '');
                    gridClassList.appendChild(head);
                }

                if (isCol && colAuto) {
                    // 自動適用: 前回の選択を読み取り専用チップで表示（従来どおり）
                    gridSelected.forEach(c => {
                        const chip = document.createElement('div');
                        chip.className = 'grid-class-item selected readonly';
                        chip.textContent = c;
                        gridClassList.appendChild(chip);
                    });
                    return;
                }

                q.options.forEach(opt => {
                    const chip = document.createElement('div');
                    chip.className = 'grid-class-item' + (bulkAnswers[qi].includes(opt) ? ' selected' : '');
                    chip.dataset.q = String(qi);
                    chip.textContent = opt;
                    chip.onclick = () => {
                        const sel = bulkAnswers[qi];
                        const i = sel.indexOf(opt);
                        if (i >= 0) {
                            sel.splice(i, 1);
                            chip.classList.remove('selected');
                        } else {
                            if (!q.multi) {
                                sel.length = 0;
                                gridClassList.querySelectorAll(`.grid-class-item[data-q="${qi}"]`).forEach(el => el.classList.remove('selected'));
                            }
                            sel.push(opt);
                            chip.classList.add('selected');
                        }
                        if (isCol) gridSelected = sel.slice();
                    };
                    gridClassList.appendChild(chip);
                });
            });
        }

        gridChangeClassLink.onclick = (e) => {
            e.preventDefault();
            gridAutoApplied = false;
            renderQuestionsStep();
        };

        // STEP 2: 予定の構造化抽出（この時点では登録しない）
        // グリッド見込みなら進捗ステップ2〜4＋3本バー（3ラン多数決）、
        // グリッド見込み/汎用とも同じ%進捗で統一（カーブの中央値定数と
        // 静的な一文だけ likelyMode で切り替える）
        gridExtractBtn.onclick = async () => {
            if (!gridBlob) return;
            const hasColQ = bulkQuestions.some(q => q.type === 'column_select');
            if (bulkLikelyMode === 'grid' && hasColQ && gridSelected.length === 0) { gridShowError(g.selectClassFirst); return; }
            gridClassStep.style.display = 'none';
            gridSetBusyQuiet();
            if (bulkLikelyMode === 'grid') {
                // 本番実測中央値 約45秒（3ラン多数決）。照合中の一文＋離脱OKの案内
                progressStart(45, [g.consensusNote, g.leaveNote]);
            } else {
                // 本番実測中央値 約15秒（汎用1〜2呼び出し）
                progressStart(15, [g.leaveNote]);
            }
            try {
                const fd = new FormData();
                fd.append('file', gridBlob, gridFileName());
                fd.append('docTypes', JSON.stringify(bulkDocTypes));
                fd.append('answers', JSON.stringify(bulkQuestions.map((q, i) => ({ type: q.type, prompt: q.prompt, values: bulkAnswers[i] }))));
                fd.append('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo');
                fd.append('targetLang', localStorage.getItem('oneshot_target_lang') || 'auto');
                const res = await gridFetch(`/bulk/extract?cache-bust=${Date.now()}`, { method: 'POST', body: fd }, 120000);
                const data = await res.json();
                if (gridHandleAuthError(res, data)) { progressReset(); return; }
                if (gridHandleLimit(data)) { progressReset(); return; }
                if (!data.success) { progressReset(); gridShowError(data.error); return; }

                gridEvents = data.events || [];
                bulkMode = data.mode === 'generic' ? 'generic' : 'grid';
                if (data.selectedClasses && data.selectedClasses.length > 0) gridSelected = data.selectedClasses;

                status.innerText = '';
                const notices = data.notices || [];
                progressFinish(() => renderReview(notices));
            } catch (err) {
                progressReset();
                gridShowError(t.error_generic);
            } finally {
                gridClearBusy();
            }
        };

        // STEP 3: 抽出結果のレビュー表示
        function renderReview(notices) {
            gridClassStep.style.display = 'none';
            gridReviewStep.style.display = 'block';
            gridReviewTitle.innerText = `${g.reviewTitle}（${gridEvents.length}${g.itemCount}）`;

            // 曖昧な矢印の注意文（予定としては登録しない）
            gridNotices.innerHTML = '';
            notices.forEach(n => {
                const div = document.createElement('div');
                div.className = 'grid-notice';
                div.textContent = '🔔 ' + g.noticeFmt(n.startDate, n.endDate);
                gridNotices.appendChild(div);
            });

            const hasLow = gridEvents.some(ev => ev.confidence !== 'high');
            gridUnverifiedHint.innerText = g.unverifiedHint;
            gridUnverifiedHint.style.display = hasLow ? 'block' : 'none';

            // 対象バッジ: グリッドは複数クラス選択時、汎用は対象（列・人・系列）が複数種のとき
            const showTargetBadge = bulkMode === 'generic'
                ? new Set(gridEvents.map(ev => ev.className).filter(Boolean)).size > 1
                : gridSelected.length > 1;

            gridEventList.innerHTML = '';
            gridEvents.forEach((ev, i) => {
                const row = document.createElement('label');
                row.className = 'grid-event-row' + (ev.confidence !== 'high' ? ' unverified' : '');

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.idx = String(i);
                cb.checked = ev.confidence === 'high'; // 未検証はデフォルトOFF＝要確認

                const dateSpan = document.createElement('span');
                dateSpan.className = 'grid-event-date';
                dateSpan.textContent = g.dateFmt(ev.date)
                    + (ev.endDate ? `-${g.dateFmt(ev.endDate)}` : '')
                    + (ev.startTime ? ` ${ev.startTime}` : '');

                const body = document.createElement('span');
                body.textContent = ev.summary;
                if (showTargetBadge && ev.className) {
                    const cls = document.createElement('span');
                    cls.className = 'grid-badge cls';
                    cls.textContent = ev.className;
                    body.appendChild(cls);
                }
                if (ev.confidence !== 'high') {
                    const warn = document.createElement('span');
                    warn.className = 'grid-badge warn';
                    warn.textContent = g.unverifiedBadge;
                    body.appendChild(warn);
                }

                row.appendChild(cb);
                row.appendChild(dateSpan);
                row.appendChild(body);
                gridEventList.appendChild(row);
            });
        }

        // STEP 4: チェック済みの予定のみ一括登録
        gridRegisterBtn.onclick = async () => {
            const chosen = [];
            gridEventList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (cb.checked && gridEvents[Number(cb.dataset.idx)]) {
                    chosen.push(gridEvents[Number(cb.dataset.idx)]);
                }
            });
            if (chosen.length === 0) { gridShowError(g.noneSelected); return; }

            gridSetBusy(g.registering);
            try {
                const res = await gridFetch(`/grid/register?cache-bust=${Date.now()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        events: chosen,
                        colorId: selectedColorId,
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
                        multiClass: bulkMode === 'generic'
                            ? new Set(chosen.map(ev => ev.className).filter(Boolean)).size > 1
                            : gridSelected.length > 1
                    })
                }, 180000);
                const data = await res.json();
                if (gridHandleAuthError(res, data)) return;
                if (gridHandleLimit(data)) return;
                if (!data.success) { gridShowError(data.error); return; }

                if (data.targetMonth) currentMonthPath = data.targetMonth;
                if (data.isPremium) {
                    localStorage.setItem('oneshot_premium', 'true');
                    if (planLink) planLink.style.display = 'none';
                }
                const prefix = data.isPremium ? 'PREMIUM ' : '';
                const resetInfo = data.nextResetDate ? ` / ${t.nextReset}: ${data.nextResetDate}` : '';
                status.className = '';
                status.innerHTML = `<span class="success-msg">${data.registered}${g.registeredMsg}</span><br><small style="color:#94a3b8">${prefix}(${t.remaining} ${data.count} ${t.times}${resetInfo})</small>`;

                gridReviewStep.style.display = 'none';
                gridNotices.innerHTML = '';
                gridEventList.innerHTML = '';
                gridEvents = [];
                gridBlob = null;
                checkBtn.style.display = 'block';

                // 取り消しボタンの表示（batchIdが返らなかった場合は出さない）
                gridLastBatchId = data.batchId || null;
                gridUndoBtn.style.display = gridLastBatchId ? 'block' : 'none';
            } catch (err) {
                gridShowError(t.error_generic);
            } finally {
                gridClearBusy();
            }
        };

        // STEP 5: 直近の一括登録を取り消す（登録直後の画面からのみ）
        gridUndoBtn.onclick = async () => {
            if (!gridLastBatchId) return;
            if (!window.confirm(g.undoConfirm)) return;
            gridSetBusy(g.undoing);
            try {
                const res = await gridFetch(`/grid/undo?cache-bust=${Date.now()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ batchId: gridLastBatchId })
                }, 120000);
                const data = await res.json();
                if (gridHandleAuthError(res, data)) return;
                if (!data.success) { gridShowError(data.error); return; }

                gridLastBatchId = null;
                gridUndoBtn.style.display = 'none';
                checkBtn.style.display = 'none';
                status.className = '';
                status.innerHTML = `<span class="success-msg">${data.deleted}${g.undoneMsg}</span>`;
            } catch (err) {
                gridShowError(t.error_generic);
            } finally {
                gridClearBusy();
            }
        };
    })();
})();
