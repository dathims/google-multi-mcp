import { listStoredAccounts, type StoredAccount } from "./auth.js";

// Lets several instances run, each restricted to some accounts, e.g.:
//   node dist/index.js --accounts=work     or   GOOGLE_MCP_ACCOUNTS=perso,club
function accountFilter(): Set<string> | null {
  const arg = process.argv.find((a) => a.startsWith("--accounts="));
  const raw = arg?.slice("--accounts=".length) ?? process.env.GOOGLE_MCP_ACCOUNTS;
  if (!raw?.trim()) return null;
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Read again on every call: an account added through the CLI shows up without restarting Claude.
export function enabledAccounts(): StoredAccount[] {
  const filter = accountFilter();
  const all = listStoredAccounts();
  return filter ? all.filter((a) => filter.has(a.alias)) : all;
}

/**
 * Turns the `account` parameter of a tool into the list of aliases to query.
 *
 * Design choices:
 * - parameter omitted + a single account: use it;
 * - parameter omitted + several accounts: explicit error, so that Claude never
 *   sends an email or creates an event from the wrong account;
 * - "all" is only accepted for reads (search, agenda);
 * - the alias and the full email address are both accepted.
 */
export function resolveAccounts(requested: string | undefined, opts: { allowAll: boolean }): string[] {
  const accounts = enabledAccounts();
  const aliases = accounts.map((a) => a.alias);
  const choices = `${aliases.join(", ")}${opts.allowAll ? ' or "all"' : ""}`;

  if (accounts.length === 0) {
    throw new Error("No Google account configured. In a terminal: npm run add-account -- <alias>");
  }
  if (!requested) {
    if (accounts.length === 1) return aliases;
    throw new Error(`Several accounts available, set the account parameter: ${choices}.`);
  }
  if (requested === "all") {
    if (!opts.allowAll) throw new Error(`"all" is reserved for reads. Pick an account: ${aliases.join(", ")}.`);
    return aliases;
  }
  const wanted = requested.toLowerCase();
  const match = accounts.find((a) => a.alias === wanted || a.email.toLowerCase() === wanted);
  if (!match) throw new Error(`Unknown account "${requested}". Available accounts: ${choices}.`);
  return [match.alias];
}

export interface AccountResult<T> {
  account: string;
  email?: string;
  result?: T;
  error?: string;
}

/** Runs `fn` on every account in parallel; a failing account does not block the others. */
export async function runOnAccounts<T>(aliases: string[], fn: (alias: string) => Promise<T>): Promise<AccountResult<T>[]> {
  const emails = new Map(enabledAccounts().map((a) => [a.alias, a.email]));
  const settled = await Promise.allSettled(aliases.map(fn));
  const results = settled.map((s, i) => {
    const account = aliases[i];
    const email = emails.get(account);
    return s.status === "fulfilled"
      ? { account, email, result: s.value }
      : { account, email, error: s.reason instanceof Error ? s.reason.message : String(s.reason) };
  });
  // A single account requested: surface the error as is rather than an array.
  if (aliases.length === 1 && results[0].error) throw new Error(`[${aliases[0]}] ${results[0].error}`);
  return results;
}

export function accountParamDescription(allowAll: boolean): string {
  const current = enabledAccounts().map((a) => `${a.alias} (${a.email})`).join(", ") || "none";
  return (
    `Alias of the Google account, or its email address.${allowAll ? ' "all" queries every account.' : ""}` +
    ` Accounts at startup: ${current}. Call list_accounts for the current list.`
  );
}
