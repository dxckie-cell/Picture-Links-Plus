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

type Kind = "icon" | "banner";
type OpenModal = (src: string, event?: any, fallback?: string) => unknown;

const TARGETS: { kind: Kind; pattern: RegExp }[] = [
    { kind: "icon", pattern: /^(Guild|Server)Icon$/ },
    { kind: "banner", pattern: /^(Guild|Server)\w*Banner\w*$/ },
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
 * Module objects whose default export is a server icon / banner component. The filter answers
 * false for the default export itself so that the whole module object is returned: the patcher
 * needs the object that owns `default`.
 */
function findServerModules(): any[] {
    return findAll((m: any) => {
        try {
            if (!m || typeof m !== "object" || !m.default) return false;
            return !!classify(m.default);
        } catch (e) {
            return false;
        }
    }).filter(Boolean);
}

/** Full-size version of a server image URL, plus the original as a fallback. */
function fullSize(uri: unknown): { url: string; original: string } | undefined {
    if (typeof uri !== "string" || !SERVER_IMAGE.test(uri)) return;

    const base = uri.split("?")[0];
    const animated = /\/a_[^/]+\.\w+$/.test(base);
    const url = `${base.replace(/\.(webp|png|jpe?g|gif)$/i, animated ? ".gif" : ".png")}?size=4096`;
    return { url, original: uri };
}

/** An image uri held by a props object or React element, whichever shape it uses. */
function uriOf(x: any): string | undefined {
    try {
        const candidates = [
            x?.uri,
            x?.source?.uri,
            x?.source?.[0]?.uri,
            x?.bannerSource?.uri,
            x?.imageSource?.uri,
            x?.iconSource?.uri,
        ];
        return candidates.find((c) => typeof c === "string" && SERVER_IMAGE.test(c));
    } catch (e) {
        return;
    }
}

function guildImage(kind: Kind, props: any, res: any): { url: string; original: string } | undefined {
    // 1. The guild the component was given. The most reliable source, independent of prop names.
    const guild = props?.guild;
    const hash = kind === "icon" ? guild?.icon : guild?.banner;
    if (guild?.id && typeof hash === "string" && hash) {
        const dir = kind === "icon" ? "icons" : "banners";
        const base = `https://cdn.discordapp.com/${dir}/${guild.id}/${hash}`;
        return {
            url: `${base}.${hash.startsWith("a_") ? "gif" : "png"}?size=4096`,
            original: `${base}.webp?size=1024`,
        };
    }

    // 2. An image uri passed straight in through the props.
    const fromProps = fullSize(uriOf(props));
    if (fromProps) return fromProps;

    // 3. An image uri somewhere in what the component rendered.
    const node = findInReactTree(res, (x: any) => !!uriOf(x));
    return fullSize(uriOf(node));
}

/** Icons show up everywhere (server list, pickers...). Only the big one should open a viewer. */
function isLargeIcon(size: unknown): boolean {
    if (typeof size === "string") return size.toUpperCase() === "XLARGE";
    if (typeof size === "number") return size >= 64;
    return false;
}

function makePatch(info: { kind: Kind; name: string }, Pressable: any, openModal: OpenModal) {
    const key = `server.${info.name}`;

    return (args: any[], res: any) => {
        const props = args?.[0];
        hit(`${key}.render`, () => `rendered. props=${shape(props)}, size=${describe(props?.size)}, guild=${describe(props?.guild?.id)}`);

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

    for (const mod of findServerModules()) {
        const component = mod.default;
        const info = classify(component);
        if (!info) continue;

        // plain function component, memo, or forwardRef
        let owner: any;
        let key: string | undefined;
        if (typeof component === "function") [owner, key] = [mod, "default"];
        else if (typeof component?.type === "function") [owner, key] = [component, "type"];
        else if (typeof component?.render === "function") [owner, key] = [component, "render"];

        if (!owner || !key) {
            dlog("server", `${info.name}: unsupported component shape ${shape(component)}, skipped`);
            continue;
        }
        if (seen.has(owner)) continue;
        seen.add(owner);

        unpatches.push(after(key, owner, makePatch(info, Pressable, openModal)));
        hooks.serverComponents.push({ name: info.name, kind: info.kind, target: key });
        patched++;
    }

    dlog("server", `patched ${patched} server icon/banner component(s)`);
    return patched;
}

/** For the settings page: every component whose name mentions guild or server, patched or not. */
export function scanServerNames(): string[] {
    const modules = findAll((m: any) => {
        try {
            if (!m || typeof m !== "object" || !m.default) return false;
            return namesOf(m.default).some((name) => /guild|server/i.test(name));
        } catch (e) {
            return false;
        }
    }).filter(Boolean);

    const patchedNames = new Set(hooks.serverComponents.map((c) => c.name));
    const lines = new Set<string>();
    for (const mod of modules) {
        const component = mod.default;
        const shapeName = typeof component === "function" ? "function" : component?.type ? "memo" : component?.render ? "forwardRef" : "object";
        const name = namesOf(component).find((n) => /guild|server/i.test(n)) ?? "?";
        lines.add(`${name} [${shapeName}]${patchedNames.has(name) ? " <- patched" : ""}`);
    }

    // Once patched, a component may no longer carry its original name, so the search above can miss
    // it. Add what was patched at startup so the list is complete either way.
    const shapeOfTarget: Record<string, string> = { default: "function", type: "memo", render: "forwardRef" };
    for (const c of hooks.serverComponents) {
        lines.add(`${c.name} [${shapeOfTarget[c.target] ?? c.target}] <- patched`);
    }

    return [...lines].sort().slice(0, 150);
}
