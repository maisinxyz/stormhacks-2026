// B1 configuration. Secrets come from env only (PRD B1.7).
const flag = (v: string | undefined) => v === '1' || v === 'true';

export interface B1Config {
  mockAgent: boolean;
  mockConnectors: boolean;
  modelProvider: 'anthropic' | 'gemini';
  /** When false, requests without a session cookie act as the shared demo user. */
  requireLogin: boolean;
  demoUserId: string;
  sessionSecret: string;
  tokenEncKey: string;          // base64, 32 bytes
  google: { clientId?: string; clientSecret?: string; redirectUri: string };
  webOrigin: string;            // where /auth/google/callback redirects back to
  composio: { apiKey?: string; callbackUrl: string };
  gemini: { apiKey?: string };
  agentModel: string;
  toolTimeoutMs: number;
  maxSteps: number;
  approvalTtlMs: number;
  runRateLimit: { max: number; windowMs: number };
}

const DEV_SECRET = 'fetch-dev-only-secret-change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): B1Config {
  return {
    mockAgent: flag(env.MOCK_AGENT),
    mockConnectors: flag(env.MOCK_CONNECTORS),
    modelProvider: env.MODEL_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini',
    requireLogin: flag(env.REQUIRE_LOGIN),
    demoUserId: env.DEMO_USER_ID ?? 'demo-user',
    sessionSecret: env.SESSION_SECRET ?? DEV_SECRET,
    tokenEncKey: env.TOKEN_ENC_KEY ?? '',
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8787/auth/google/callback',
    },
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    composio: {
      apiKey: env.COMPOSIO_API_KEY || undefined,
      // Where the browser lands after finishing an app's sign-in.
      callbackUrl: env.COMPOSIO_CALLBACK_URL ?? `${env.WEB_ORIGIN ?? 'http://localhost:5173'}/?connected=app`,
    },
    gemini: { apiKey: env.GEMINI_API_KEY || undefined },
    agentModel: env.AGENT_MODEL ?? (env.MODEL_PROVIDER === 'anthropic' ? 'claude-opus-5-5' : 'gemini-3.8-flash'),
    toolTimeoutMs: Number(env.TOOL_TIMEOUT_MS ?? 30_000),
    maxSteps: Number(env.AGENT_MAX_STEPS ?? 15),
    approvalTtlMs: Number(env.APPROVAL_TTL_MS ?? 10 * 60_000),
    runRateLimit: { max: Number(env.AGENT_RUN_RATE_MAX ?? 10), windowMs: 60_000 },
  };
}

export const isDevSecret = (c: B1Config) => c.sessionSecret === DEV_SECRET;
