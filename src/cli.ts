#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { google } from "googleapis";
import { CodeChallengeMethod } from "google-auth-library";
import { assertAlias, getClient, listStoredAccounts, newOAuthClient, readAccount, removeAccount, saveAccount } from "./auth.js";
import { CONFIG_DIR, SCOPES } from "./config.js";

const [command, alias] = process.argv.slice(2);

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}

/** Flux OAuth "loopback" avec PKCE : Google redirige vers un mini serveur HTTP local éphémère. */
async function addAccount(name: string | undefined) {
  assertAlias(name);
  if (readAccount(name)) console.log(`Le compte "${name}" existe déjà : il va être ré-autorisé.`);

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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

  console.log(`\nConnexion du compte "${name}". Ouverture du navigateur...`);
  console.log(`Si rien ne s'ouvre, colle cette URL dans ton navigateur :\n${url}\n`);
  openBrowser(url);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Délai dépassé (5 minutes).")), 5 * 60_000);
    server.on("request", (req, res) => {
      const params = new URL(req.url ?? "/", redirectUri).searchParams;
      const html = (msg: string) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<h2>${msg}</h2>`);
      if (!params.has("code") && !params.has("error")) return void res.writeHead(404).end();
      clearTimeout(timer);
      if (params.get("state") !== state) {
        html("Requête invalide (state).");
        return reject(new Error("Paramètre state invalide."));
      }
      const error = params.get("error");
      if (error) {
        html(`Autorisation refusée : ${error}`);
        return reject(new Error(`Autorisation refusée : ${error}`));
      }
      html(`Compte "${name}" connecté. Tu peux fermer cet onglet.`);
      resolve(params.get("code")!);
    });
  }).finally(() => server.close());

  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) throw new Error("Google n'a pas renvoyé de refresh token. Réessaie.");

  const granted = new Set((tokens.scope ?? "").split(" "));
  const missing = SCOPES.filter((s) => s.startsWith("https://") && !granted.has(s));
  if (missing.length) {
    console.warn(`\nAttention, autorisations non cochées : ${missing.join(", ")}\nLes outils correspondants échoueront pour ce compte.`);
  }

  client.setCredentials(tokens);
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  saveAccount({ alias: name, email: data.email ?? "inconnu", addedAt: new Date().toISOString(), credentials: tokens });
  console.log(`\nOK : "${name}" -> ${data.email}. Disponible immédiatement dans Claude (pas besoin de redémarrer).`);
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
      const { data } = await google.gmail({ version: "v1", auth: getClient(a.alias) }).users.getProfile({ userId: "me" });
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
