export interface WorkshopPart {
  name: string;
  status: string;
  code: string;
}

export interface ParsedWorkshopStream {
  title: string;
  preamble: string;
  parts: WorkshopPart[];
  say: string[];
  complete: boolean;
}

export interface ApiCostEntry {
  id: string;
  ts: number;
  model: string;
  kind: "chat" | "vision" | "image" | "tts" | "workshop";
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  estimatedUsd: number;
  note?: string;
}

/**
 * Parses Prompt 08 incremental Workshop parts:
 *   //@title My Drone
 *   //@part frame | Building central carbon chassis
 *   ...code...
 *   //@part rotor-fl | Mounting front-left brushless rotor
 *   ...code...
 *   //@say Chassis and four rotors ready.
 *   //@end
 */
export function parseWorkshopParts(source: string): ParsedWorkshopStream {
  const cleaned = source
    .replace(/^```[\w-]*\s*\n?/gm, "")
    .replace(/\n?```$/gm, "");
  const lines = cleaned.split(/\r?\n/);

  let title = "";
  const preambleLines: string[] = [];
  const parts: WorkshopPart[] = [];
  const say: string[] = [];
  let complete = false;

  let currentPart: WorkshopPart | null = null;
  let currentLines: string[] = [];

  const flushPart = () => {
    if (currentPart) {
      parts.push({
        ...currentPart,
        code: currentLines.join("\n").trimEnd(),
      });
      currentPart = null;
      currentLines = [];
    }
  };

  for (const line of lines) {
    const titleMatch = line.match(/^\s*\/\/@title\s+(.+)/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    const partMatch = line.match(/^\s*\/\/@part\s+([a-z0-9-]+)(?:\s*\|\s*(.+))?$/i);
    if (partMatch) {
      flushPart();
      currentPart = {
        name: partMatch[1].toLowerCase(),
        status: (partMatch[2] || `Building ${partMatch[1]}`).trim(),
        code: "",
      };
      continue;
    }
    const sayMatch = line.match(/^\s*\/\/@say\s+(.+)/i);
    if (sayMatch) {
      say.push(sayMatch[1].trim());
      continue;
    }
    if (/^\s*\/\/@end\b/i.test(line)) {
      flushPart();
      complete = true;
      continue;
    }

    if (currentPart) currentLines.push(line);
    else preambleLines.push(line);
  }

  flushPart();
  return {
    title,
    preamble: preambleLines.join("\n").trim(),
    parts,
    say,
    complete,
  };
}

/**
 * Surgically replaces or appends a single named part inside a Workshop artifact
 * without disturbing unrelated parts or camera markers.
 */
export function replaceWorkshopPart(
  existingSource: string,
  partName: string,
  newPartCode: string,
  newStatus?: string,
): string {
  const parsed = parseWorkshopParts(existingSource);
  const key = partName.toLowerCase().trim();
  const cleanCode = newPartCode.trim();

  if (parsed.parts.length === 0) {
    return `${existingSource.trimEnd()}\n\n//@part ${key} | ${newStatus || `Updated ${key}`}\n${cleanCode}\n//@end`;
  }

  let replaced = false;
  const updatedParts = parsed.parts.map((p) => {
    if (p.name === key) {
      replaced = true;
      return {
        name: key,
        status: newStatus || p.status,
        code: cleanCode,
      };
    }
    return p;
  });

  if (!replaced) {
    updatedParts.push({
      name: key,
      status: newStatus || `Added ${key}`,
      code: cleanCode,
    });
  }

  const out: string[] = [];
  if (parsed.title) out.push(`//@title ${parsed.title}`);
  if (parsed.preamble) out.push(parsed.preamble);
  for (const part of updatedParts) {
    out.push(`//@part ${part.name} | ${part.status}`);
    out.push(part.code);
  }
  for (const line of parsed.say) out.push(`//@say ${line}`);
  out.push("//@end");
  return out.join("\n");
}

const MODEL_PRICING_PER_1M: Record<string, { in: number; out: number; image?: number }> = {
  "gemini-4-hydrogen": { in: 0.15, out: 0.6 },
  "gemini-3.1-flash-lite": { in: 0.075, out: 0.3 },
  "gemini-3.1-flash-lite-image": { in: 0.15, out: 0.6, image: 0.039 },
  "gemini-nano-banana-2.1": { in: 0.3, out: 1.2, image: 0.06 },
  "gemini-3.8-flash-lite-tts": { in: 0.1, out: 0.4 },
  "gemini-3.8-live": { in: 0.25, out: 1.0 },
};

export function estimateUsageCostUsd(input: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
}): number {
  const pricing = MODEL_PRICING_PER_1M[input.model] || { in: 0.2, out: 0.8, image: 0.04 };
  const inCost = ((input.inputTokens ?? 0) / 1_000_000) * pricing.in;
  const outCost = ((input.outputTokens ?? 0) / 1_000_000) * pricing.out;
  const imgCost = (input.imageCount ?? 0) * (pricing.image ?? 0.04);
  return Number((inCost + outCost + imgCost).toFixed(6));
}

export function summarizeCostReceipt(entries: ApiCostEntry[]): {
  totalUsd: number;
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  imageCount: number;
  formattedTotal: string;
} {
  let totalUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let imageCount = 0;
  for (const e of entries) {
    totalUsd += e.estimatedUsd;
    totalInputTokens += e.inputTokens;
    totalOutputTokens += e.outputTokens;
    imageCount += e.imageCount;
  }
  return {
    totalUsd: Number(totalUsd.toFixed(6)),
    callCount: entries.length,
    totalInputTokens,
    totalOutputTokens,
    imageCount,
    formattedTotal: `$${totalUsd < 0.01 ? totalUsd.toFixed(4) : totalUsd.toFixed(2)}`,
  };
}
