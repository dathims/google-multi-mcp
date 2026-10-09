import { google } from "googleapis";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "./auth.js";
import { accountParamDescription, resolveAccounts, runOnAccounts } from "./accounts.js";
import { safe, truncate } from "./util.js";

const drive = (alias: string) => google.drive({ version: "v3", auth: getClient(alias) });

// Formats Google natifs : on les exporte en texte pour que Claude puisse les lire.
const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|csv|x-sh|sql))/;
const MAX_DOWNLOAD = 5 * 1024 * 1024;

const escapeQuery = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function registerDriveTools(server: McpServer) {
  const readAccount = accountParamDescription(true);
  const oneAccount = accountParamDescription(false);

  server.registerTool(
    "drive_search",
    {
      title: "Rechercher dans Drive",
      description:
        'Recherche des fichiers Google Drive (y compris Drives partagés). Fournir query (texte libre, cherché dans le nom et le contenu) ou drive_query (syntaxe Drive brute, ex. "mimeType = \'application/vnd.google-apps.spreadsheet\' and modifiedTime > \'2026-09-01\'"). account="all" cherche partout.',
      inputSchema: {
        account: z.string().optional().describe(readAccount),
        query: z.string().optional(),
        drive_query: z.string().optional(),
        max_results: z.number().int().min(1).max(100).default(15).describe("Par compte."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ account, query, drive_query, max_results }) => {
      const q = [drive_query ?? (query ? `fullText contains '${escapeQuery(query)}'` : undefined), "trashed = false"]
        .filter(Boolean)
        .join(" and ");
      return runOnAccounts(resolveAccounts(account, { allowAll: true }), async (alias) => {
        const { data } = await drive(alias).files.list({
          q,
          pageSize: max_results,
          corpora: "allDrives",
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          // fullText ne supporte pas orderBy ; sinon on trie par date de modification.
          orderBy: query && !drive_query ? undefined : "modifiedTime desc",
          fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,owners(emailAddress))",
        });
        return (data.files ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modified: f.modifiedTime,
          owner: f.owners?.[0]?.emailAddress,
          link: f.webViewLink,
        }));
      });
    }),
  );

  server.registerTool(
    "drive_read_file",
    {
      title: "Lire un fichier Drive",
      description:
        "Lit le contenu texte d'un fichier : Google Docs/Slides en texte, Google Sheets en CSV (première feuille), fichiers texte tels quels. Pour les PDF et binaires, renvoie seulement les métadonnées et le lien.",
      inputSchema: {
        account: z.string().optional().describe(oneAccount),
        file_id: z.string(),
        max_chars: z.number().int().min(500).max(200_000).default(40_000),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ account, file_id, max_chars }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      const d = drive(alias);
      const { data: meta } = await d.files.get({
        fileId: file_id,
        supportsAllDrives: true,
        fields: "id,name,mimeType,size,modifiedTime,webViewLink",
      });
      const mime = meta.mimeType ?? "";
      const info = { account: alias, id: meta.id, name: meta.name, mimeType: mime, modified: meta.modifiedTime, link: meta.webViewLink };

      let content: string;
      if (EXPORTS[mime]) {
        const res = await d.files.export({ fileId: file_id, mimeType: EXPORTS[mime] }, { responseType: "text" });
        content = String(res.data);
      } else if (TEXT_MIME.test(mime)) {
        if (Number(meta.size ?? 0) > MAX_DOWNLOAD) return { ...info, note: "Fichier trop volumineux (> 5 Mo) pour être lu ici." };
        const res = await d.files.get({ fileId: file_id, alt: "media", supportsAllDrives: true }, { responseType: "text" });
        content = String(res.data);
      } else {
        return { ...info, note: "Format non textuel : ouvre le lien pour le consulter." };
      }
      return { ...info, content: truncate(content, max_chars) };
    }),
  );
}
