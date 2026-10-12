# google-multi-mcp

A local MCP server that gives Claude access to **several Google accounts** at the same time:
Gmail, Google Calendar and Google Drive. Claude's built-in connectors handle one account
each; here, every tool takes an `account` parameter (`perso`, `work`, an email address, or
`all` for reads).

Tokens stay on your machine in `~/.config/google-multi-mcp/` (mode `600`), never in this repository.

Project page: <https://plugin.usecockpit.co/google-multi/>

## Tools

| Tool | What it does | `all` accepted |
|---|---|---|
| `list_accounts` | Connected accounts | |
| `gmail_search` | Search (Gmail syntax) | yes |
| `gmail_read` | Read a message or a thread | |
| `gmail_create_draft` | Create a draft (new or reply) | |
| `gmail_send` | Send (new or reply) | |
| `gmail_modify_labels` | Archive, mark as read, label | |
| `calendar_list_calendars` | List calendars | yes |
| `calendar_list_events` | Agenda over a period (merged with `all`) | yes |
| `calendar_create_event` / `calendar_update_event` / `calendar_delete_event` | Manage events | |
| `drive_search` | Full text search or Drive query | yes |
| `drive_read_file` | Read Docs, Sheets (CSV), Slides, text files | |

## Installation

### 1. Create the Google OAuth client (once, about 10 minutes)

A single OAuth client serves all your accounts.

1. Open <https://console.cloud.google.com/projectcreate> and create a project, for example `claude-google-multi`.
2. Enable the three APIs in this project:
   - <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
   - <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
   - <https://console.cloud.google.com/apis/library/drive.googleapis.com>
3. Go to **Google Auth Platform** (<https://console.cloud.google.com/auth/overview>) and configure the consent screen:
   audience type **External**, the app name, your contact email.
4. **Audience** tab: click **Publish app** (this switches it to *In production*).
   This matters: in *Testing* mode, Google makes the authorizations expire **every 7 days**.
   The app stays "unverified": this has no consequence for personal use (fewer than 100 users),
   you simply see a warning when you sign in.
5. **Clients** tab: **Create client** > type **Desktop app** > **Create**, then download the JSON.
6. Put this file in place:

```bash
mkdir -p ~/.config/google-multi-mcp && mv ~/Downloads/client_secret_*.json ~/.config/google-multi-mcp/client_secret.json && chmod 600 ~/.config/google-multi-mcp/client_secret.json
```

### 2. Get the code and build it

```bash
git clone https://github.com/dathims/google-multi-mcp.git && cd google-multi-mcp && npm install && npm run build
```

### 3. Add your accounts

One command per account. The browser opens: pick the right Google account, then
"Advanced" > "Go to ... (unsafe)" and check every permission.

```bash
npm run add-account -- perso
```

```bash
npm run add-account -- work
```

Other commands: `npm run list-accounts`, `npm run check-accounts`, `npm run remove-account -- <alias>`.
An account you add is visible to Claude right away, with no restart.

### 4. Connect it to Claude

**Claude Desktop** (Chat and Cowork tabs), in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-multi": {
      "command": "/path/to/node",
      "args": ["/path/to/google-multi-mcp/dist/index.js"]
    }
  }
}
```

Then quit and restart Claude Desktop.

**Claude Code**:

```bash
claude mcp add google-multi -s user -- node /path/to/google-multi-mcp/dist/index.js
```

### Variant: one connector per account

To turn each account on or off separately in Claude's interface, declare several
entries that point to the same server with a filter:

```json
"google-perso": { "command": "node", "args": [".../dist/index.js", "--accounts=perso"] },
"google-work":  { "command": "node", "args": [".../dist/index.js", "--accounts=work"] }
```

## With Docker

A ready-made image is published for amd64 and arm64: `ghcr.io/dathims/google-multi-mcp`.
No need for Node.js or for cloning the repository. Only step 1 (the Google OAuth client) is still required.

**Add an account.** The browser cannot open from the container: copy the URL it prints.
Port 8765 is published on `127.0.0.1` only, to receive Google's response.

```bash
docker run -it --rm -p 127.0.0.1:8765:8765 -v ~/.config/google-multi-mcp:/config ghcr.io/dathims/google-multi-mcp add perso
```

Other commands: `list`, `check`, `remove <alias>` in place of `add perso`.

**Connect the agent.** Same format for Claude Desktop, Cursor and Gemini CLI. Replace the path with yours
and `TZ` with your time zone: without it, the container runs in UTC and event times would shift.

```json
{
  "mcpServers": {
    "google-multi": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "TZ=Europe/Paris",
               "-v", "/Users/<you>/.config/google-multi-mcp:/config",
               "ghcr.io/dathims/google-multi-mcp"]
    }
  }
}
```

On Linux, add `"--user", "<uid>:<gid>"` (the values of `id -u` and `id -g`) so the container can read the files in mode `600`. Not needed on macOS with Docker Desktop.

## Examples of what to ask Claude

- "Summarize my unread mail from this week on all my accounts."
- "Show my agenda for tomorrow, perso and work merged, and flag the conflicts."
- "Prepare a draft reply to Julie's last email from my work account."
- "Find the "roof" quote in all my Drives and summarize it."

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `invalid_grant` | Authorization expired or revoked. Run `npm run add-account -- <alias>` again. If it comes back every 7 days, the app is still in Testing mode (step 1.4). |
| "Access blocked" on a work account | The Google Workspace administrator blocks unverified third-party apps. Ask them to allow the client ID, or create the Google Cloud project inside the Workspace organization. |
| `OAuth client file not found` | The file from step 1.6 is missing or in the wrong place. |
| A tool fails on a single account | A permission was left unchecked during sign-in: add the account again. |

## Security

- Tokens stored locally, files in mode `600`, folder in mode `700`.
- OAuth sign-in with PKCE and a check of the `state` parameter.
- Drive is **read only**; Gmail has no permanent deletion (`gmail.modify` scope).
- Writes (sending, calendar) always require an explicit account: `all` is refused.
- Revocation on the Google side: <https://myaccount.google.com/permissions>.

## License

[MIT](LICENSE), © 2026 OXYGENE NUMERIQUE. Google, Gmail, Google Calendar and Google Drive are trademarks of Google LLC; Claude is a trademark of Anthropic PBC. This independent project is not affiliated with or endorsed by Google or Anthropic.

Privacy: <https://plugin.usecockpit.co/privacy/>
