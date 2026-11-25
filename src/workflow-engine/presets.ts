/** Canvas presets in pixels. `resolution` is ppi. */
export interface CanvasPreset { id: string; label: string; width: number; height: number; resolution: number; aliases: string[] }

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "instagram_post", label: "Instagram post", width: 1080, height: 1080, resolution: 72, aliases: ["instagram", "ig post", "square post"] },
  { id: "instagram_portrait", label: "Instagram portrait", width: 1080, height: 1350, resolution: 72, aliases: ["instagram portrait", "4:5"] },
  { id: "instagram_story", label: "Instagram/TikTok story", width: 1080, height: 1920, resolution: 72, aliases: ["story", "reel", "tiktok", "9:16"] },
  { id: "facebook_post", label: "Facebook post", width: 1200, height: 630, resolution: 72, aliases: ["facebook post", "facebook ad"] },
  { id: "facebook_cover", label: "Facebook cover", width: 1640, height: 624, resolution: 72, aliases: ["facebook cover"] },
  { id: "twitter_post", label: "X/Twitter post", width: 1600, height: 900, resolution: 72, aliases: ["twitter", "x post", "tweet"] },
  { id: "twitter_header", label: "X/Twitter header", width: 1500, height: 500, resolution: 72, aliases: ["twitter header", "x header"] },
  { id: "linkedin_post", label: "LinkedIn post", width: 1200, height: 627, resolution: 72, aliases: ["linkedin"] },
  { id: "linkedin_banner", label: "LinkedIn banner", width: 1584, height: 396, resolution: 72, aliases: ["linkedin banner"] },
  { id: "pinterest_pin", label: "Pinterest pin", width: 1000, height: 1500, resolution: 72, aliases: ["pinterest", "pin"] },
  { id: "youtube_thumbnail", label: "YouTube thumbnail", width: 1280, height: 720, resolution: 72, aliases: ["youtube thumbnail", "thumbnail", "yt thumbnail"] },
  { id: "youtube_banner", label: "YouTube channel art", width: 2560, height: 1440, resolution: 72, aliases: ["youtube banner", "channel art"] },
  { id: "web_banner", label: "Web hero banner", width: 1920, height: 600, resolution: 72, aliases: ["banner", "hero", "web banner"] },
  { id: "leaderboard", label: "Leaderboard ad 728x90", width: 728, height: 90, resolution: 72, aliases: ["leaderboard"] },
  { id: "medium_rectangle", label: "Medium rectangle ad 300x250", width: 300, height: 250, resolution: 72, aliases: ["medium rectangle", "mpu"] },
  { id: "hd", label: "Full HD 1920x1080", width: 1920, height: 1080, resolution: 72, aliases: ["1080p", "full hd", "hd"] },
  { id: "4k", label: "4K UHD 3840x2160", width: 3840, height: 2160, resolution: 72, aliases: ["4k", "uhd", "2160p"] },
  { id: "poster_a3", label: "Poster A3 @300ppi", width: 3508, height: 4961, resolution: 300, aliases: ["poster", "a3"] },
  { id: "poster_18x24", label: "Poster 18x24in @150ppi", width: 2700, height: 3600, resolution: 150, aliases: ["18x24"] },
  { id: "flyer_letter", label: "Flyer US Letter @300ppi", width: 2550, height: 3300, resolution: 300, aliases: ["flyer", "letter"] },
  { id: "flyer_a4", label: "Flyer A4 @300ppi", width: 2480, height: 3508, resolution: 300, aliases: ["a4"] },
  { id: "magazine_cover", label: "Magazine cover 8.5x11in @300ppi", width: 2550, height: 3300, resolution: 300, aliases: ["magazine", "magazine cover"] },
  { id: "album_cover", label: "Album cover 3000x3000", width: 3000, height: 3000, resolution: 300, aliases: ["album", "album cover", "cover art"] },
  { id: "ecommerce", label: "E-commerce product 2000x2000", width: 2000, height: 2000, resolution: 72, aliases: ["ecommerce", "e-commerce", "product image", "amazon", "shopify"] },
];

export function findPreset(text: string): CanvasPreset | undefined {
  const t = text.toLowerCase();
  // longest alias first so "youtube thumbnail" beats "thumbnail" and "facebook cover" beats "facebook"
  const all = CANVAS_PRESETS.flatMap((p) => p.aliases.map((a) => ({ a, p }))).sort((x, y) => y.a.length - x.a.length);
  return all.find(({ a }) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t))?.p;
}

export function getPreset(id: string): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((p) => p.id === id);
}
