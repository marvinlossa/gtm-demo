import fs from "node:fs";
import path from "node:path";

/**
 * Self-heal n8n production webhook registration.
 * After ephemeral restarts, workflows can vanish — this re-imports and activates
 * `gtm-fit-analysis` from the repo export when the app can reach the n8n REST API.
 */

const WORKFLOW_NAME = "gtm-fit-analysis";

type EnsureResult =
  | { ok: true; action: "already_active" | "activated" | "imported_activated"; workflowId: string }
  | { ok: false; error: string };

function n8nBaseUrl() {
  return (
    process.env.N8N_BASE_URL?.replace(/\/$/, "") ||
    process.env.N8N_WEBHOOK_URL?.replace(/\/webhook\/.*$/, "") ||
    ""
  ).replace(/\/$/, "");
}

function basicAuthHeader() {
  const user = process.env.N8N_BASIC_AUTH_USER?.trim();
  const pass = process.env.N8N_BASIC_AUTH_PASSWORD?.trim();
  if (!user || !pass) return null;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function loadWorkflowExport(): {
  name: string;
  nodes: unknown[];
  connections: unknown;
  settings?: unknown;
} | null {
  const candidates = [
    path.join(process.cwd(), "n8n/workflows/gtm-fit-analysis.json"),
    path.join(process.cwd(), "data/n8n/gtm-fit-analysis.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        name?: string;
        nodes?: unknown[];
        connections?: unknown;
        settings?: unknown;
      };
      if (!raw.nodes || !raw.connections) continue;
      return {
        name: raw.name || WORKFLOW_NAME,
        nodes: raw.nodes,
        connections: raw.connections,
        settings: raw.settings || { executionOrder: "v1" },
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

class N8nApi {
  constructor(
    private base: string,
    private basic: string,
    private cookie = "",
  ) {}

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: this.basic,
    };
    if (json) h["Content-Type"] = "application/json";
    if (this.cookie) h.Cookie = this.cookie;
    return h;
  }

  private captureCookie(res: Response) {
    // Node fetch may expose set-cookie as getSetCookie()
    const anyRes = res as Response & { getSetCookie?: () => string[] };
    const parts =
      typeof anyRes.getSetCookie === "function"
        ? anyRes.getSetCookie()
        : res.headers.getSetCookie?.() ?? [];
    if (parts.length) {
      this.cookie = parts.map((c) => c.split(";")[0]).join("; ");
      return;
    }
    const single = res.headers.get("set-cookie");
    if (single) this.cookie = single.split(";")[0];
  }

  async request(method: string, pathName: string, body?: unknown) {
    const res = await fetch(`${this.base}${pathName}`, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    this.captureCookie(res);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { res, data, text };
  }

  async login() {
    const email = process.env.N8N_OWNER_EMAIL?.trim();
    const password = process.env.N8N_OWNER_PASSWORD?.trim();
    if (!email || !password) {
      return { ok: false as const, error: "N8N_OWNER_EMAIL/PASSWORD not set on app" };
    }
    const { res, data, text } = await this.request("POST", "/rest/login", {
      emailOrLdapLoginId: email,
      password,
    });
    if (!res.ok) {
      return {
        ok: false as const,
        error: `n8n login failed HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true as const, data };
  }

  async setupOwnerIfNeeded() {
    const { res, data } = await this.request("GET", "/rest/settings");
    if (!res.ok) return { ok: false as const, error: "settings failed" };
    const root = (data as { data?: { userManagement?: { showSetupOnFirstLoad?: boolean } } })
      ?.data;
    if (!root?.userManagement?.showSetupOnFirstLoad) {
      return { ok: true as const, setup: false };
    }
    const email = process.env.N8N_OWNER_EMAIL?.trim() || "contact@marvinlossa.com";
    const password =
      process.env.N8N_OWNER_PASSWORD?.trim() ||
      `GtmN8n!${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const setup = await this.request("POST", "/rest/owner/setup", {
      email,
      firstName: "Marvin",
      lastName: "Lossa",
      password,
    });
    if (!setup.res.ok) {
      return {
        ok: false as const,
        error: `owner setup failed HTTP ${setup.res.status}`,
      };
    }
    // Persist password is out of band (Railway vars); login with what we just set
    process.env.N8N_OWNER_EMAIL = email;
    process.env.N8N_OWNER_PASSWORD = password;
    return { ok: true as const, setup: true, password };
  }
}

function asList(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    const d = data as { data?: unknown; workflows?: unknown };
    if (Array.isArray(d.data)) return d.data as Array<Record<string, unknown>>;
    if (Array.isArray(d.workflows)) return d.workflows as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * Ensure production webhook for gtm-fit-analysis is registered.
 * Safe to call on trigger failure (404) or from a health endpoint.
 */
export async function ensureN8nWorkflow(): Promise<EnsureResult> {
  const base = n8nBaseUrl();
  const basic = basicAuthHeader();
  if (!base) return { ok: false, error: "N8N_BASE_URL not configured" };
  if (!basic) {
    return { ok: false, error: "N8N basic auth credentials not configured on app" };
  }

  const api = new N8nApi(base, basic);

  try {
    const setup = await api.setupOwnerIfNeeded();
    if (!setup.ok) return { ok: false, error: setup.error };

    const login = await api.login();
    if (!login.ok) return { ok: false, error: login.error };

    const listed = await api.request("GET", "/rest/workflows");
    if (!listed.res.ok) {
      return {
        ok: false,
        error: `list workflows failed HTTP ${listed.res.status}`,
      };
    }
    const workflows = asList(
      (listed.data as { data?: unknown })?.data ?? listed.data,
    );
    const existing = workflows.find((w) => w.name === WORKFLOW_NAME);

    if (existing?.id && existing.active) {
      return {
        ok: true,
        action: "already_active",
        workflowId: String(existing.id),
      };
    }

    if (existing?.id && !existing.active) {
      const versionId = existing.versionId as string | undefined;
      const act = await api.request(
        "POST",
        `/rest/workflows/${existing.id}/activate`,
        versionId ? { versionId } : {},
      );
      if (!act.res.ok) {
        // refresh and retry with versionId from GET
        const got = await api.request("GET", `/rest/workflows/${existing.id}`);
        const full = ((got.data as { data?: Record<string, unknown> })?.data ||
          got.data) as Record<string, unknown>;
        const act2 = await api.request(
          "POST",
          `/rest/workflows/${existing.id}/activate`,
          { versionId: full.versionId },
        );
        if (!act2.res.ok) {
          return {
            ok: false,
            error: `activate failed HTTP ${act2.res.status}: ${act2.text.slice(0, 200)}`,
          };
        }
      }
      return {
        ok: true,
        action: "activated",
        workflowId: String(existing.id),
      };
    }

    // Import from repo export
    const exportBody = loadWorkflowExport();
    if (!exportBody) {
      return {
        ok: false,
        error: "Workflow export JSON not found in deployment image",
      };
    }

    // Strip runtime-only fields from nodes
    const nodes = (exportBody.nodes as Array<Record<string, unknown>>).map(
      (n) => {
        const copy = { ...n };
        delete copy.webhookId;
        return copy;
      },
    );

    const created = await api.request("POST", "/rest/workflows", {
      name: exportBody.name || WORKFLOW_NAME,
      nodes,
      connections: exportBody.connections,
      settings: exportBody.settings || { executionOrder: "v1" },
    });
    if (!created.res.ok) {
      return {
        ok: false,
        error: `import failed HTTP ${created.res.status}: ${created.text.slice(0, 200)}`,
      };
    }
    const createdData = ((created.data as { data?: Record<string, unknown> })
      ?.data || created.data) as Record<string, unknown>;
    const workflowId = String(createdData.id);
    const versionId = createdData.versionId as string | undefined;

    const act = await api.request(
      "POST",
      `/rest/workflows/${workflowId}/activate`,
      versionId ? { versionId } : {},
    );
    if (!act.res.ok) {
      const got = await api.request("GET", `/rest/workflows/${workflowId}`);
      const full = ((got.data as { data?: Record<string, unknown> })?.data ||
        got.data) as Record<string, unknown>;
      const act2 = await api.request(
        "POST",
        `/rest/workflows/${workflowId}/activate`,
        { versionId: full.versionId },
      );
      if (!act2.res.ok) {
        return {
          ok: false,
          error: `activate after import failed HTTP ${act2.res.status}`,
        };
      }
    }

    return { ok: true, action: "imported_activated", workflowId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "ensure failed",
    };
  }
}

/** True if error text indicates missing production webhook registration. */
export function isWebhookNotRegisteredError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("not registered") ||
    (m.includes("webhook") && m.includes("404")) ||
    (m.includes("gtm-fit-analysis") && m.includes("404"))
  );
}
