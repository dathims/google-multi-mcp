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

// En conteneur, Google doit rediriger vers un port publié sur l'hôte : on fixe le port
// et on écoute sur toutes les interfaces du conteneur (publié en 127.0.0.1 côté hôte).
const OAUTH_PORT = Number(process.env.GOOGLE_MULTI_MCP_OAUTH_PORT ?? 0);
const OAUTH_HOST = process.env.GOOGLE_MULTI_MCP_OAUTH_HOST ?? "127.0.0.1";
const NO_BROWSER = Boolean(process.env.GOOGLE_MULTI_MCP_NO_BROWSER);

function openBrowser(url: string) {
  if (NO_BROWSER) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
  // Pas de navigateur disponible (conteneur, serveur distant) : l'URL affichée suffit.
  child.on("error", () => {});
  child.unref();
}

/** Flux OAuth "loopback" avec PKCE : Google redirige vers un mini serveur HTTP local éphémère. */
async function addAccount(name: string | undefined) {
  assertAlias(name);
  if (readAccount(name)) console.log(`Le compte "${name}" existe déjà : il va être ré-autorisé.`);

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
    // consent : force l'émission d'un refresh token ; select_account : choisir le bon compte Google.
    prompt: "consent select_account",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  console.log(`\nConnexion du compte "${name}".${NO_BROWSER ? "" : " Ouverture du navigateur..."}`);
  console.log(`${NO_BROWSER ? "Ouvre" : "Si rien ne s'ouvre, colle"} cette URL dans ton navigateur :\n${url}\n`);
  openBrowser(url);

  // On garde la réponse HTTP en attente : la page n'est rendue qu'une fois
  // l'échange de jetons terminé, pour afficher le vrai résultat.
  const { code, res } = await new Promise<{ code: string; res: http.ServerResponse }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Délai dépassé (5 minutes).")), 5 * 60_000);
    server.on("request", (req, res) => {
      const params = new URL(req.url ?? "/", redirectUri).searchParams;
      if (!params.has("code") && !params.has("error")) return void res.writeHead(404).end();
      clearTimeout(timer);
      const fail = (message: string) =>
        void sendPage(res, { ok: false, alias: name, message }).then(() => reject(new Error(message)));
      if (params.get("state") !== state) return fail("La requête de retour n'est pas valide (paramètre state).");
      const error = params.get("error");
      if (error) return fail(error === "access_denied" ? "L'autorisation a été refusée sur l'écran Google." : `Google a renvoyé l'erreur ${error}.`);
      resolve({ code: params.get("code")!, res });
    });
  });

  try {
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.refresh_token) throw new Error("Google n'a pas renvoyé de refresh token.");

    const granted = new Set((tokens.scope ?? "").split(" "));
    const services = SERVICES.map((s) => ({ ...s, granted: granted.has(s.scope) }));
    const missing = services.filter((s) => !s.granted).map((s) => s.name);
    if (missing.length) {
      console.warn(`\nAttention, autorisations non cochées : ${missing.join(", ")}\nLes outils correspondants échoueront pour ce compte.`);
    }

    client.setCredentials(tokens);
    const { data } = await oauth2Api({ version: "v2", auth: client }).userinfo.get();
    const email = data.email ?? "inconnu";
    saveAccount({ alias: name, email, addedAt: new Date().toISOString(), credentials: tokens });
    await sendPage(res, { ok: true, alias: name, email, services });
    console.log(`\nOK : "${name}" -> ${email}. Disponible immédiatement dans ton agent (pas besoin de redémarrer).`);
  } catch (err) {
    await sendPage(res, { ok: false, alias: name, message: (err as Error).message });
    throw err;
  } finally {
    server.close();
  }
}

const SERVICES: (Omit<ServiceStatus, "granted"> & { scope: string })[] = [
  { logo: "gmail", name: "Gmail", detail: "Lire, rechercher, classer, rédiger et envoyer", scope: "https://www.googleapis.com/auth/gmail.modify" },
  { logo: "calendar", name: "Google Agenda", detail: "Consulter et gérer les événements", scope: "https://www.googleapis.com/auth/calendar" },
  { logo: "drive", name: "Google Drive", detail: "Rechercher et lire les fichiers (lecture seule)", scope: "https://www.googleapis.com/auth/drive.readonly" },
];

/** Envoie la page et attend qu'elle soit transmise (la CLI peut quitter juste après). */
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
  if (!accounts.length) return console.log("Aucun compte. Ajoute-en un : npm run add-account -- perso");
  for (const a of accounts) console.log(`${a.alias.padEnd(16)} ${a.email.padEnd(36)} ajouté le ${a.addedAt.slice(0, 10)}`);
  console.log(`\nStockage : ${CONFIG_DIR}`);
}

async function check() {
  for (const a of listStoredAccounts()) {
    try {
      const { data } = await gmailApi({ version: "v1", auth: getClient(a.alias) }).users.getProfile({ userId: "me" });
      console.log(`OK      ${a.alias.padEnd(16)} ${data.emailAddress} (${data.messagesTotal} messages)`);
    } catch (err) {
      console.log(`ERREUR  ${a.alias.padEnd(16)} ${(err as Error).message}`);
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
      console.log(removeAccount(alias) ? `Compte "${alias}" supprimé localement.` : `Compte "${alias}" introuvable.`);
      console.log("Pour révoquer aussi l'accès côté Google : https://myaccount.google.com/permissions");
      break;
    default:
      console.log("Usage : npm run add-account -- <alias> | list-accounts | check-accounts | remove-account -- <alias>");
  }
} catch (err) {
  console.error(`\nErreur : ${(err as Error).message}`);
  process.exit(1);
}
