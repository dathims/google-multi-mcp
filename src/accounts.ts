import { listStoredAccounts, type StoredAccount } from "./auth.js";

// Permet de lancer plusieurs instances restreintes à certains comptes, ex. :
//   node dist/index.js --accounts=pro      ou   GOOGLE_MCP_ACCOUNTS=perso,asso
function accountFilter(): Set<string> | null {
  const arg = process.argv.find((a) => a.startsWith("--accounts="));
  const raw = arg?.slice("--accounts=".length) ?? process.env.GOOGLE_MCP_ACCOUNTS;
  if (!raw?.trim()) return null;
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Relu à chaque appel : un compte ajouté via la CLI est visible sans redémarrer Claude.
export function enabledAccounts(): StoredAccount[] {
  const filter = accountFilter();
  const all = listStoredAccounts();
  return filter ? all.filter((a) => filter.has(a.alias)) : all;
}

/**
 * Traduit le paramètre `account` d'un outil en liste d'alias à interroger.
 *
 * Choix de conception :
 * - paramètre omis + un seul compte : on l'utilise ;
 * - paramètre omis + plusieurs comptes : erreur explicite, pour que Claude
 *   n'envoie jamais un mail ou ne crée jamais un événement depuis le mauvais compte ;
 * - "all" n'est accepté que pour les lectures (recherche, agenda) ;
 * - on accepte l'alias ou l'adresse email complète.
 */
export function resolveAccounts(requested: string | undefined, opts: { allowAll: boolean }): string[] {
  const accounts = enabledAccounts();
  const aliases = accounts.map((a) => a.alias);
  const choices = `${aliases.join(", ")}${opts.allowAll ? ' ou "all"' : ""}`;

  if (accounts.length === 0) {
    throw new Error("Aucun compte Google configuré. Dans un terminal : npm run add-account -- <alias>");
  }
  if (!requested) {
    if (accounts.length === 1) return aliases;
    throw new Error(`Plusieurs comptes disponibles, précise le paramètre account : ${choices}.`);
  }
  if (requested === "all") {
    if (!opts.allowAll) throw new Error(`"all" est réservé aux lectures. Choisis un compte : ${aliases.join(", ")}.`);
    return aliases;
  }
  const wanted = requested.toLowerCase();
  const match = accounts.find((a) => a.alias === wanted || a.email.toLowerCase() === wanted);
  if (!match) throw new Error(`Compte "${requested}" inconnu. Comptes disponibles : ${choices}.`);
  return [match.alias];
}

export interface AccountResult<T> {
  account: string;
  email?: string;
  result?: T;
  error?: string;
}

/** Exécute `fn` sur chaque compte en parallèle ; un compte en erreur n'empêche pas les autres. */
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
  // Un seul compte demandé : on remonte l'erreur telle quelle plutôt qu'un tableau.
  if (aliases.length === 1 && results[0].error) throw new Error(`[${aliases[0]}] ${results[0].error}`);
  return results;
}

export function accountParamDescription(allowAll: boolean): string {
  const current = enabledAccounts().map((a) => `${a.alias} (${a.email})`).join(", ") || "aucun";
  return (
    `Alias du compte Google ou son adresse email.${allowAll ? ' "all" interroge tous les comptes.' : ""}` +
    ` Comptes au démarrage : ${current}. Appelle list_accounts pour la liste à jour.`
  );
}
