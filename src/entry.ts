#!/usr/bin/env node
// Single entry point (used by the Docker image):
//   (no argument) or --accounts=...     -> MCP server on stdio
//   add | list | check | remove [alias] -> account management CLI
const CLI_COMMANDS = new Set(["add", "list", "check", "remove"]);

if (CLI_COMMANDS.has(process.argv[2] ?? "")) {
  await import("./cli.js");
} else {
  await import("./index.js");
}
