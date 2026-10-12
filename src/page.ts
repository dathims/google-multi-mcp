// Page shown in the browser at the end of the OAuth flow (add-account).
// Visual identity taken from useCockpit: paper, ink, yellow/blue/coral accents.

import { SERVICE_LOGOS, type ServiceLogo } from "./logos.js";

export interface ServiceStatus {
  logo: ServiceLogo;
  name: string;
  detail: string;
  granted: boolean;
}

export type CallbackResult =
  | { ok: true; alias: string; email: string; services: ServiceStatus[] }
  | { ok: false; alias: string; message: string };

// Some of the displayed values come from the callback URL: everything is escaped.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Content-Security-Policy sent with the page: no script, no external resource.
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
.service{display:flex;align-items:center;gap:16px;padding:16px 0;border-top:1px solid var(--line)}
.service .logo{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:13px;background:#fff;border:1px solid var(--line)}
.service .logo img{width:28px;height:28px;object-fit:contain}
.service.missing .logo img{opacity:.45}
.service .text{flex:1;min-width:0}
.service .status{flex:none}
.service:first-child{border-top:0}
.service .status svg{display:block}
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
    ? `<p class="eyebrow">Google sign-in</p>
<h1>Account connected.</h1>
<p class="lead"><strong>${esc(r.email)}</strong> is now available to your AI agent under the alias <span class="alias">${alias}</span>.</p>
<section class="card" aria-label="Authorized services">
${r.services
  .map(
    (s) => `<div class="service${s.granted ? "" : " missing"}"><span class="logo"><img src="${SERVICE_LOGOS[s.logo]}" width="28" height="28" alt=""></span><div class="text"><b>${esc(s.name)}</b><span>${
      s.granted ? esc(s.detail) : "Permission left unchecked: run the command again and check every box."
    }</span></div><span class="status" role="img" aria-label="${s.granted ? "Authorized" : "Not authorized"}">${s.granted ? CHECK : CROSS}</span></div>`,
  )
  .join("\n")}
</section>
<section class="card next">
<h2>Add another account</h2>
<p>Each Google account has its own alias. It is usable right away in your agent, with no restart.</p>
<pre><span class="p">$ </span>npm run add-account -- work</pre>
</section>
<p class="close">You can close this tab <kbd>⌘ W</kbd></p>`
    : `<p class="eyebrow">Google sign-in</p>
<h1>Sign-in interrupted.</h1>
<p class="lead">The account <span class="alias">${alias}</span> was not added. ${esc(r.message)}</p>
<section class="card next">
<h2>Try again</h2>
<p>Run the command again from the terminal, then pick the right Google account and accept every permission.</p>
<pre><span class="p">$ </span>npm run add-account -- ${alias}</pre>
</section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>${r.ok ? "Account connected" : "Sign-in interrupted"} · Cockpit</title>
<style>${STYLE}:root{--accent:${accent}}</style></head>
<body>
<header class="wrap"><span class="wordmark">${MARK}<span>cockpit</span></span><span class="tag">plugin · google-multi</span></header>
<main class="wrap">
${body}
</main>
<footer class="wrap">Tokens stay on this computer, in <code>~/.config/google-multi-mcp</code>, readable only by you.
To revoke access at any time: <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</footer>
</body></html>`;
}
