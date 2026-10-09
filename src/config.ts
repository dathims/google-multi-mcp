import os from "node:os";
import path from "node:path";

// Les identifiants OAuth et les jetons des comptes vivent hors du dépôt,
// dans un dossier lisible uniquement par l'utilisateur.
export const CONFIG_DIR =
  process.env.GOOGLE_MULTI_MCP_DIR ?? path.join(os.homedir(), ".config", "google-multi-mcp");

export const CLIENT_FILE = path.join(CONFIG_DIR, "client_secret.json");
export const ACCOUNTS_DIR = path.join(CONFIG_DIR, "accounts");

export const SCOPES = [
  "openid",
  "email",
  // Lire, classer, créer des brouillons et envoyer (pas de suppression définitive).
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
];

export const DEFAULT_TIME_ZONE =
  process.env.GOOGLE_MULTI_MCP_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
