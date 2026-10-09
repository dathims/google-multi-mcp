import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

export function fail(err: unknown): CallToolResult {
  const anyErr = err as { message?: string; response?: { data?: { error?: { message?: string } } } };
  const message = anyErr?.response?.data?.error?.message ?? anyErr?.message ?? String(err);
  let hint = "";
  if (/invalid_grant/i.test(message)) {
    hint =
      "\nLe jeton de ce compte est expiré ou révoqué. Relance : npm run add-account -- <alias>." +
      " Si cela arrive tous les 7 jours, passe l'écran de consentement Google Cloud en mode Production (README).";
  }
  return { content: [{ type: "text", text: `Erreur : ${message}${hint}` }], isError: true };
}

/** Enveloppe un handler d'outil pour transformer toute exception en résultat isError lisible par Claude. */
export function safe<A>(handler: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await handler(args));
    } catch (err) {
      return fail(err);
    }
  };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... tronqué : ${text.length - max} caractères supplémentaires]`;
}

export function rejectNewlines(field: string, value: string | undefined): void {
  // Empêche l'injection d'en-têtes dans les mails construits à la main.
  if (value && /[\r\n]/.test(value)) throw new Error(`Le champ ${field} ne doit pas contenir de retour à la ligne.`);
}
