import { logger } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";

// In-plugin debug log. Everything the plugin does is recorded here so it can be read from the
// plugin's settings page (and copied) without needing access to the client's debug logs.

const MAX_ENTRIES = 300;
// Renders happen constantly, so only the first few occurrences of each kind are written out in
// full. Every occurrence is still counted.
const SAMPLE_LIMIT = 6;

interface Entry {
    time: number;
    tag: string;
    text: string;
}

/** Counter names shared between the patches (index.tsx) and the settings page (Settings.tsx). */
export const KEYS = {
    avatarRender: "HeaderAvatar.render",
    bannerRender: "ProfileBanner.render",
    displayBannerRender: "DisplayBanner.render",
    avatarTap: "tap.avatar",
    bannerTap: "tap.banner",
    displayBannerTap: "tap.displayBanner",
} as const;

const entries: Entry[] = [];
const counters: Record<string, number> = {};
const startedAt = Date.now();

/** Short, safe, single-line description of any value. Never throws. */
export function describe(value: unknown, maxLength = 400): string {
    try {
        if (value === undefined) return "undefined";
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        const text = JSON.stringify(value) ?? String(value);
        return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
    } catch (e) {
        try {
            return String(value);
        } catch (e2) {
            return "[unprintable]";
        }
    }
}

/** typeof plus, for objects, up to 20 key names. Handy for seeing what a prop looks like. */
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

export function dlog(tag: string, text: string, extra?: unknown) {
    const line = extra === undefined ? text : `${text} ${describe(extra)}`;
    entries.push({ time: Date.now(), tag, text: line });
    if (entries.length > MAX_ENTRIES) entries.shift();
    try {
        logger.log(`[Picture Links] [${tag}] ${line}`);
    } catch (e) {
        // the client logger must never break the plugin
    }
}

/** Counts an event. Writes a log line only for the first few occurrences. Returns the new count. */
export function hit(key: string, text?: () => string): number {
    const count = (counters[key] ?? 0) + 1;
    counters[key] = count;
    if (text && count <= SAMPLE_LIMIT) {
        let line: string;
        try {
            line = text();
        } catch (e) {
            line = `(could not describe: ${describe(e)})`;
        }
        dlog(key, `#${count} ${line}`);
    }
    return count;
}

export function getCounters(): Record<string, number> {
    return counters;
}

export function getEntries(): Entry[] {
    return entries;
}

export function clearDebug() {
    entries.length = 0;
    for (const key of Object.keys(counters)) delete counters[key];
}

const PROBE_NAMES = [
    "ProfileBanner",
    "DisplayBanner",
    "UserProfileBanner",
    "ProfileBannerImage",
    "BannerImage",
    "HeaderAvatar",
    "UserProfileHeader",
    "ProfileHeader",
];

/** Looks up a handful of likely component names and logs which of them exist in this client. */
export function probeComponents() {
    for (const name of PROBE_NAMES) {
        try {
            const component = findByName(name, false);
            dlog("probe", component ? `${name}: found, keys=${shape(component)}` : `${name}: not found`);
        } catch (e) {
            dlog("probe", `${name}: lookup threw`, e);
        }
    }
}

function clientInfo(): string {
    const parts: string[] = [];
    try {
        parts.push(`platform=${ReactNative.Platform.OS} ${ReactNative.Platform.Version}`);
    } catch (e) {}
    try {
        const info = (globalThis as any).vendetta?.debug?.getDebugInfo?.();
        if (info) parts.push(`client=${describe(info, 600)}`);
    } catch (e) {}
    return parts.join("\n") || "(no client info available)";
}

function pad(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

/** Plain-text report suitable for pasting into a chat or an issue. */
export function dumpDebug(): string {
    const lines: string[] = [];
    lines.push("Picture Links Plus debug report");
    lines.push(clientInfo());
    lines.push("");
    lines.push("Counters:");
    const keys = Object.keys(counters);
    if (!keys.length) lines.push("  (nothing recorded yet)");
    for (const key of keys) lines.push(`  ${key}: ${counters[key]}`);
    lines.push("");
    lines.push("Log:");
    if (!entries.length) lines.push("  (empty)");
    for (const entry of entries) {
        const seconds = ((entry.time - startedAt) / 1000).toFixed(1);
        const d = new Date(entry.time);
        lines.push(`  +${seconds}s ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} [${entry.tag}] ${entry.text}`);
    }
    return lines.join("\n");
}
