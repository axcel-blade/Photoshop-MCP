/** Pure geometry for align_layers / distribute_layers: bounds in, per-layer moves out. */

export interface Box { left: number; top: number; right: number; bottom: number }
export interface Item { id: number; bounds: Box }
export interface Move { id: number; dx: number; dy: number }

export type Alignment = "left" | "centerHorizontal" | "right" | "top" | "centerVertical" | "bottom";

export function unionBox(items: Item[]): Box {
  return {
    left: Math.min(...items.map((i) => i.bounds.left)), top: Math.min(...items.map((i) => i.bounds.top)),
    right: Math.max(...items.map((i) => i.bounds.right)), bottom: Math.max(...items.map((i) => i.bounds.bottom)),
  };
}

/** Move each item so the chosen edge or center lines up with the target box (inset by margin on edges). */
export function alignMoves(items: Item[], align: Alignment, target: Box, margin = 0): Move[] {
  return items.map(({ id, bounds: b }) => {
    let dx = 0, dy = 0;
    switch (align) {
      case "left": dx = target.left + margin - b.left; break;
      case "right": dx = target.right - margin - b.right; break;
      case "centerHorizontal": dx = (target.left + target.right) / 2 - (b.left + b.right) / 2; break;
      case "top": dy = target.top + margin - b.top; break;
      case "bottom": dy = target.bottom - margin - b.bottom; break;
      case "centerVertical": dy = (target.top + target.bottom) / 2 - (b.top + b.bottom) / 2; break;
    }
    return { id, dx: Math.round(dx), dy: Math.round(dy) };
  });
}

/**
 * Space items along an axis, keeping their order on that axis.
 * - spacing given: fixed gap between neighbours, starting from the first item (which stays put).
 * - by "gaps" (default): equal gaps between the outermost items (which stay put).
 * - by "centers": equal distance between centers, outermost items stay put.
 */
export function distributeMoves(items: Item[], axis: "horizontal" | "vertical", opts: { by?: "gaps" | "centers"; spacing?: number } = {}): Move[] {
  const h = axis === "horizontal";
  const start = (b: Box) => (h ? b.left : b.top);
  const size = (b: Box) => (h ? b.right - b.left : b.bottom - b.top);
  const sorted = [...items].sort((a, b) => start(a.bounds) + size(a.bounds) / 2 - (start(b.bounds) + size(b.bounds) / 2));
  const first = sorted[0]!, last = sorted[sorted.length - 1]!;
  const positions: number[] = [];
  if (opts.spacing !== undefined) {
    let cursor = start(first.bounds);
    for (const it of sorted) { positions.push(cursor); cursor += size(it.bounds) + opts.spacing; }
  } else if (opts.by === "centers") {
    const c0 = start(first.bounds) + size(first.bounds) / 2, c1 = start(last.bounds) + size(last.bounds) / 2;
    const step = sorted.length > 1 ? (c1 - c0) / (sorted.length - 1) : 0;
    sorted.forEach((it, i) => positions.push(c0 + step * i - size(it.bounds) / 2));
  } else {
    const span = start(last.bounds) + size(last.bounds) - start(first.bounds);
    const total = sorted.reduce((s, it) => s + size(it.bounds), 0);
    const gap = sorted.length > 1 ? (span - total) / (sorted.length - 1) : 0;
    let cursor = start(first.bounds);
    for (const it of sorted) { positions.push(cursor); cursor += size(it.bounds) + gap; }
  }
  return sorted.map((it, i) => {
    const d = Math.round(positions[i]! - start(it.bounds));
    return { id: it.id, dx: h ? d : 0, dy: h ? 0 : d };
  });
}
