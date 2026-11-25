/** Art-direction styles: palette + type pairing. Fonts are PostScript names that ship with Photoshop or Windows. */
export interface DesignStyle {
  id: string;
  keywords: string[];
  palette: { background: string; backgroundAlt: string; primary: string; accent: string; text: string; muted: string };
  fonts: { headline: string; body: string };
  headlineCase: "upper" | "title" | "as-is";
  effects: { glow?: boolean; shadow?: boolean; grain?: boolean };
}

export const STYLES: DesignStyle[] = [
  {
    id: "luxury", keywords: ["luxury", "premium", "elegant", "gold", "perfume", "jewelry", "high-end", "exclusive"],
    palette: { background: "#0A0A0A", backgroundAlt: "#1C1A17", primary: "#D4AF37", accent: "#F5E6B8", text: "#F5F1E6", muted: "#8C7B5A" },
    fonts: { headline: "TimesNewRomanPSMT", body: "MyriadPro-Regular" }, headlineCase: "upper", effects: { glow: true, shadow: true },
  },
  {
    id: "minimal", keywords: ["minimal", "clean", "simple", "modern", "scandinavian", "white"],
    palette: { background: "#FAFAFA", backgroundAlt: "#EDEDED", primary: "#111111", accent: "#FF5A36", text: "#111111", muted: "#6B6B6B" },
    fonts: { headline: "ArialMT", body: "ArialMT" }, headlineCase: "as-is", effects: {},
  },
  {
    id: "bold", keywords: ["bold", "loud", "sale", "promo", "discount", "energetic", "sport", "gaming", "youtube"],
    palette: { background: "#111827", backgroundAlt: "#7C3AED", primary: "#FACC15", accent: "#EF4444", text: "#FFFFFF", muted: "#C4B5FD" },
    fonts: { headline: "Impact", body: "Arial-BoldMT" }, headlineCase: "upper", effects: { shadow: true },
  },
  {
    id: "cinematic", keywords: ["cinematic", "movie", "film", "dramatic", "epic", "dark", "moody"],
    palette: { background: "#05080D", backgroundAlt: "#0F2A3A", primary: "#F2A65A", accent: "#3FA7D6", text: "#F1F5F9", muted: "#94A3B8" },
    fonts: { headline: "TimesNewRomanPS-BoldMT", body: "ArialMT" }, headlineCase: "upper", effects: { glow: true, grain: true },
  },
  {
    id: "vintage", keywords: ["vintage", "retro", "classic", "old", "nostalgic", "70s", "80s"],
    palette: { background: "#F3E9D2", backgroundAlt: "#C9A66B", primary: "#8C2F1B", accent: "#2F5D62", text: "#2B2118", muted: "#7A6A53" },
    fonts: { headline: "Georgia-Bold", body: "Georgia" }, headlineCase: "upper", effects: { grain: true },
  },
  {
    id: "tech", keywords: ["tech", "technology", "futuristic", "ai", "software", "startup", "neon", "cyber"],
    palette: { background: "#0B1020", backgroundAlt: "#1E1B4B", primary: "#22D3EE", accent: "#A855F7", text: "#E2E8F0", muted: "#64748B" },
    fonts: { headline: "SegoeUI-Bold", body: "SegoeUI" }, headlineCase: "as-is", effects: { glow: true },
  },
  {
    id: "nature", keywords: ["nature", "organic", "eco", "green", "natural", "botanical", "wellness"],
    palette: { background: "#F1F5EC", backgroundAlt: "#A3B18A", primary: "#344E41", accent: "#DDA15E", text: "#1B2A1F", muted: "#588157" },
    fonts: { headline: "Georgia-Bold", body: "SegoeUI" }, headlineCase: "title", effects: {},
  },
  {
    id: "playful", keywords: ["playful", "fun", "kids", "colorful", "party", "festival", "summer"],
    palette: { background: "#FFF7ED", backgroundAlt: "#FDBA74", primary: "#EC4899", accent: "#06B6D4", text: "#1F2937", muted: "#F59E0B" },
    fonts: { headline: "Arial-BoldMT", body: "ArialMT" }, headlineCase: "title", effects: { shadow: true },
  },
  {
    id: "corporate", keywords: ["corporate", "business", "professional", "conference", "finance", "webinar"],
    palette: { background: "#FFFFFF", backgroundAlt: "#E8EEF6", primary: "#0B3D91", accent: "#00A3E0", text: "#0F172A", muted: "#475569" },
    fonts: { headline: "SegoeUI-Bold", body: "SegoeUI" }, headlineCase: "as-is", effects: {},
  },
];

export function pickStyle(text: string, fallback = "minimal"): DesignStyle {
  const t = text.toLowerCase();
  let best: { s: DesignStyle; score: number } | undefined;
  for (const s of STYLES) {
    const score = s.keywords.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? STYLES.find((s) => s.id === fallback)!;
}

export function getStyle(id: string): DesignStyle | undefined {
  return STYLES.find((s) => s.id === id);
}

export function applyCase(text: string, c: DesignStyle["headlineCase"]): string {
  if (c === "upper") return text.toUpperCase();
  if (c === "title") return text.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1));
  return text;
}
