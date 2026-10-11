import { findAll } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";

import { describe, dlog, hit, hooks, shape } from "./debug";

// Server (guild) icons and banners.
//
// Discord does not give these components stable names, and other plugins have this commented out,
// so instead of hard-coding one name the plugin looks through Discord's modules at startup for
// components that are named like a server icon or banner. A component is only made tappable when a
// real server image URL can be worked out for it, so a wrongly matched component is left alone.
//
// When the names are not enough, "trace mode" (see below) records which components actually draw a
// server image while the app is being used, so the right ones can be found without guessing.

type Kind = "icon" | "banner";
type OpenModal = (src: string, event?: any, fallback?: string) => unknown;

// Anchored on purpose: a loose pattern also matched unrelated components such as
// GuildFeedBannerContainer and ServerPreviewBannerControls.
const TARGETS: { kind: Kind; pattern: RegExp }[] = [
    { kind: "icon", pattern: /^(Guild|Server)Icon(Inner)?$/ },
    { kind: "banner", pattern: /^(Guild|Server)(Profile|Header|Sheet)?Banner(Image|Background)?$/ },
];

const SERVER_IMAGE = /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/(icons|banners|splashes|discovery-splashes)\/\d+\//;

/** Every name a component might be known by (plain function, memo, forwardRef). Never throws. */
function namesOf(component: any): string[] {
    const names: string[] = [];
    const add = (value: unknown) => {
        if (typeof value === "string" && value) names.push(value);
    };
    try {
        add(component?.name);
        add(component?.displayName);
        add(component?.type?.name);
        add(component?.type?.displayName);
        add(component?.render?.name);
        add(component?.render?.displayName);
    } catch (e) {
        // exotic export with throwing getters
    }
    return names;
}

function classify(component: any): { kind: Kind; name: string } | undefined {
    for (const name of namesOf(component)) {
        for (const target of TARGETS) {
            if (target.pattern.test(name)) return { kind: target.kind, name };
        }
    }
}

/**
 * Module objects whose default export is a component accepted by `accept`. The filter answers
 * false for the default export itself so that the whole module object is returned: the patcher
 * needs the object that owns `default`.
 */
function findModules(accept: (names: string[]) => boolean): any[] {
    return findAll((m: any) => {
        try {
            if (!m || typeof m !== "object" || !m.default) return false;
            return accept(namesOf(m.default));
        } catch (e) {
            return false;
        }
    }).filter(Boolean);
}

/** Where a component's behaviour can be patched: plain function, memo, or forwardRef. */
function patchTarget(mod: any): { owner: any; key: string; shape: string } | undefined {
    const component = mod?.default;
    if (typeof component === "function") return { owner: mod, key: "default", shape: "function" };
    if (typeof component?.type === "function") return { owner: component, key: "type", shape: "memo" };
    if (typeof component?.render === "function") return { owner: component, key: "render", shape: "forwardRef" };
}

/** Full-size version of a server image URL, plus the original as a fallback. */
function fullSize(uri: unknown): { url: string; original: string } | undefined {
    if (typeof uri !== "string" || !SERVER_IMAGE.test(uri)) return;

    const base = uri.split("?")[0];
    const animated = /\/a_[^/]+\.\w+$/.test(base);
    const url = `${base.replace(/\.(webp|png|jpe?g|gif)$/i, animated ? ".gif" : ".png")}?size=4096`;
    return { url, original: uri };
}

const URI_KEYS = ["uri", "url", "iconURL", "bannerURL", "imageURL"];
const SOURCE_KEYS = ["source", "bannerSource", "imageSource", "iconSource", "image", "icon", "banner"];

/** A server image uri held directly by a props object or React element, whichever shape it uses. */
function uriOf(x: any): string | undefined {
    try {
        if (!x || typeof x !== "object") return;
        const matches = (c: unknown): c is string => typeof c === "string" && SERVER_IMAGE.test(c);

        for (const key of URI_KEYS) if (matches(x[key])) return x[key];
        for (const key of SOURCE_KEYS) {
            const source = x[key];
            if (matches(source?.uri)) return source.uri;
            if (matches(source?.[0]?.uri)) return source[0].uri;
        }
    } catch (e) {
        // getter that throws
    }
}

/** Looks through a rendered React element tree for a server image uri. Bounded, never throws. */
function uriInTree(root: any, maxNodes = 300): string | undefined {
    const queue: [any, number][] = [[root, 0]];
    const seen = new Set<any>();
    let visited = 0;

    try {
        while (queue.length && visited < maxNodes) {
            const [node, depth] = queue.shift()!;
            if (!node || typeof node !== "object" || seen.has(node)) continue;
            seen.add(node);
            visited++;

            if (Array.isArray(node)) {
                for (const item of node) queue.push([item, depth]);
                continue;
            }

            const found = uriOf(node.props) ?? uriOf(node);
            if (found) return found;

            if (depth < 8) {
                if (node.props?.children) queue.push([node.props.children, depth + 1]);
                if (node.children) queue.push([node.children, depth + 1]);
            }
        }
    } catch (e) {
        // exotic node
    }
}

function guildImage(kind: Kind, props: any, res: any): { url: string; original: string } | undefined {
    // 1. The guild the component was given. The most reliable source, independent of prop names.
    const asString = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const guild = props?.guild;
    const id = asString(guild?.id) ?? asString(props?.guildId);
    const hash = kind === "icon"
        ? asString(guild?.icon) ?? asString(props?.icon) ?? asString(props?.iconHash)
        : asString(guild?.banner) ?? asString(props?.banner) ?? asString(props?.bannerHash);
    if (id && hash) {
        const dir = kind === "icon" ? "icons" : "banners";
        const base = `https://cdn.discordapp.com/${dir}/${id}/${hash}`;
        return {
            url: `${base}.${hash.startsWith("a_") ? "gif" : "png"}?size=4096`,
            original: `${base}.webp?size=1024`,
        };
    }

    // 2. An image uri passed straight in through the props, or drawn somewhere in the output.
    return fullSize(uriOf(props) ?? uriInTree(res));
}

/** Icons show up everywhere (server list, pickers...). Only the big ones should open a viewer. */
function isLargeIcon(size: unknown): boolean {
    if (typeof size === "string") return ["XLARGE", "XXLARGE", "XXXLARGE", "JUMBO"].includes(size.toUpperCase());
    if (typeof size === "number") return size >= 64;
    return false;
}

function makePatch(info: { kind: Kind; name: string }, Pressable: any, openModal: OpenModal) {
    const key = `server.${info.name}`;

    return (args: any[], res: any) => {
        const props = args?.[0];
        hit(`${key}.render`, () => `rendered. props=${shape(props)}, size=${describe(props?.size)}, guild=${describe(props?.guild?.id ?? props?.guildId)}`);

        try {
            if (!res || !Pressable) return;

            if (info.kind === "icon") {
                // Counted per value so the report shows which sizes this component is drawn at.
                hit(`${key}.size=${describe(props?.size)}`);
                if (!isLargeIcon(props?.size)) return;
            }

            const image = guildImage(info.kind, props, res);
            if (!image) {
                hit(`${key}.noImage`, () => "no server image url found in the props or the output, left alone");
                return;
            }

            return (
                <Pressable
                    onPress={({ nativeEvent }: any) => {
                        hit(`${key}.tap`, () => `tapped, opening ${image.url}`);
                        openModal(image.url, nativeEvent, image.original);
                    }}
                >
                    {res}
                </Pressable>
            );
        } catch (e) {
            dlog("server", `${info.name} patch threw`, e);
        }
    };
}

/** Finds the server icon / banner components and makes them tappable. Returns how many it patched. */
export function installServerPatches(Pressable: any, openModal: OpenModal, unpatches: (() => void)[]): number {
    const seen = new Set<any>();
    let patched = 0;

    for (const mod of findModules((names) => names.some((name) => TARGETS.some((t) => t.pattern.test(name))))) {
        const info = classify(mod.default);
        if (!info) continue;

        const target = patchTarget(mod);
        if (!target) {
            dlog("server", `${info.name}: unsupported component shape ${shape(mod.default)}, skipped`);
            continue;
        }
        if (seen.has(target.owner)) continue;
        seen.add(target.owner);

        unpatches.push(after(target.key, target.owner, makePatch(info, Pressable, openModal)));
        hooks.serverComponents.push({ name: info.name, kind: info.kind, target: target.key });
        patched++;
    }

    dlog("server", `patched ${patched} server icon/banner component(s)`);
    return patched;
}

// ---------------------------------------------------------------------------------------------
// Scan: which components could be drawing a server image?
// ---------------------------------------------------------------------------------------------

const GUILDISH = /guild|server/i;
// A banner or splash is interesting whatever it is called. For anything else the name has to
// mention a guild/server AND something that suggests an image or a screen showing one.
const BANNERISH = /banner|splash/i;
const IMAGEISH = /icon|avatar|header|profile|image|sheet|preview|card|about|info|detail|invite|picker/i;

function relevantName(name: string): boolean {
    return BANNERISH.test(name) || (GUILDISH.test(name) && IMAGEISH.test(name));
}

/** For the settings page. Complete (no cut-off) list of the components worth looking at. */
export function scanServerNames(): string[] {
    const modules = findModules((names) => names.some((name) => GUILDISH.test(name) || BANNERISH.test(name)));

    const patchedNames = new Set(hooks.serverComponents.map((c) => c.name));
    const lines = new Set<string>();
    let other = 0;

    for (const mod of modules) {
        const component = mod.default;
        const name = namesOf(component).find((n) => GUILDISH.test(n) || BANNERISH.test(n)) ?? "?";
        if (!relevantName(name)) {
            other++;
            continue;
        }
        const shapeName = typeof component === "function" ? "function" : component?.type ? "memo" : component?.render ? "forwardRef" : "object";
        lines.add(`${name} [${shapeName}]${patchedNames.has(name) ? " <- patched" : ""}`);
    }

    // Once patched, a component may no longer carry its original name, so the search above can miss
    // it. Add what was patched at startup so the list is complete either way.
    const shapeOfTarget: Record<string, string> = { default: "function", type: "memo", render: "forwardRef" };
    for (const c of hooks.serverComponents) {
        lines.add(`${c.name} [${shapeOfTarget[c.target] ?? c.target}] <- patched`);
    }

    const result = [...lines].sort();
    result.push(`(${other} other components with guild/server in their name are not listed)`);
    return result;
}

// ---------------------------------------------------------------------------------------------
// Trace: watch which components actually draw a server icon or banner.
// ---------------------------------------------------------------------------------------------

const TRACK_NAME = /guild|server|banner|splash|profile|invite/i;
const MAX_TRACKED = 400;
let trackers: (() => void)[] = [];

export function isTracing(): boolean {
    return trackers.length > 0;
}

function kindOfUri(uri: string): string {
    if (/\/icons\//.test(uri)) return "icon";
    if (/\/banners\//.test(uri)) return "banner";
    return "splash";
}

/** Observer only: records what a component draws and never changes its output. */
function observer(name: string) {
    return (args: any[], res: any) => {
        try {
            const props = args?.[0];

            const guild = props?.guild;
            if (guild?.icon) hit(`trace.${name}.guild-icon`, () => `has a guild with an icon (props=${shape(props)}, size=${describe(props?.size)})`);
            if (guild?.banner) hit(`trace.${name}.guild-banner`, () => `has a guild with a banner (props=${shape(props)})`);

            const fromProps = uriOf(props);
            if (fromProps) {
                hit(`trace.${name}.props-${kindOfUri(fromProps)}`, () => `gets a server image in its props: ${fromProps} (props=${shape(props)}, size=${describe(props?.size)})`);
                return;
            }

            const fromTree = uriInTree(res);
            if (fromTree) {
                hit(`trace.${name}.output-${kindOfUri(fromTree)}`, () => `draws a server image: ${fromTree} (props=${shape(props)}, size=${describe(props?.size)})`);
            }
        } catch (e) {
            // an observer must never break rendering
        }
    };
}

/** Starts observing candidate components. Returns how many are being observed. */
export function startTrace(): number {
    stopTrace();

    const candidates = findModules((names) => names.some((name) => TRACK_NAME.test(name)));
    // components that mention a guild/server first, in case there are more than the cap
    candidates.sort((a, b) => Number(GUILDISH.test(namesOf(b.default)[0] ?? "")) - Number(GUILDISH.test(namesOf(a.default)[0] ?? "")));

    const seen = new Set<any>();
    for (const mod of candidates) {
        if (trackers.length >= MAX_TRACKED) break;

        const target = patchTarget(mod);
        if (!target || seen.has(target.owner)) continue;
        seen.add(target.owner);

        try {
            const name = namesOf(mod.default).find((n) => TRACK_NAME.test(n)) ?? "?";
            trackers.push(after(target.key, target.owner, observer(name)));
        } catch (e) {
            // some components cannot be patched, skip them
        }
    }

    dlog("trace", `watching ${trackers.length} component(s)`);
    return trackers.length;
}

export function stopTrace() {
    for (const unpatch of trackers) {
        try {
            unpatch();
        } catch (e) {
            // already gone
        }
    }
    trackers = [];
}
