#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { enabledAccounts } from "./accounts.js";
import { registerCalendarTools } from "./calendar.js";
import { registerDriveTools } from "./drive.js";
import { registerGmailTools } from "./gmail.js";
import { SERVER_ICON } from "./logos.js";
import { safe } from "./util.js";

const server = new McpServer(
  { name: "google-multi", version: "1.0.0", icons: [{ src: SERVER_ICON, mimeType: "image/png", sizes: ["96x96"] }] },
  {
    instructions:
      "Access to several Google accounts (Gmail, Calendar, Drive). Every tool takes an account parameter " +
      '(alias or email). For reads, account="all" queries every account. To send an email ' +
      "or change a calendar, always use one specific account and confirm the sender with the user.",
  },
);

server.registerTool(
  "list_accounts",
  {
    title: "List Google accounts",
    description: "Lists the connected Google accounts (alias and email).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe(async () => enabledAccounts().map((a) => ({ account: a.alias, email: a.email, addedAt: a.addedAt }))),
);

registerGmailTools(server);
registerCalendarTools(server);
registerDriveTools(server);

await server.connect(new StdioServerTransport());
// stdout is reserved for the MCP protocol: logs go to stderr.
console.error(`google-multi ready, accounts: ${enabledAccounts().map((a) => a.alias).join(", ") || "none"}`);
