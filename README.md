# google-multi-mcp

Serveur MCP local qui donne à Claude l'accès à **plusieurs comptes Google** en même temps :
Gmail, Google Agenda et Google Drive. Les connecteurs intégrés de Claude ne gèrent qu'un compte
chacun ; ici, chaque outil prend un paramètre `account` (`perso`, `pro`, une adresse email, ou
`all` pour les lectures).

Les jetons restent sur ta machine dans `~/.config/google-multi-mcp/` (droits `600`), jamais dans ce dépôt.

## Outils exposés

| Outil | Rôle | `all` accepté |
|---|---|---|
| `list_accounts` | Comptes connectés | |
| `gmail_search` | Recherche (syntaxe Gmail) | oui |
| `gmail_read` | Lire un message ou un fil | |
| `gmail_create_draft` | Créer un brouillon (nouveau ou réponse) | |
| `gmail_send` | Envoyer (nouveau ou réponse) | |
| `gmail_modify_labels` | Archiver, marquer lu, étiqueter | |
| `calendar_list_calendars` | Lister les agendas | oui |
| `calendar_list_events` | Agenda sur une période (fusionné si `all`) | oui |
| `calendar_create_event` / `calendar_update_event` / `calendar_delete_event` | Gérer les événements | |
| `drive_search` | Recherche plein texte ou requête Drive | oui |
| `drive_read_file` | Lire Docs, Sheets (CSV), Slides, fichiers texte | |

## Installation

### 1. Créer le client OAuth Google (une seule fois, environ 10 minutes)

Un seul client OAuth sert pour tous tes comptes.

1. Ouvre <https://console.cloud.google.com/projectcreate> et crée un projet, par exemple `claude-google-multi`.
2. Active les trois API dans ce projet :
   - <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
   - <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
   - <https://console.cloud.google.com/apis/library/drive.googleapis.com>
3. Va dans **Google Auth Platform** (<https://console.cloud.google.com/auth/overview>) et configure l'écran de consentement :
   type d'audience **Externe**, nom de l'appli, ton email de contact.
4. Onglet **Audience** : clique sur **Publier l'application** (passage en *Production*).
   C'est important : en mode *Test*, Google fait expirer les autorisations **tous les 7 jours**.
   L'appli restera « non validée » : c'est sans conséquence pour un usage personnel (moins de 100 utilisateurs),
   tu verras simplement un avertissement à la connexion.
5. Onglet **Clients** : **Créer un client** > type **Application de bureau** > **Créer**, puis télécharge le JSON.
6. Range ce fichier :

```bash
mkdir -p ~/.config/google-multi-mcp && mv ~/Downloads/client_secret_*.json ~/.config/google-multi-mcp/client_secret.json && chmod 600 ~/.config/google-multi-mcp/client_secret.json
```

### 2. Compiler

```bash
cd ~/mcp-servers/google-multi && npm install && npm run build
```

### 3. Ajouter tes comptes

Une commande par compte. Le navigateur s'ouvre : choisis le bon compte Google, puis
« Paramètres avancés » > « Accéder à ... (non sécurisé) » et coche toutes les autorisations.

```bash
npm run add-account -- perso
```

```bash
npm run add-account -- pro
```

Autres commandes : `npm run list-accounts`, `npm run check-accounts`, `npm run remove-account -- <alias>`.
Un compte ajouté est visible immédiatement par Claude, sans redémarrage.

### 4. Brancher dans Claude

**Claude Desktop** (onglet Chat et Cowork), dans `~/Library/Application Support/Claude/claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "google-multi": {
      "command": "/chemin/vers/node",
      "args": ["/Users/<toi>/mcp-servers/google-multi/dist/index.js"]
    }
  }
}
```

Puis quitte et relance Claude Desktop.

**Claude Code** :

```bash
claude mcp add google-multi -s user -- node ~/mcp-servers/google-multi/dist/index.js
```

### Variante : un connecteur par compte

Pour activer ou couper chaque compte séparément dans l'interface de Claude, déclare plusieurs
entrées qui pointent vers le même serveur avec un filtre :

```json
"google-perso": { "command": "node", "args": [".../dist/index.js", "--accounts=perso"] },
"google-pro":   { "command": "node", "args": [".../dist/index.js", "--accounts=pro"] }
```

## Exemples de demandes à Claude

- « Résume mes mails non lus de cette semaine sur tous mes comptes. »
- « Montre mon agenda de demain, perso et pro fusionnés, et signale les conflits. »
- « Prépare un brouillon de réponse au dernier mail de Julie depuis mon compte pro. »
- « Cherche le devis "toiture" dans tous mes Drive et résume-le. »

## Dépannage

| Symptôme | Cause et solution |
|---|---|
| `invalid_grant` | Autorisation expirée ou révoquée. Relance `npm run add-account -- <alias>`. Si ça revient tous les 7 jours, l'appli est encore en mode Test (étape 1.4). |
| « Accès bloqué : cette appli n'est pas validée » sur un compte pro | L'administrateur Google Workspace bloque les applis tierces non validées. Demande-lui d'autoriser l'ID client, ou crée le projet Google Cloud dans l'organisation Workspace. |
| `Fichier OAuth introuvable` | Le fichier de l'étape 1.6 manque ou est mal placé. |
| Un outil échoue sur un seul compte | Une autorisation n'a pas été cochée lors de la connexion : ré-ajoute le compte. |

## Sécurité

- Jetons stockés localement, fichiers en `600`, dossier en `700`.
- Connexion OAuth avec PKCE et vérification du paramètre `state`.
- Drive en **lecture seule** ; Gmail sans suppression définitive (scope `gmail.modify`).
- Les écritures (envoi, agenda) exigent toujours un compte explicite : `all` est refusé.
- Révocation côté Google : <https://myaccount.google.com/permissions>.
