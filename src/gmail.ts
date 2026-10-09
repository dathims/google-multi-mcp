import { google, type gmail_v1 } from "googleapis";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "./auth.js";
import { accountParamDescription, enabledAccounts, resolveAccounts, runOnAccounts } from "./accounts.js";
import { rejectNewlines, safe, truncate } from "./util.js";

const gmail = (alias: string) => google.gmail({ version: "v1", auth: getClient(alias) });

type Headers = gmail_v1.Schema$MessagePartHeader[] | undefined;
const header = (headers: Headers, name: string) =>
  headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;

const decode = (data?: string | null) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined) {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: string[] = [];
  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    if (part.filename) {
      attachments.push(`${part.filename} (${part.mimeType}, ${part.body?.size ?? 0} o)`);
    } else if (part.mimeType === "text/plain") {
      plain.push(decode(part.body?.data));
    } else if (part.mimeType === "text/html") {
      html.push(decode(part.body?.data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return { text: plain.length ? plain.join("\n") : htmlToText(html.join("\n")), attachments };
}

function summarize(m: gmail_v1.Schema$Message) {
  const h = m.payload?.headers;
  return {
    id: m.id,
    threadId: m.threadId,
    date: header(h, "Date"),
    from: header(h, "From"),
    to: header(h, "To"),
    subject: header(h, "Subject"),
    snippet: m.snippet,
    unread: m.labelIds?.includes("UNREAD") ?? false,
  };
}

const encodeHeader = (v: string) =>
  /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;

interface Compose {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  reply_to_message_id?: string;
}

/** Construit le message RFC 2822 encodé en base64url attendu par l'API Gmail, avec gestion des réponses. */
async function buildMessage(alias: string, c: Compose): Promise<gmail_v1.Schema$Message> {
  let { to, subject } = c;
  let threadId: string | undefined;
  const extra: string[] = [];

  if (c.reply_to_message_id) {
    const { data } = await gmail(alias).users.messages.get({
      userId: "me",
      id: c.reply_to_message_id,
      format: "metadata",
      metadataHeaders: ["From", "Reply-To", "Subject", "Message-ID", "References"],
    });
    // Ces en-têtes viennent d'un mail reçu, donc d'un tiers : on les déplie
    // (suppression des CR/LF) avant de les recopier, pour bloquer toute injection.
    const h = data.payload?.headers;
    const original = (name: string) => header(h, name)?.replace(/[\r\n]+[ \t]*/g, " ").trim();
    const msgId = original("Message-ID");
    threadId = data.threadId ?? undefined;
    to ??= original("Reply-To") ?? original("From");
    const origSubject = original("Subject") ?? "";
    subject ??= /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
    if (msgId) {
      extra.push(`In-Reply-To: ${msgId}`, `References: ${[original("References"), msgId].filter(Boolean).join(" ")}`);
    }
  }

  if (!to) throw new Error("Destinataire manquant (to).");
  for (const [k, v] of Object.entries({ to, cc: c.cc, bcc: c.bcc, subject })) rejectNewlines(k, v);

  const lines = [
    `To: ${to}`,
    c.cc && `Cc: ${c.cc}`,
    c.bcc && `Bcc: ${c.bcc}`,
    `Subject: ${encodeHeader(subject ?? "")}`,
    ...extra,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((l): l is string => Boolean(l));
  // Dernier filet : aucune ligne d'en-tête ne doit pouvoir en créer une autre.
  if (lines.some((l) => /[\r\n]/.test(l))) throw new Error("En-tête de message invalide (retour à la ligne).");
  const body = Buffer.from(c.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const raw = Buffer.from(`${lines.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
  return { raw, threadId };
}

const composeShape = (accountDesc: string) => ({
  account: z.string().optional().describe(accountDesc),
  to: z.string().optional().describe("Destinataires séparés par des virgules. Facultatif en réponse (reprend l'expéditeur)."),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional().describe('Objet. Facultatif en réponse ("Re: ..." automatique).'),
  body: z.string().describe("Corps du message en texte brut."),
  reply_to_message_id: z.string().optional().describe("ID du message auquel répondre (garde le fil de discussion)."),
});

export function registerGmailTools(server: McpServer) {
  const readAccount = accountParamDescription(true);
  const writeAccount = accountParamDescription(false);

  server.registerTool(
    "gmail_search",
    {
      title: "Rechercher des emails",
      description:
        'Recherche des emails avec la syntaxe Gmail (ex. "from:alice is:unread newer_than:7d"). account="all" cherche dans toutes les boîtes.',
      inputSchema: {
        account: z.string().optional().describe(readAccount),
        query: z.string().default("in:inbox").describe("Requête Gmail."),
        max_results: z.number().int().min(1).max(50).default(10).describe("Par compte."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ account, query, max_results }) =>
      runOnAccounts(resolveAccounts(account, { allowAll: true }), async (alias) => {
        const g = gmail(alias);
        const { data } = await g.users.messages.list({ userId: "me", q: query, maxResults: max_results });
        const messages = await Promise.all(
          (data.messages ?? []).map((m) =>
            g.users.messages.get({
              userId: "me",
              id: m.id!,
              format: "metadata",
              metadataHeaders: ["From", "To", "Subject", "Date"],
            }),
          ),
        );
        return messages.map((r) => summarize(r.data));
      }),
    ),
  );

  server.registerTool(
    "gmail_read",
    {
      title: "Lire un email ou un fil",
      description: "Lit le contenu texte d'un message (message_id) ou de tout un fil de discussion (thread_id).",
      inputSchema: {
        account: z.string().optional().describe(writeAccount),
        message_id: z.string().optional(),
        thread_id: z.string().optional(),
        max_chars: z.number().int().min(500).max(200_000).default(30_000),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ account, message_id, thread_id, max_chars }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      const g = gmail(alias);
      if (!message_id && !thread_id) throw new Error("Fournis message_id ou thread_id.");
      const messages = thread_id
        ? ((await g.users.threads.get({ userId: "me", id: thread_id, format: "full" })).data.messages ?? [])
        : [(await g.users.messages.get({ userId: "me", id: message_id!, format: "full" })).data];
      const perMessage = Math.floor(max_chars / Math.max(messages.length, 1));
      return {
        account: alias,
        messages: messages.map((m) => {
          const { text, attachments } = extractBody(m.payload);
          return { ...summarize(m), cc: header(m.payload?.headers, "Cc"), body: truncate(text, perMessage), attachments };
        }),
      };
    }),
  );

  server.registerTool(
    "gmail_create_draft",
    {
      title: "Créer un brouillon",
      description: "Crée un brouillon dans le compte choisi (rien n'est envoyé). Préférer cet outil à gmail_send quand l'utilisateur veut relire.",
      inputSchema: composeShape(writeAccount),
    },
    safe(async ({ account, ...compose }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      const message = await buildMessage(alias, compose);
      const { data } = await gmail(alias).users.drafts.create({ userId: "me", requestBody: { message } });
      const email = enabledAccounts().find((a) => a.alias === alias)?.email;
      return { account: alias, draftId: data.id, link: `https://mail.google.com/mail/u/${email}/#drafts` };
    }),
  );

  server.registerTool(
    "gmail_send",
    {
      title: "Envoyer un email",
      description: "Envoie immédiatement un email depuis le compte choisi. Vérifier le compte expéditeur avec l'utilisateur avant d'appeler.",
      inputSchema: composeShape(writeAccount),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    safe(async ({ account, ...compose }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      const requestBody = await buildMessage(alias, compose);
      const { data } = await gmail(alias).users.messages.send({ userId: "me", requestBody });
      return { account: alias, sent: true, id: data.id, threadId: data.threadId };
    }),
  );

  server.registerTool(
    "gmail_modify_labels",
    {
      title: "Classer des emails",
      description:
        'Ajoute ou retire des libellés. Libellés système : INBOX (retirer = archiver), UNREAD (retirer = marquer lu), STARRED, IMPORTANT, SPAM, TRASH. Les libellés perso sont acceptés par leur nom.',
      inputSchema: {
        account: z.string().optional().describe(writeAccount),
        message_ids: z.array(z.string()).min(1).max(100),
        add: z.array(z.string()).default([]),
        remove: z.array(z.string()).default([]),
      },
    },
    safe(async ({ account, message_ids, add, remove }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      const g = gmail(alias);
      const labels = (await g.users.labels.list({ userId: "me" })).data.labels ?? [];
      const toId = (name: string) => {
        const l = labels.find((x) => x.id === name || x.name?.toLowerCase() === name.toLowerCase());
        if (!l?.id) throw new Error(`Libellé inconnu : ${name}`);
        return l.id;
      };
      await g.users.messages.batchModify({
        userId: "me",
        requestBody: { ids: message_ids, addLabelIds: add.map(toId), removeLabelIds: remove.map(toId) },
      });
      return { account: alias, modified: message_ids.length, added: add, removed: remove };
    }),
  );
}
