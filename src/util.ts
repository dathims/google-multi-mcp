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
      "\nThe token of this account has expired or been revoked. Run again: npm run add-account -- <alias>." +
      " If this happens every 7 days, switch the Google Cloud consent screen to Production mode (README).";
  }
  return { content: [{ type: "text", text: `Error: ${message}${hint}` }], isError: true };
}

/** Wraps a tool handler so that any exception becomes an isError result Claude can read. */
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
  return `${text.slice(0, max)}\n\n[... truncated: ${text.length - max} more characters]`;
}

export function rejectNewlines(field: string, value: string | undefined): void {
  // Prevents header injection in hand-built emails.
  if (value && /[\r\n]/.test(value)) throw new Error(`The ${field} field must not contain a line break.`);
}
