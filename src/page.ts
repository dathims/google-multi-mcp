// Page affichée dans le navigateur à la fin du flux OAuth (add-account).
// Identité visuelle reprise de useCockpit : papier, encre, accents jaune/bleu/corail.

export interface ServiceStatus {
  name: string;
  detail: string;
  granted: boolean;
}

export type CallbackResult =
  | { ok: true; alias: string; email: string; services: ServiceStatus[] }
  | { ok: false; alias: string; message: string };

// Les valeurs affichées viennent en partie de l'URL de retour : tout est échappé.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Content-Security-Policy envoyée avec la page : aucun script, aucune ressource externe.
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const MARK = `<svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#f1efe9"/><path d="M10 32h44M10 23v18" fill="none" stroke="#efb900" stroke-width="8"/><circle cx="32" cy="32" r="13" fill="#fff" stroke="#3a3331" stroke-width="7"/></svg>`;

const CHECK = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#efb900"/><path d="M5.5 10.3l3 3 6-6.4" fill="none" stroke="#3a3331" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#df6048"/><path d="M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const STYLE = `
:root{--paper:#f1efe9;--surface:#faf9f6;--ink:#3a3331;--muted:#6b6763;--line:#d9d6cf;--yellow:#efb900;--blue:#294ba5;--coral:#df6048;
  font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:var(--ink);background:var(--paper);color-scheme:light;font-synthesis:none}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.wrap{width:min(100% - 32px,720px);margin-inline:auto}
header{display:flex;align-items:center;justify-content:space-between;padding-block:24px}
.wordmark{display:inline-flex;align-items:center;gap:8px;font-size:20px;font-weight:600;letter-spacing:-.6px}
.tag{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:30px;padding:6px 12px;background:var(--surface)}
main{flex:1;padding:48px 0 32px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:0 0 18px}
.eyebrow::before{content:"";width:22px;height:4px;border-radius:2px;background:var(--accent)}
h1{font-size:clamp(44px,8vw,72px);font-weight:500;line-height:1.02;letter-spacing:-.063em;margin:0 0 22px}
.lead{font-size:18px;line-height:1.6;color:var(--muted);margin:0 0 36px;max-width:560px}
.lead strong{color:var(--ink);font-weight:600}
.alias{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.92em;background:#fff;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:var(--ink)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:8px 24px;margin-bottom:20px}
.service{display:flex;align-items:center;gap:14px;padding:16px 0;border-top:1px solid var(--line)}
.service:first-child{border-top:0}
.service svg{flex:none}
.service b{font-weight:600;font-size:16px;display:block}
.service span{font-size:14px;color:var(--muted)}
.service.missing span{color:var(--coral)}
.next{padding:22px 24px}
.next h2{font-size:15px;font-weight:600;margin:0 0 6px}
.next p{font-size:14px;line-height:1.55;color:var(--muted);margin:0 0 14px}
pre{margin:0;background:var(--ink);color:#f1efe9;border-radius:12px;padding:14px 18px;font:14px/1.5 ui-monospace,"SF Mono",Menlo,monospace;overflow-x:auto}
pre .p{color:var(--yellow);user-select:none}
.close{display:inline-flex;align-items:center;gap:10px;margin-top:28px;font-size:15px;color:var(--muted)}
.close kbd{font:inherit;font-size:13px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:2px 7px;color:var(--ink)}
footer{border-top:1px solid var(--line);padding-block:20px 28px;font-size:13px;line-height:1.6;color:var(--muted)}
footer a{color:var(--blue)}
@media (max-width:560px){main{padding-top:24px}.lead{font-size:16px}.card{padding:4px 18px}.next{padding:18px}.tag{display:none}pre{white-space:pre-wrap;overflow-wrap:anywhere}}
`;

export function renderCallbackPage(r: CallbackResult): string {
  const accent = r.ok ? "var(--yellow)" : "var(--coral)";
  const alias = esc(r.alias);

  const body = r.ok
    ? `<p class="eyebrow">Connexion Google</p>
<h1>Compte connecté.</h1>
<p class="lead"><strong>${esc(r.email)}</strong> est maintenant disponible pour Claude sous l'alias <span class="alias">${alias}</span>.</p>
<section class="card" aria-label="Services autorisés">
${r.services
  .map(
    (s) => `<div class="service${s.granted ? "" : " missing"}">${s.granted ? CHECK : CROSS}<div><b>${esc(s.name)}</b><span>${
      s.granted ? esc(s.detail) : "Autorisation non cochée : relance la commande et coche toutes les cases."
    }</span></div></div>`,
  )
  .join("\n")}
</section>
<section class="card next">
<h2>Ajouter un autre compte</h2>
<p>Chaque compte Google a son alias. Il est utilisable tout de suite dans Claude, sans redémarrage.</p>
<pre><span class="p">$ </span>npm run add-account -- pro</pre>
</section>
<p class="close">Tu peux fermer cet onglet <kbd>⌘ W</kbd></p>`
    : `<p class="eyebrow">Connexion Google</p>
<h1>Connexion interrompue.</h1>
<p class="lead">Le compte <span class="alias">${alias}</span> n'a pas été ajouté. ${esc(r.message)}</p>
<section class="card next">
<h2>Réessayer</h2>
<p>Relance la commande depuis le terminal, puis choisis le bon compte Google et accepte toutes les autorisations.</p>
<pre><span class="p">$ </span>npm run add-account -- ${alias}</pre>
</section>`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>${r.ok ? "Compte connecté" : "Connexion interrompue"} · Cockpit</title>
<style>${STYLE}:root{--accent:${accent}}</style></head>
<body>
<header class="wrap"><span class="wordmark">${MARK}<span>cockpit</span></span><span class="tag">plugin · google-multi</span></header>
<main class="wrap">
${body}
</main>
<footer class="wrap">Les jetons restent sur ce Mac, dans <code>~/.config/google-multi-mcp</code>, lisibles par toi seul.
Pour révoquer l'accès à tout moment : <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</footer>
</body></html>`;
}
