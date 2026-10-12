#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { gmail as gmailApi } from "@googleapis/gmail";
import { oauth2 as oauth2Api } from "@googleapis/oauth2";
import { CodeChallengeMethod } from "google-auth-library";
import { assertAlias, getClient, listStoredAccounts, newOAuthClient, readAccount, removeAccount, saveAccount } from "./auth.js";
import { CONFIG_DIR, SCOPES } from "./config.js";
import { PAGE_CSP, renderCallbackPage, type CallbackResult, type ServiceStatus } from "./page.js";

const [command, alias] = process.argv.slice(2);

// In a container, Google must redirect to a port published on the host: the port is fixed
// and the server listens on every container interface (published on 127.0.0.1 on the host side).
const OAUTH_PORT = Number(process.env.GOOGLE_MULTI_MCP_OAUTH_PORT ?? 0);
const OAUTH_HOST = process.env.GOOGLE_MULTI_MCP_OAUTH_HOST ?? "127.0.0.1";
const NO_BROWSER = Boolean(process.env.GOOGLE_MULTI_MCP_NO_BROWSER);

function openBrowser(url: string) {
  if (NO_BROWSER) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
  // No browser available (container, remote server): the printed URL is enough.
  child.on("error", () => {});
  child.unref();
}

/** OAuth "loopback" flow with PKCE: Google redirects to a short-lived local HTTP server. */
async function addAccount(name: string | undefined) {
  assertAlias(name);
  if (readAccount(name)) console.log(`The account "${name}" already exists: it will be authorized again.`);

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(OAUTH_PORT, OAUTH_HOST, resolve);
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const client = newOAuthClient(redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(16).toString("hex");
  const url = client.generateAuthUrl({
    access_type: "offline",
    // consent: forces a refresh token to be issued; select_account: lets the user pick the right Google account.
    prompt: "consent select_account",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  console.log(`\nConnecting the account "${name}".${NO_BROWSER ? "" : " Opening the browser..."}`);
  console.log(`${NO_BROWSER ? "Open" : "If nothing opens, paste"} this URL in your browser:\n${url}\n`);
  openBrowser(url);

  // The HTTP response is held open: the page is only rendered once
  // the token exchange is done, so that it shows the real outcome.
  const { code, res } = await new Promise<{ code: string; res: http.ServerResponse }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out (5 minutes).")), 5 * 60_000);
    server.on("request", (req, res) => {
      const params = new URL(req.url ?? "/", redirectUri).searchParams;
      if (!params.has("code") && !params.has("error")) return void res.writeHead(404).end();
      clearTimeout(timer);
      const fail = (message: string) =>
        void sendPage(res, { ok: false, alias: name, message }).then(() => reject(new Error(message)));
      if (params.get("state") !== state) return fail("The callback request is not valid (state parameter).");
      const error = params.get("error");
      if (error) return fail(error === "access_denied" ? "Authorization was denied on the Google screen." : `Google returned the error ${error}.`);
      resolve({ code: params.get("code")!, res });
    });
  });

  try {
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token.");

    const granted = new Set((tokens.scope ?? "").split(" "));
    const services = SERVICES.map((s) => ({ ...s, granted: granted.has(s.scope) }));
    const missing = services.filter((s) => !s.granted).map((s) => s.name);
    if (missing.length) {
      console.warn(`\nWarning, permissions left unchecked: ${missing.join(", ")}\nThe matching tools will fail for this account.`);
    }

    client.setCredentials(tokens);
    const { data } = await oauth2Api({ version: "v2", auth: client }).userinfo.get();
    const email = data.email ?? "unknown";
    saveAccount({ alias: name, email, addedAt: new Date().toISOString(), credentials: tokens });
    await sendPage(res, { ok: true, alias: name, email, services });
    console.log(`\nOK: "${name}" -> ${email}. Available right away in your agent (no restart needed).`);
  } catch (err) {
    await sendPage(res, { ok: false, alias: name, message: (err as Error).message });
    throw err;
  } finally {
    server.close();
  }
}

const SERVICES: (Omit<ServiceStatus, "granted"> & { scope: string })[] = [
  { logo: "gmail", name: "Gmail", detail: "Read, search, label, draft and send", scope: "https://www.googleapis.com/auth/gmail.modify" },
  { logo: "calendar", name: "Google Calendar", detail: "View and manage events", scope: "https://www.googleapis.com/auth/calendar" },
  { logo: "drive", name: "Google Drive", detail: "Search and read files (read only)", scope: "https://www.googleapis.com/auth/drive.readonly" },
];

/** Sends the page and waits until it is flushed (the CLI may exit right after). */
function sendPage(res: http.ServerResponse, result: CallbackResult): Promise<void> {
  return new Promise((resolve) => {
    res.on("finish", resolve);
    res
    .writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": PAGE_CSP,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    })
    .end(renderCallbackPage(result));
  });
}

function list() {
  const accounts = listStoredAccounts();
  if (!accounts.length) return console.log("No account yet. Add one: npm run add-account -- perso");
  for (const a of accounts) console.log(`${a.alias.padEnd(16)} ${a.email.padEnd(36)} added on ${a.addedAt.slice(0, 10)}`);
  console.log(`\nStorage: ${CONFIG_DIR}`);
}

async function check() {
  for (const a of listStoredAccounts()) {
    try {
      const { data } = await gmailApi({ version: "v1", auth: getClient(a.alias) }).users.getProfile({ userId: "me" });
      console.log(`OK      ${a.alias.padEnd(16)} ${data.emailAddress} (${data.messagesTotal} messages)`);
    } catch (err) {
      console.log(`ERROR   ${a.alias.padEnd(16)} ${(err as Error).message}`);
    }
  }
}

try {
  switch (command) {
    case "add":
      await addAccount(alias);
      break;
    case "list":
      list();
      break;
    case "check":
      await check();
      break;
    case "remove":
      assertAlias(alias);
      console.log(removeAccount(alias) ? `Account "${alias}" removed locally.` : `Account "${alias}" not found.`);
      console.log("To also revoke access on the Google side: https://myaccount.google.com/permissions");
      break;
    default:
      console.log("Usage: npm run add-account -- <alias> | list-accounts | check-accounts | remove-account -- <alias>");
  }
} catch (err) {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
}
