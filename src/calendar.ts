import { calendar as calendarApi, type calendar_v3 } from "@googleapis/calendar";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "./auth.js";
import { accountParamDescription, resolveAccounts, runOnAccounts } from "./accounts.js";
import { DEFAULT_TIME_ZONE } from "./config.js";
import { safe, truncate } from "./util.js";

const calendar = (alias: string) => calendarApi({ version: "v3", auth: getClient(alias) });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-12" = journée entière ; "2026-10-12T14:00:00" = heure locale dans time_zone. */
function eventTime(value: string, timeZone: string): calendar_v3.Schema$EventDateTime {
  return DATE_ONLY.test(value) ? { date: value } : { dateTime: value, timeZone };
}

function summarize(e: calendar_v3.Schema$Event) {
  return {
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    allDay: Boolean(e.start?.date),
    location: e.location,
    description: e.description ? truncate(e.description, 500) : undefined,
    organizer: e.organizer?.email,
    attendees: e.attendees?.map((a) => `${a.email} (${a.responseStatus})`),
    meet: e.hangoutLink,
    status: e.status,
    link: e.htmlLink,
  };
}

const eventFields = {
  summary: z.string().optional(),
  start: z.string().optional().describe('ISO 8601 : "2026-10-12T14:00:00" (heure locale) ou "2026-10-12" (journée entière).'),
  end: z.string().optional().describe("Même format que start. Pour une journée entière, end est exclusif (lendemain)."),
  time_zone: z.string().default(DEFAULT_TIME_ZONE).describe("Fuseau IANA, ex. Europe/Paris."),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional().describe("Emails des invités."),
  add_meet: z.boolean().optional().describe("Ajoute un lien Google Meet."),
  send_updates: z.enum(["all", "externalOnly", "none"]).default("none").describe("Envoyer les invitations aux invités."),
};

type EventInput = { [K in keyof typeof eventFields]?: z.infer<(typeof eventFields)[K]> };

function eventBody(i: EventInput): calendar_v3.Schema$Event {
  const tz = i.time_zone ?? DEFAULT_TIME_ZONE;
  return {
    summary: i.summary,
    description: i.description,
    location: i.location,
    start: i.start ? eventTime(i.start, tz) : undefined,
    end: i.end ? eventTime(i.end, tz) : undefined,
    attendees: i.attendees?.map((email) => ({ email })),
    conferenceData: i.add_meet
      ? { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
      : undefined,
  };
}

export function registerCalendarTools(server: McpServer) {
  const readAccount = accountParamDescription(true);
  const writeAccount = accountParamDescription(false);

  server.registerTool(
    "calendar_list_calendars",
    {
      title: "Lister les agendas",
      description: "Liste les agendas (perso, partagés, abonnements) d'un ou de tous les comptes.",
      inputSchema: { account: z.string().optional().describe(readAccount) },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ account }) =>
      runOnAccounts(resolveAccounts(account, { allowAll: true }), async (alias) => {
        const { data } = await calendar(alias).calendarList.list();
        return (data.items ?? []).map((c) => ({
          id: c.id,
          name: c.summaryOverride ?? c.summary,
          primary: c.primary ?? false,
          role: c.accessRole,
          timeZone: c.timeZone,
        }));
      }),
    ),
  );

  server.registerTool(
    "calendar_list_events",
    {
      title: "Lister les événements",
      description:
        'Liste les événements sur une période (7 prochains jours par défaut). account="all" fusionne les agendas de tous les comptes, triés par date : idéal pour voir les conflits.',
      inputSchema: {
        account: z.string().optional().describe(readAccount),
        calendar_id: z.string().default("primary"),
        time_min: z.string().optional().describe("ISO 8601 avec fuseau, ex. 2026-10-12T00:00:00+02:00. Défaut : maintenant."),
        time_max: z.string().optional().describe("Défaut : time_min + 7 jours."),
        query: z.string().optional().describe("Texte libre recherché dans les événements."),
        max_results: z.number().int().min(1).max(250).default(50).describe("Par compte."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ account, calendar_id, time_min, time_max, query, max_results }) => {
      const timeMin = time_min ?? new Date().toISOString();
      const timeMax = time_max ?? new Date(new Date(timeMin).getTime() + 7 * 86_400_000).toISOString();
      const aliases = resolveAccounts(account, { allowAll: true });
      const results = await runOnAccounts(aliases, async (alias) => {
        const { data } = await calendar(alias).events.list({
          calendarId: calendar_id,
          timeMin,
          timeMax,
          q: query,
          maxResults: max_results,
          singleEvents: true,
          orderBy: "startTime",
        });
        return (data.items ?? []).map(summarize);
      });
      if (aliases.length === 1) return { account: aliases[0], timeMin, timeMax, events: results[0].result };
      const merged = results
        .flatMap((r) => (r.result ?? []).map((e) => ({ account: r.account, ...e })))
        .sort((a, b) => new Date(a.start ?? 0).getTime() - new Date(b.start ?? 0).getTime());
      return { timeMin, timeMax, events: merged, errors: results.filter((r) => r.error) };
    }),
  );

  server.registerTool(
    "calendar_create_event",
    {
      title: "Créer un événement",
      description: "Crée un événement dans l'agenda du compte choisi.",
      inputSchema: {
        account: z.string().optional().describe(writeAccount),
        calendar_id: z.string().default("primary"),
        ...eventFields,
        summary: z.string(),
        start: eventFields.start.unwrap(),
        end: eventFields.end.unwrap(),
      },
    },
    safe(async ({ account, calendar_id, send_updates, ...input }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      const { data } = await calendar(alias).events.insert({
        calendarId: calendar_id,
        requestBody: eventBody(input),
        sendUpdates: send_updates,
        conferenceDataVersion: input.add_meet ? 1 : 0,
      });
      return { account: alias, created: summarize(data) };
    }),
  );

  server.registerTool(
    "calendar_update_event",
    {
      title: "Modifier un événement",
      description: "Modifie un événement existant : seuls les champs fournis changent.",
      inputSchema: {
        account: z.string().optional().describe(writeAccount),
        calendar_id: z.string().default("primary"),
        event_id: z.string(),
        ...eventFields,
      },
    },
    safe(async ({ account, calendar_id, event_id, send_updates, ...input }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      // Supprime les clés undefined pour qu'un patch ne vide pas les champs non fournis.
      const requestBody = JSON.parse(JSON.stringify(eventBody(input)));
      const { data } = await calendar(alias).events.patch({
        calendarId: calendar_id,
        eventId: event_id,
        requestBody,
        sendUpdates: send_updates,
        conferenceDataVersion: input.add_meet ? 1 : 0,
      });
      return { account: alias, updated: summarize(data) };
    }),
  );

  server.registerTool(
    "calendar_delete_event",
    {
      title: "Supprimer un événement",
      description: "Supprime (ou annule, si invités) un événement.",
      inputSchema: {
        account: z.string().optional().describe(writeAccount),
        calendar_id: z.string().default("primary"),
        event_id: z.string(),
        send_updates: eventFields.send_updates,
      },
      annotations: { destructiveHint: true },
    },
    safe(async ({ account, calendar_id, event_id, send_updates }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      await calendar(alias).events.delete({ calendarId: calendar_id, eventId: event_id, sendUpdates: send_updates });
      return { account: alias, deleted: event_id };
    }),
  );
}
