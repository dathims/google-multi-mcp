import { calendar as calendarApi, type calendar_v3 } from "@googleapis/calendar";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "./auth.js";
import { accountParamDescription, resolveAccounts, runOnAccounts } from "./accounts.js";
import { DEFAULT_TIME_ZONE } from "./config.js";
import { safe, truncate } from "./util.js";

const calendar = (alias: string) => calendarApi({ version: "v3", auth: getClient(alias) });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-12" = all-day; "2026-10-12T14:00:00" = local time in time_zone. */
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
  start: z.string().optional().describe('ISO 8601: "2026-10-12T14:00:00" (local time) or "2026-10-12" (all-day).'),
  end: z.string().optional().describe("Same format as start. For an all-day event, end is exclusive (the next day)."),
  time_zone: z.string().default(DEFAULT_TIME_ZONE).describe("IANA time zone, e.g. Europe/Paris."),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional().describe("Emails of the guests."),
  add_meet: z.boolean().optional().describe("Adds a Google Meet link."),
  send_updates: z.enum(["all", "externalOnly", "none"]).default("none").describe("Send the invitations to the guests."),
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
      title: "List calendars",
      description: "Lists the calendars (own, shared, subscribed) of one or all accounts.",
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
      title: "List events",
      description:
        'Lists the events over a period (next 7 days by default). account="all" merges the calendars of every account, sorted by date: ideal to spot conflicts.',
      inputSchema: {
        account: z.string().optional().describe(readAccount),
        calendar_id: z.string().default("primary"),
        time_min: z.string().optional().describe("ISO 8601 with offset, e.g. 2026-10-12T00:00:00+02:00. Default: now."),
        time_max: z.string().optional().describe("Default: time_min + 7 days."),
        query: z.string().optional().describe("Free text searched in the events."),
        max_results: z.number().int().min(1).max(250).default(50).describe("Per account."),
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
      title: "Create an event",
      description: "Creates an event in the calendar of the chosen account.",
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
      title: "Update an event",
      description: "Updates an existing event: only the provided fields change.",
      inputSchema: {
        account: z.string().optional().describe(writeAccount),
        calendar_id: z.string().default("primary"),
        event_id: z.string(),
        ...eventFields,
      },
    },
    safe(async ({ account, calendar_id, event_id, send_updates, ...input }) => {
      const [alias] = resolveAccounts(account, { allowAll: false });
      // Drops the undefined keys so that a patch does not clear the fields left out.
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
      title: "Delete an event",
      description: "Deletes an event (or cancels it, if it has guests).",
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
