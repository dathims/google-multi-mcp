#!/usr/bin/env node
// Point d'entrée unique (utilisé par l'image Docker) :
//   (aucun argument) ou --accounts=...  -> serveur MCP sur stdio
//   add | list | check | remove [alias] -> CLI de gestion des comptes
const CLI_COMMANDS = new Set(["add", "list", "check", "remove"]);

if (CLI_COMMANDS.has(process.argv[2] ?? "")) {
  await import("./cli.js");
} else {
  await import("./index.js");
}
