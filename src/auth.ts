import fs from "node:fs";
import path from "node:path";
import { google, type Auth } from "googleapis";
import { ACCOUNTS_DIR, CLIENT_FILE } from "./config.js";

export interface StoredAccount {
  alias: string;
  email: string;
  addedAt: string;
  credentials: Auth.Credentials;
}

const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function assertAlias(alias: string | undefined): asserts alias is string {
  if (!alias || !ALIAS_RE.test(alias)) {
    throw new Error(
      `Alias invalide "${alias ?? ""}" : utilise a-z, 0-9, "-" ou "_" (32 caractères max), ex. perso, pro, asso.`,
    );
  }
}

function loadClientInfo(): { client_id: string; client_secret: string } {
  if (!fs.existsSync(CLIENT_FILE)) {
    throw new Error(
      `Fichier OAuth introuvable : ${CLIENT_FILE}\nTélécharge le JSON du client OAuth "Application de bureau" depuis Google Cloud et place-le à cet endroit (voir README, étape 1).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_FILE, "utf8"));
  const info = raw.installed ?? raw.web;
  if (!info?.client_id || !info?.client_secret) {
    throw new Error(`${CLIENT_FILE} ne ressemble pas à un client OAuth Google (clé "installed" attendue).`);
  }
  return info;
}

export function newOAuthClient(redirectUri?: string): Auth.OAuth2Client {
  const { client_id, client_secret } = loadClientInfo();
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

function accountFile(alias: string): string {
  assertAlias(alias);
  return path.join(ACCOUNTS_DIR, `${alias}.json`);
}

export function saveAccount(account: StoredAccount): void {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  const file = accountFile(account.alias);
  // Écriture atomique : un crash pendant un rafraîchissement ne corrompt pas le fichier.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(account, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readAccount(alias: string): StoredAccount | null {
  const file = accountFile(alias);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as StoredAccount;
}

export function listStoredAccounts(): StoredAccount[] {
  if (!fs.existsSync(ACCOUNTS_DIR)) return [];
  return fs
    .readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), "utf8")) as StoredAccount);
}

export function removeAccount(alias: string): boolean {
  const file = accountFile(alias);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  clients.delete(alias);
  return true;
}

const clients = new Map<string, Auth.OAuth2Client>();

export function getClient(alias: string): Auth.OAuth2Client {
  const cached = clients.get(alias);
  if (cached) return cached;

  const account = readAccount(alias);
  if (!account) throw new Error(`Compte "${alias}" inconnu. Ajoute-le avec : npm run add-account -- ${alias}`);

  const client = newOAuthClient();
  client.setCredentials(account.credentials);
  // Google renvoie un nouvel access token toutes les heures ; on le persiste
  // sans perdre le refresh token (rarement renvoyé lors d'un rafraîchissement).
  client.on("tokens", (fresh) => {
    const current = readAccount(alias);
    if (!current) return;
    current.credentials = {
      ...current.credentials,
      ...fresh,
      refresh_token: fresh.refresh_token ?? current.credentials.refresh_token,
    };
    saveAccount(current);
  });
  clients.set(alias, client);
  return client;
}
