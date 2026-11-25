import { NAMED_COLORS, isHex } from "../shared.js";
import { findPreset, type CanvasPreset } from "./presets.js";
import { pickStyle, type DesignStyle } from "./styles.js";

export type DesignIntent =
  | "product_ad" | "social_media" | "poster" | "flyer" | "thumbnail" | "banner" | "ecommerce" | "magazine_cover"
  | "album_cover" | "portrait_retouch" | "photo_restoration" | "background_replacement" | "photo_manipulation"
  | "digital_art" | "marketing" | "advertisement" | "typography";

export interface ParsedBrief {
  raw: string;
  intent: DesignIntent;
  preset?: CanvasPreset;
  size: { width: number; height: number; resolution: number };
  style: DesignStyle;
  colors: string[];
  texts: { headline?: string; subhead?: string; cta?: string; extra: string[] };
  outputs: { format: "png" | "jpg" | "webp" | "tiff" | "pdf" | "psd"; width?: number; height?: number }[];
  wants: {
    removeBackground: boolean; reflection: boolean; shadow: boolean; glow: boolean; lighting?: string;
    surface?: string; retouch: boolean; restore: boolean; cinematicGrade: boolean; blackAndWhite: boolean;
  };
  assets: string[];
  assumptions: string[];
}

const INTENT_RULES: [DesignIntent, RegExp][] = [
  ["photo_restoration", /\b(restore|restoration|old photo|damaged photo|scratched)\b/],
  ["portrait_retouch", /\b(retouch|skin|blemish|portrait (edit|retouch)|headshot)\b/],
  ["background_replacement", /\b(replace (the )?background|background replacement|change (the )?background)\b/],
  ["thumbnail", /\bthumbnail\b/],
  ["magazine_cover", /\bmagazine\b/],
  ["album_cover", /\balbum\b|cover art/],
  ["ecommerce", /\b(e-?commerce|product listing|amazon|shopify|white background product)\b/],
  ["product_ad", /\b(product|perfume|bottle|watch|shoe|sneaker|cosmetic|skincare)\b.*\b(ad|advert|advertisement|campaign)\b|\b(ad|advertisement) for\b/],
  ["advertisement", /\b(ad|advert|advertisement|campaign)\b/],
  ["flyer", /\bflyer|leaflet\b/],
  ["poster", /\bposter\b/],
  ["banner", /\bbanner|header|hero\b/],
  ["social_media", /\b(instagram|facebook|twitter|linkedin|tiktok|pinterest|social)\b/],
  ["digital_art", /\b(painting|illustration|concept art|matte painting|character art|sketch|line art)\b/],
  ["photo_manipulation", /\b(composite|manipulation|double exposure|surreal|fantasy)\b/],
  ["typography", /\btypography|lettering|text effect\b/],
  ["marketing", /\b(marketing|promo|promotional)\b/],
];

const DEFAULT_SIZE: Partial<Record<DesignIntent, string>> = {
  product_ad: "instagram_post", advertisement: "instagram_post", social_media: "instagram_post", poster: "poster_18x24",
  flyer: "flyer_letter", thumbnail: "youtube_thumbnail", banner: "web_banner", ecommerce: "ecommerce",
  magazine_cover: "magazine_cover", album_cover: "album_cover", marketing: "instagram_post", typography: "hd",
  digital_art: "hd", photo_manipulation: "hd",
};

function quoted(text: string): string[] {
  const out: string[] = [];
  const re = /["“”']([^"“”']{2,120})["“”']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!.trim());
  return out;
}

/**
 * Deterministic natural-language brief parser. It extracts intent, size, style, colors, copy and outputs
 * so the planner can build structured tool calls; it records every assumption it makes.
 */
export function parseBrief(raw: string, presetsById: (id: string) => CanvasPreset | undefined): ParsedBrief {
  const t = raw.toLowerCase();
  const assumptions: string[] = [];
  const intent = INTENT_RULES.find(([, re]) => re.test(t))?.[0] ?? "marketing";

  let preset = findPreset(t);
  const dim = /(\d{3,5})\s*[x×]\s*(\d{3,5})/.exec(t);
  let size: ParsedBrief["size"];
  if (dim) {
    size = { width: Number(dim[1]), height: Number(dim[2]), resolution: 72 };
    preset = undefined;
  } else {
    if (!preset) {
      preset = presetsById(DEFAULT_SIZE[intent] ?? "instagram_post");
      if (preset) assumptions.push(`No size given; using ${preset.label} (${preset.width}x${preset.height}).`);
    }
    size = { width: preset?.width ?? 1080, height: preset?.height ?? 1080, resolution: preset?.resolution ?? 72 };
  }

  const style = pickStyle(t);
  if (!style.keywords.some((k) => t.includes(k))) assumptions.push(`No style keywords found; using the "${style.id}" style.`);

  const colors = [
    ...(t.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g) ?? []).filter(isHex),
    ...Object.keys(NAMED_COLORS).filter((n) => new RegExp(`\\b${n}\\b`).test(t)).map((n) => NAMED_COLORS[n]!),
  ];

  const q = quoted(raw);
  const texts: ParsedBrief["texts"] = { headline: q[0], subhead: q[1], cta: q[2], extra: q.slice(3) };
  const ctaMatch = /\b(shop now|buy now|learn more|sign up|order now|subscribe|book now|get started)\b/i.exec(raw);
  if (!texts.cta && ctaMatch) texts.cta = ctaMatch[1]!.toUpperCase();
  if (!texts.headline) {
    const forMatch = /\b(?:for|called|named|titled)\s+(?:an?\s+|the\s+)?([A-Z][\w&' -]{2,40})/.exec(raw);
    if (forMatch) {
      texts.headline = forMatch[1]!.trim();
      assumptions.push(`Headline inferred as "${texts.headline}"; put exact copy in quotes to control it.`);
    }
  }

  const outputs: ParsedBrief["outputs"] = [];
  const fmts: [RegExp, ParsedBrief["outputs"][number]["format"]][] = [
    [/\bpng\b/, "png"], [/\bjpe?g\b/, "jpg"], [/\bwebp\b/, "webp"], [/\btiff?\b/, "tiff"], [/\bpdf\b/, "pdf"],
  ];
  for (const [re, format] of fmts) if (re.test(t)) outputs.push({ format });
  const is4k = /\b4k\b|uhd/.test(t);
  if (is4k && outputs.length) for (const o of outputs) Object.assign(o, size.width >= size.height ? { width: 3840 } : { height: 3840 });
  if (!outputs.length) {
    outputs.push({ format: "png" });
    assumptions.push("No output format given; exporting PNG.");
  }

  const wants: ParsedBrief["wants"] = {
    removeBackground: /remove (the )?(original )?background|cut ?out|isolate/.test(t) || intent === "background_replacement" || intent === "ecommerce",
    reflection: /reflection|reflective|mirror/.test(t),
    shadow: /shadow/.test(t),
    glow: /glow|lighting|light rays|golden light/.test(t) || style.effects.glow === true,
    lighting: /golden/.test(t) ? NAMED_COLORS.gold : /blue light|cool light/.test(t) ? "#3FA7D6" : undefined,
    surface: /marble/.test(t) ? "marble" : /wood/.test(t) ? "wood" : /concrete/.test(t) ? "concrete" : undefined,
    retouch: intent === "portrait_retouch" || /retouch|smooth skin/.test(t),
    restore: intent === "photo_restoration",
    cinematicGrade: /cinematic|teal and orange|film look|color grade/.test(t),
    blackAndWhite: /black and white|b&w|monochrome/.test(t),
  };

  const assets = (raw.match(/[A-Za-z]:\\[^\s"']+\.(?:png|jpe?g|psd|tiff?|webp)|(?:\.{0,2}\/)?[\w./-]+\.(?:png|jpe?g|psd|tiff?|webp)/gi) ?? []).map((s) => s.trim());

  return { raw, intent, preset, size, style, colors, texts, outputs, wants, assets, assumptions };
}
