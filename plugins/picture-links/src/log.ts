// A tiny in-plugin log, shown on the plugin's settings page so problems can be diagnosed without
// access to the client's debug logs.

const MAX_LINES = 80;
// Banners are redrawn constantly, so only the first few occurrences of each event are written out.
// Every occurrence is still counted.
const SAMPLES = 4;

const lines: string[] = [];
const counts: Record<string, number> = {};

export const info: {
    /** Components that were patched at startup, with how they were found. */
    patched: string[];
    /** Things that failed while loading. */
    errors: string[];
    /** Result of the last scan, if any. */
    scan?: string[];
} = { patched: [], errors: [] };

/** Short single-line description of any value. Never throws. */
export function short(value: unknown, max = 220): string {
    try {
        if (value === undefined) return "undefined";
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        const text = JSON.stringify(value) ?? String(value);
        return text.length > max ? `${text.slice(0, max)}…` : text;
    } catch (e) {
        return "[unprintable]";
    }
}

/** typeof, plus up to 20 key names for objects. */
export function shape(value: unknown): string {
    if (value === null) return "null";
    if (typeof value !== "object") return typeof value;
    try {
        const keys = Object.keys(value as object);
        return `{${keys.slice(0, 20).join(",")}${keys.length > 20 ? ",…" : ""}}`;
    } catch (e) {
        return "object";
    }
}

export function note(text: string) {
    const d = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    lines.push(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${text}`);
    if (lines.length > MAX_LINES) lines.shift();
}

/** Counts an event and writes a line for the first few occurrences. */
export function count(key: string, detail?: () => string): number {
    const n = (counts[key] ?? 0) + 1;
    counts[key] = n;
    if (detail && n <= SAMPLES) {
        let text: string;
        try {
            text = detail();
        } catch (e) {
            text = "(could not describe)";
        }
        note(`${key} #${n} ${text}`);
    }
    return n;
}

export function getCount(key: string): number {
    return counts[key] ?? 0;
}

/** Sum of every counter whose name ends with the given suffix. */
export function countEnding(suffix: string): number {
    return Object.keys(counts)
        .filter((key) => key.endsWith(suffix))
        .reduce((total, key) => total + counts[key], 0);
}

export function clearLog() {
    lines.length = 0;
    for (const key of Object.keys(counts)) delete counts[key];
    info.scan = undefined;
}

/** Plain-text report for pasting into a chat. */
export function report(): string {
    const out: string[] = ["Picture Links+ report"];
    try {
        const debug = (globalThis as any).vendetta?.debug?.getDebugInfo?.();
        if (debug) out.push(short(debug, 700));
    } catch (e) {
        // not available
    }

    out.push("", "Problems while loading:");
    if (!info.errors.length) out.push("  none");
    for (const e of info.errors) out.push(`  ${e}`);

    out.push("", "Patched at startup:");
    if (!info.patched.length) out.push("  nothing");
    for (const p of info.patched) out.push(`  ${p}`);

    out.push("", "Counters:");
    const keys = Object.keys(counts);
    if (!keys.length) out.push("  (nothing recorded yet)");
    for (const key of keys) out.push(`  ${key}: ${counts[key]}`);

    if (info.scan) {
        out.push("", `Scan (${info.scan.length}):`);
        for (const line of info.scan) out.push(`  ${line}`);
    }

    out.push("", "Log:");
    if (!lines.length) out.push("  (empty)");
    for (const line of lines) out.push(`  ${line}`);
    return out.join("\n");
}
