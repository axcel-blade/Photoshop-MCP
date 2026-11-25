import { PsMcpError, type CapabilityStatus } from "../shared.js";

/**
 * Extensible AI provider layer. Providers only run when explicitly configured with credentials
 * (environment variables). Nothing here is called implicitly, and keys are never logged or returned.
 */
export type AiCapability = "generate_image" | "generative_fill" | "generative_expand" | "remove_background";

export interface GeneratedImage {
  /** Raw image bytes (PNG/JPEG). */
  bytes: Uint8Array;
  mimeType: string;
  provider: string;
  seed?: number;
}

export interface GenerateRequest { prompt: string; width: number; height: number; negativePrompt?: string; count?: number }
export interface FillRequest { image: Uint8Array; mask: Uint8Array; prompt?: string; width: number; height: number }
export interface ExpandRequest { image: Uint8Array; width: number; height: number; prompt?: string }

export interface AiProvider {
  readonly id: string;
  readonly capabilities: readonly AiCapability[];
  configured(): boolean;
  generate?(req: GenerateRequest): Promise<GeneratedImage[]>;
  fill?(req: FillRequest): Promise<GeneratedImage[]>;
  expand?(req: ExpandRequest): Promise<GeneratedImage[]>;
  removeBackground?(image: Uint8Array, mimeType: string): Promise<GeneratedImage>;
}

type Fetch = typeof fetch;

async function check(res: Response, provider: string): Promise<Response> {
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 400);
    throw new PsMcpError("PROVIDER_ERROR", `${provider} returned HTTP ${res.status}`, { body: text });
  }
  return res;
}

/**
 * Adobe Firefly Services (server-to-server OAuth, https://developer.adobe.com/firefly-services/docs/).
 * Requires an Adobe Developer Console project with Firefly API access: FIREFLY_CLIENT_ID / FIREFLY_CLIENT_SECRET.
 * Uses: IMS client_credentials token, POST /v2/storage/image (upload), POST /v3/images/generate|fill|expand.
 */
export class FireflyProvider implements AiProvider {
  readonly id = "firefly";
  readonly capabilities = ["generate_image", "generative_fill", "generative_expand"] as const;
  private token?: { value: string; expires: number };

  constructor(
    private readonly env: { clientId?: string; clientSecret?: string },
    private readonly http: Fetch = fetch,
    private readonly base = "https://firefly-api.adobe.io",
  ) {}

  configured(): boolean {
    return Boolean(this.env.clientId && this.env.clientSecret);
  }

  private async auth(): Promise<string> {
    if (!this.configured()) throw new PsMcpError("PROVIDER_NOT_CONFIGURED", "Set FIREFLY_CLIENT_ID and FIREFLY_CLIENT_SECRET to use Adobe Firefly Services.");
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials", client_id: this.env.clientId!, client_secret: this.env.clientSecret!,
      scope: "openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis",
    });
    const res = await check(await this.http("https://ims-na1.adobelogin.com/ims/token/v3", { method: "POST", body }), "Adobe IMS");
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.auth()}`, "x-api-key": this.env.clientId!, "Content-Type": "application/json" };
  }

  private async upload(bytes: Uint8Array, mime = "image/png"): Promise<string> {
    const h = await this.headers();
    const res = await check(await this.http(`${this.base}/v2/storage/image`, { method: "POST", headers: { ...h, "Content-Type": mime }, body: bytes }), "Firefly upload");
    const json = (await res.json()) as { images: { id: string }[] };
    const id = json.images?.[0]?.id;
    if (!id) throw new PsMcpError("PROVIDER_ERROR", "Firefly upload returned no image id");
    return id;
  }

  private async download(outputs: { image: { url: string }; seed?: number }[]): Promise<GeneratedImage[]> {
    const out: GeneratedImage[] = [];
    for (const o of outputs) {
      const res = await check(await this.http(o.image.url), "Firefly download");
      out.push({ bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/jpeg", provider: this.id, seed: o.seed });
    }
    return out;
  }

  async generate(req: GenerateRequest): Promise<GeneratedImage[]> {
    const res = await check(await this.http(`${this.base}/v3/images/generate`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ prompt: req.prompt, negativePrompt: req.negativePrompt, numVariations: req.count ?? 1, size: { width: req.width, height: req.height } }),
    }), "Firefly generate");
    return this.download(((await res.json()) as { outputs: { image: { url: string }; seed?: number }[] }).outputs);
  }

  async fill(req: FillRequest): Promise<GeneratedImage[]> {
    const [imageId, maskId] = [await this.upload(req.image), await this.upload(req.mask)];
    const res = await check(await this.http(`${this.base}/v3/images/fill`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ prompt: req.prompt, image: { source: { uploadId: imageId }, mask: { source: { uploadId: maskId } } }, size: { width: req.width, height: req.height } }),
    }), "Firefly fill");
    return this.download(((await res.json()) as { outputs: { image: { url: string }; seed?: number }[] }).outputs);
  }

  async expand(req: ExpandRequest): Promise<GeneratedImage[]> {
    const imageId = await this.upload(req.image);
    const res = await check(await this.http(`${this.base}/v3/images/expand`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ prompt: req.prompt, image: { source: { uploadId: imageId } }, size: { width: req.width, height: req.height } }),
    }), "Firefly expand");
    return this.download(((await res.json()) as { outputs: { image: { url: string }; seed?: number }[] }).outputs);
  }
}

/** remove.bg background removal API (https://www.remove.bg/api). Requires REMOVE_BG_API_KEY. */
export class RemoveBgProvider implements AiProvider {
  readonly id = "removebg";
  readonly capabilities = ["remove_background"] as const;
  constructor(private readonly apiKey: string | undefined, private readonly http: Fetch = fetch) {}
  configured(): boolean {
    return Boolean(this.apiKey);
  }
  async removeBackground(image: Uint8Array, mimeType: string): Promise<GeneratedImage> {
    if (!this.apiKey) throw new PsMcpError("PROVIDER_NOT_CONFIGURED", "Set REMOVE_BG_API_KEY to use remove.bg.");
    const form = new FormData();
    form.append("image_file", new Blob([image], { type: mimeType }), "image");
    form.append("size", "auto");
    form.append("format", "png");
    const res = await check(await this.http("https://api.remove.bg/v1.0/removebg", { method: "POST", headers: { "X-Api-Key": this.apiKey }, body: form }), "remove.bg");
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "image/png", provider: this.id };
  }
}

export class ProviderRegistry {
  constructor(private readonly providers: AiProvider[]) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env, http: Fetch = fetch): ProviderRegistry {
    return new ProviderRegistry([
      new FireflyProvider({ clientId: env.FIREFLY_CLIENT_ID, clientSecret: env.FIREFLY_CLIENT_SECRET }, http),
      new RemoveBgProvider(env.REMOVE_BG_API_KEY, http),
    ]);
  }

  find(cap: AiCapability): AiProvider | undefined {
    return this.providers.find((p) => p.capabilities.includes(cap) && p.configured());
  }

  require(cap: AiCapability): AiProvider {
    const p = this.find(cap);
    if (!p) {
      const candidates = this.providers.filter((x) => x.capabilities.includes(cap)).map((x) => x.id);
      throw new PsMcpError("PROVIDER_NOT_CONFIGURED", `No configured provider for ${cap}. Candidates: ${candidates.join(", ") || "none"}. See docs/SECURITY.md#ai-providers.`, { capability: cap, candidates });
    }
    return p;
  }

  status(): { id: string; configured: boolean; capabilities: readonly AiCapability[] }[] {
    return this.providers.map((p) => ({ id: p.id, configured: p.configured(), capabilities: p.capabilities }));
  }
}

/** Honest status of Photoshop's in-app AI features with respect to programmatic (ExtendScript / Action Manager) access. */
export const PHOTOSHOP_AI_CAPABILITIES: CapabilityStatus[] = [
  {
    feature: "Photoshop Generative Fill (in-app)", status: "unsupported",
    reason: "Not exposed through the documented Photoshop scripting DOM or Action Manager; it requires the interactive contextual task bar.",
    alternative: "generative_fill uses Adobe Firefly Services when FIREFLY_* credentials are set; otherwise content-aware fill (ai_remove_object) for removal tasks.",
  },
  {
    feature: "Photoshop Generative Expand (in-app)", status: "unsupported",
    reason: "Not exposed through the documented scripting APIs.",
    alternative: "extend_background enlarges the canvas and content-aware fills the new area; generative_expand uses Firefly Services when configured.",
  },
  {
    feature: "Remove Tool (in-app brush)", status: "partial",
    reason: "The brush-based Remove Tool is interactive. Content-Aware Fill on a selection is scriptable via batchPlay.",
    alternative: "ai_remove_object / remove_object run content-aware fill over a rectangle, ellipse or polygon you specify.",
  },
  {
    feature: "Select Subject / Select Sky / Remove Background", status: "supported",
    reason: "Recorded batchPlay events (autoCutout, selectSky) run Photoshop's built-in ML models; results depend on the image.",
  },
  {
    feature: "Neural Filters (Colorize, Skin Smoothing, Smart Portrait)", status: "unsupported",
    reason: "Neural Filters are not scriptable through ExtendScript.",
    alternative: "colorize_photo / smooth_skin build editable adjustment-layer approximations and say so in their result.",
  },
];
