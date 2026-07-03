document.addEventListener('DOMContentLoaded', () => {
    // ユーザーのブラウザ言語を判定 (日本語、ドイツ語、フランス語、スペイン語、またはそれ以外)
    const uaLang = navigator.language.slice(0, 2);
    const supportedLangs = ['ja', 'de', 'fr', 'es'];
    const lang = supportedLangs.includes(uaLang) ? uaLang : 'en';

    // 言語設定を保存 (tokushoの切り替えに使用)
    localStorage.setItem('preferredLanguage', lang);

    // data属性を持つすべての要素を抽出
    const elements = document.querySelectorAll('[data-ja], [data-en], [data-de], [data-fr], [data-es]');

    elements.forEach(el => {
        // 表示テキストの定義
        let text = el.getAttribute(`data-${lang}`) || el.getAttribute('data-en');

        if (lang === 'ja') {
            if (text === "OneShotは、Googleのセキュリティ基準を遵守した安全な連携サービスです。") {
                text = "OneShotは、Googleの厳格なセキュリティ審査をクリアした安全なサービスです。";
            } else if (text === "Googleポリシーを遵守") {
                text = "Google公式審査済み";
            }
        } else if (lang === 'en') {
            if (text === "OneShot is a secure integrated service that complies with Google's security standards.") {
                text = "OneShot is a secure service that has passed Google's strict security review.";
            } else if (text === "Policy Compliance") {
                text = "Google Verified";
            }
        } else if (lang === 'de') {
            if (text === "OneShot ist ein sicherer integrierter Dienst, der die Sicherheitsstandards von Google einhält.") {
                text = "OneShot ist ein sicherer Dienst, der die strengen Sicherheitsprüfungen von Google bestanden hat.";
            } else if (text === "Richtlinienkonformität") {
                text = "Google-geprüft";
            }
        } else if (lang === 'fr') {
            if (text === "OneShot est un service intégré sécurisé qui respecte les normes de sécurité de Google.") {
                text = "OneShot est un service sécurisé qui a passé l'examen de sécurité strict de Google.";
            } else if (text === "Conformité aux politiques") {
                text = "Vérifié par Google";
            }
        } else if (lang === 'es') {
            if (text === "OneShot es un servicio integrado seguro que cumple con los estándares de seguridad de Google.") {
                text = "OneShot es un servicio seguro que ha superado la estricta revisión de seguridad de Google.";
            } else if (text === "Cumplimiento de políticas") {
                text = "Verificado por Google";
            }
        }
        
        if (text) {
            // 要素の中身を書き換える (innerHTMLに変更して<br>タグ等を有効化)
            el.innerHTML = text;
        }
    });

    // デザインの微調整：言語に合わせてフォントのウェイトやスタイルを微調整可能
    if (lang === 'ja') {
        document.body.style.letterSpacing = "0.02em";
    } else {
        document.body.style.letterSpacing = "-0.01em";
    }

    // スクロール時のフェードイン演出（Intersection Observer）
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = "1";
                entry.target.style.transform = "translateY(0)";
            }
        });
    }, observerOptions);

    document.querySelectorAll('.feature-card, .trust-card, .next-step-box').forEach(card => {
        card.style.opacity = "0";
        card.style.transform = "translateY(30px)";
        card.style.transition = "all 0.8s ease-out";
        observer.observe(card);
    });
});