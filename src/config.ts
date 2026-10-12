import os from "node:os";
import path from "node:path";

// OAuth credentials and account tokens live outside the repository,
// in a folder only the user can read.
export const CONFIG_DIR =
  process.env.GOOGLE_MULTI_MCP_DIR ?? path.join(os.homedir(), ".config", "google-multi-mcp");

export const CLIENT_FILE = path.join(CONFIG_DIR, "client_secret.json");
export const ACCOUNTS_DIR = path.join(CONFIG_DIR, "accounts");

export const SCOPES = [
  "openid",
  "email",
  // Read, label, draft and send (no permanent deletion).
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
];

export const DEFAULT_TIME_ZONE =
  process.env.GOOGLE_MULTI_MCP_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
