#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { enabledAccounts } from "./accounts.js";
import { registerCalendarTools } from "./calendar.js";
import { registerDriveTools } from "./drive.js";
import { registerGmailTools } from "./gmail.js";
import { safe } from "./util.js";

const server = new McpServer(
  { name: "google-multi", version: "1.0.0" },
  {
    instructions:
      "Accès à plusieurs comptes Google (Gmail, Agenda, Drive). Chaque outil prend un paramètre account " +
      '(alias ou email). Pour les lectures, account="all" interroge tous les comptes. Pour envoyer un mail ' +
      "ou modifier un agenda, toujours utiliser un compte précis et confirmer l'expéditeur avec l'utilisateur.",
  },
);

server.registerTool(
  "list_accounts",
  {
    title: "Lister les comptes Google",
    description: "Liste les comptes Google connectés (alias et email).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe(async () => enabledAccounts().map((a) => ({ account: a.alias, email: a.email, addedAt: a.addedAt }))),
);

registerGmailTools(server);
registerCalendarTools(server);
registerDriveTools(server);

await server.connect(new StdioServerTransport());
// stdout est réservé au protocole MCP : les logs vont sur stderr.
console.error(`google-multi prêt, comptes : ${enabledAccounts().map((a) => a.alias).join(", ") || "aucun"}`);
