// Composio gateway: lets the agent use any app Composio supports, connecting accounts on demand.
// The runner and tools only see this interface, so tests can substitute a fake.
import { Composio } from '@composio/core';
import { ConnectorError } from './types';

export interface ComposioToolInfo {
  slug: string; name: string; description: string;
  toolkit: string;          // e.g. "slack"
  toolkitName: string;      // e.g. "Slack"
  tags: string[];           // readOnlyHint, destructiveHint, ...
}

export interface ComposioSearchResult {
  results: { useCase: string; primaryToolSlugs: string[]; relatedToolSlugs: string[]; toolkits: string[]; executionGuidance?: string; knownPitfalls?: string[] }[];
  toolSchemas: Record<string, unknown>;
  connected: Record<string, boolean>;
}

export interface ConnectionRequest {
  redirectUrl: string;
  /** Resolves once the account is ACTIVE; rejects on timeout, failure, or abort. */
  wait(timeoutMs: number, signal?: AbortSignal): Promise<void>;
}

export interface ComposioGateway {
  search(userId: string, query: string, toolkits?: string[]): Promise<ComposioSearchResult>;
  toolInfo(slug: string): Promise<ComposioToolInfo>;
  isConnected(userId: string, toolkit: string): Promise<boolean>;
  connectedToolkits(userId: string): Promise<string[]>;
  authorize(userId: string, toolkit: string): Promise<ConnectionRequest>;
  execute(userId: string, slug: string, args: Record<string, unknown>): Promise<{ successful: boolean; data: unknown; error: string | null }>;
  disconnect(userId: string, toolkit: string): Promise<void>;
}

const POLL_MS = 2000;

const KNOWN_NAMES: Record<string, string> = {
  gmail: 'Gmail', googledrive: 'Google Drive', googlecalendar: 'Google Calendar', googlesheets: 'Google Sheets',
  googledocs: 'Google Docs', github: 'GitHub', hubspot: 'HubSpot', linkedin: 'LinkedIn', youtube: 'YouTube', clickup: 'ClickUp',
};
/** Composio often returns the slug as the name ("googledrive"); make it readable for cards and speech. */
export function displayName(slug: string, name?: string) {
  if (name && name.toLowerCase() !== slug.toLowerCase()) return name;
  return KNOWN_NAMES[slug.toLowerCase()] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Composio errors that are worth retrying for read-only calls. */
function wrap(err: unknown): never {
  if (err instanceof ConnectorError) throw err;
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  const retryable = status === undefined || status === 429 || status >= 500;
  throw new ConnectorError(retryable ? 'upstream_unavailable' : 'upstream_error', (err as Error)?.message ?? 'Composio error', retryable);
}

export function composioGateway(opts: { apiKey: string; callbackUrl: string }): ComposioGateway {
  const composio = new Composio({ apiKey: opts.apiKey });
  type Session = Awaited<ReturnType<typeof composio.create>>;
  const sessions = new Map<string, Promise<Session>>();
  const infos = new Map<string, Promise<ComposioToolInfo>>();

  // One Composio session per user; connections persist across sessions on Composio's side.
  const session = (userId: string) => {
    let s = sessions.get(userId);
    if (!s) {
      s = composio.create(userId);
      s.catch(() => sessions.delete(userId));
      sessions.set(userId, s);
    }
    return s;
  };
  const toolkitStatus = async (userId: string, toolkits?: string[]) => {
    const res = await (await session(userId)).toolkits({ ...(toolkits && { toolkits }), isConnected: toolkits ? undefined : true });
    return Object.fromEntries(res.items.map(i => [i.slug, Boolean(i.connection?.isActive) || i.isNoAuth]));
  };

  return {
    async search(userId, query, toolkits) {
      try {
        const s = await session(userId);
        const res = await s.search({ query, ...(toolkits?.length && { toolkits }) });
        if (!res.success) throw new ConnectorError('search_failed', res.error ?? 'Tool search failed');
        const found = [...new Set(res.results.flatMap(r => r.toolkits))];
        return {
          results: res.results.map(r => ({
            useCase: r.useCase, primaryToolSlugs: r.primaryToolSlugs, relatedToolSlugs: r.relatedToolSlugs, toolkits: r.toolkits,
            executionGuidance: r.executionGuidance, knownPitfalls: r.knownPitfalls,
          })),
          toolSchemas: res.toolSchemas,
          connected: found.length ? await toolkitStatus(userId, found) : {},
        };
      } catch (err) { wrap(err); }
    },

    toolInfo(slug) {
      let p = infos.get(slug);
      if (!p) {
        p = composio.tools.getRawComposioToolBySlug(slug).then(t => {
          const toolkit = t.toolkit?.slug ?? slug.split('_')[0].toLowerCase();
          return {
            slug: t.slug, name: t.name, description: t.description ?? '',
            toolkit, toolkitName: displayName(toolkit, t.toolkit?.name), tags: t.tags ?? [],
          };
        });
        p.catch(() => infos.delete(slug));
        infos.set(slug, p);
      }
      return p.catch(err => {
        if ((err as { status?: number }).status === 404) throw new ConnectorError('unknown_tool', `No Composio tool named ${slug}. Use apps_search to find tool slugs.`);
        return wrap(err);
      });
    },

    async isConnected(userId, toolkit) {
      try { return Boolean((await toolkitStatus(userId, [toolkit]))[toolkit]); } catch (err) { wrap(err); }
    },

    async connectedToolkits(userId) {
      try { return Object.entries(await toolkitStatus(userId)).filter(([, on]) => on).map(([slug]) => slug); } catch (err) { wrap(err); }
    },

    async authorize(userId, toolkit) {
      try {
        const req = await (await session(userId)).authorize(toolkit, { callbackUrl: opts.callbackUrl });
        if (!req.redirectUrl) throw new ConnectorError('connect_failed', `Composio returned no sign-in link for ${toolkit}`);
        // Own poll instead of req.waitForConnection(), which can't be cancelled: an abandoned
        // connect card must stop polling Composio as soon as the run moves on.
        const wait = async (ms: number, signal?: AbortSignal) => {
          const deadline = Date.now() + ms;
          while (!signal?.aborted && Date.now() < deadline) {
            if (await toolkitStatus(userId, [toolkit]).then(s => s[toolkit], () => false)) return;
            await new Promise(r => setTimeout(r, POLL_MS));
          }
          throw new ConnectorError(signal?.aborted ? 'aborted' : 'connect_timeout', `Not connected to ${toolkit}`);
        };
        return { redirectUrl: req.redirectUrl, wait };
      } catch (err) { wrap(err); }
    },

    async execute(userId, slug, args) {
      try {
        const res = await (await session(userId)).execute(slug, args);
        return { successful: !res.error, data: res.data, error: res.error };
      } catch (err) { wrap(err); }
    },

    async disconnect(userId, toolkit) {
      try {
        const list = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: [toolkit] });
        await Promise.all(list.items.map(a => composio.connectedAccounts.delete(a.id)));
      } catch (err) { wrap(err); }
    },
  };
}
