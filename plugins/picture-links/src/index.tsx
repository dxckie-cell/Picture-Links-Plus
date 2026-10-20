import { logger } from "@vendetta";
import { findAll, findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";

import { count, info, note, shape, short } from "./log";
import Settings from "./Settings";

/**
 * Runs fn and logs instead of throwing. A plugin that throws while loading is switched off by the
 * client, so one missing component must not take the others down with it.
 */
function safe<T>(label: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (e) {
        info.errors.push(`${label}: ${short(e)}`);
        try {
            logger.warn(`[Picture Links+] ${label} failed`, e);
        } catch (e2) {
            // the client logger must never break the plugin either
        }
    }
}

const Pressable = safe("find Pressable", () => findByProps("Button", "Text", "View")?.Pressable ?? ReactNative.Pressable);
const ProfileBanner = safe("find ProfileBanner", () => findByName("ProfileBanner", false));
const HeaderAvatar = safe("find HeaderAvatar", () => findByName("HeaderAvatar", false));
const openMediaModal = safe("find openMediaModal", () => findByProps("openMediaModal")?.openMediaModal);
const hideActionSheet = safe("find hideActionSheet", () => findByProps("hideActionSheet")?.hideActionSheet);
const getChannelId = safe("find SelectedChannelStore", () => findByStoreName("SelectedChannelStore")?.getChannelId);
const getGuildId = safe("find SelectedGuildStore", () => findByStoreName("SelectedGuildStore")?.getGuildId);

function getImageSize(uri: string): Promise<{ width: number, height: number }> {
    return new Promise((resolve, reject) => {
        ReactNative.Image.getSize(
            uri,
            (width, height) => resolve({ width, height }),
            (error) => reject(error)
        );
    });
}

async function openModal(src: string, event?, fallback?: string) {
    if (!openMediaModal) return;

    let size: { width: number, height: number };
    try {
        size = await getImageSize(src);
    } catch (e) {
        note(`image failed to load: ${src} (${short(e)})`);
        if (fallback && fallback !== src) return openModal(fallback, event);
        return;
    }

    safe("open media modal", () => {
        hideActionSheet?.(); // hide user sheet
        openMediaModal({
            initialSources: [{
                uri: src,
                sourceURI: src,
                width: size.width,
                height: size.height,
                guildId: getGuildId?.(),
                channelId: getChannelId?.(),
            }],
            initialIndex: 0,
            originLayout: {
                width: 0, // this would ideally be the size of the small pfp but this proved very hard to implement
                height: 0,
                x: event?.pageX ?? 0,
                y: event?.pageY ?? 0,
                resizeMode: "fill",
            }
        });
    });
}

// The banner image a banner component was given. The prop has been called bannerSource; other
// names and shapes (a plain url, a { uri }, a list of { uri }) are accepted in case Discord changes it.
const BANNER_PROPS = ["bannerSource", "bannerURL", "bannerUrl", "bannerUri", "bannerImage", "banner"];

function bannerUri(props: any): string | undefined {
    try {
        for (const key of BANNER_PROPS) {
            const value = props?.[key];
            const uri = typeof value === "string" ? value : value?.uri ?? value?.[0]?.uri;
            if (typeof uri === "string" && /^https?:\/\//.test(uri)) return uri;
        }
        // renamed prop: any prop (or { uri } inside it) that points at a user banner on Discord's CDN
        for (const value of Object.values(props ?? {}) as any[]) {
            const uri = typeof value === "string" ? value : value?.uri ?? value?.[0]?.uri;
            if (typeof uri === "string" && /^https?:\/\/(cdn|media)\.discordapp\.(com|net)\/(banners\/\d+\/|guilds\/\d+\/users\/\d+\/banners\/)/.test(uri)) return uri;
        }
    } catch (e) {
        // a getter that throws
    }
}

// Full-size URL for a user banner, plus the untouched original as a fallback.
function resolveBanner(bannerSource: any): { url: string, original: string } | undefined {
    const original = typeof bannerSource === "string" ? bannerSource : bannerSource?.uri;
    if (typeof original !== "string" || !original) return;

    // Only rewrite Discord CDN links. Anything else (e.g. custom banner hosts) is used as-is.
    if (!/^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(original)) {
        return { url: original, original };
    }

    // Drop every query parameter, then ask for the largest size.
    return { url: `${original.split("?")[0].replace(".webp", ".png")}?size=4096`, original };
}

const unpatches: (() => void)[] = [];

// Profile pictures
safe("patch HeaderAvatar", () => {
    if (!HeaderAvatar) throw new Error("HeaderAvatar component not found");

    unpatches.push(after("default", HeaderAvatar, ([{ user, style, guildId }], res) => {
        var ext = "png";
        if (typeof user.guildMemberAvatars?.[guildId] === "string") {
            if (user.guildMemberAvatars?.[guildId].includes("a_")) { ext = "gif"; }
        }
        const guildSpecific = user.guildMemberAvatars?.[guildId] && `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${user.guildMemberAvatars[guildId]}.${ext}?size=4096`;
        const image = user?.getAvatarURL?.(false, 4096, true);
        if (!image) return res;

        const url =
            typeof image === "number"
                ? `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`
                : image?.replace(".webp", ".png");

        delete res.props.style;

        return (
            <Pressable
                onPress={({ nativeEvent }) => openModal(url, nativeEvent)}
                onLongPress={({ nativeEvent }) => guildSpecific && openModal(guildSpecific, nativeEvent)}
                style={style}>
                {res}
            </Pressable>
        );
    }));
});

// Where a component can be patched: a plain function, a memo, or a forwardRef.
function patchTarget(mod: any): [any, string] | undefined {
    const component = mod?.default;
    if (typeof component === "function") return [mod, "default"];
    if (typeof component?.type === "function") return [component, "type"];
    if (typeof component?.render === "function") return [component, "render"];
}

function namesOf(component: any): string[] {
    try {
        return [component?.name, component?.displayName, component?.type?.name, component?.type?.displayName, component?.render?.name, component?.render?.displayName]
            .filter((n): n is string => typeof n === "string" && !!n);
    } catch (e) {
        return [];
    }
}

// Profile banners.
//
// Discord 343 draws them with a component called ProfileBanner. After an update the component may
// be renamed (ProfileBannerV2, UserProfileBanner...), so besides ProfileBanner every component with
// a profile-banner-like name is looked at. None of them is changed unless it was given a banner
// image, so a look-alike that has nothing to do with banners is left alone.
const BANNER_NAME = /^(\w*Profile\w*(Banner|Header|Hero|Cover)\w*|\w*(User|Profile)\w*Banner\w*|DisplayBanner\w*)$/;
const NOT_USER_BANNER = /Guild|Server|^preload/;

function patchBanner(name: string, owner: any, key: string, images = false) {
    unpatches.push(after(key, owner, ([props], res) => {
        const uri = bannerUri(images ? { source: props?.source } : props);
        // images are drawn everywhere, so only the ones showing a banner are counted
        if (!images || uri) count(`${name}.render`, () => `props=${shape(props)}, banner=${short(uri)}`);
        if (!res) return;

        const banner = uri && resolveBanner(uri);
        if (!banner) {
            if (images) return;
            // normal for the first renders, while the profile is still loading
            count(`${name}.noImage`, () => `no banner image in the props. props=${shape(props)}, bannerSource=${short(props?.bannerSource)}`);
            return;
        }

        count(`${name}.wrapped`);
        return (
            <Pressable
                style={images ? props?.style : undefined}
                onPress={({ nativeEvent }) => {
                    count(`${name}.tap`, () => `tapped, opening ${banner.url}`);
                    openModal(banner.url, nativeEvent, banner.original);
                }}
            >
                {res}
            </Pressable>
        );
    }));
}

safe("patch profile banners", () => {
    const patched = new Set<any>();
    const candidates: [string, any][] = [];

    // the component Discord 343 uses
    if (ProfileBanner) candidates.push(["ProfileBanner", ProfileBanner]);
    else info.errors.push("ProfileBanner component not found, looking for look-alikes");

    // anything else named like a profile banner
    const found = findAll((m: any) => {
        try {
            if (!m || typeof m !== "object" || !m.default) return false;
            return namesOf(m.default).some((n) => BANNER_NAME.test(n) && !NOT_USER_BANNER.test(n));
        } catch (e) {
            return false;
        }
    }).filter(Boolean);
    for (const mod of found) candidates.push([namesOf(mod.default).find((n) => BANNER_NAME.test(n)) ?? "?", mod]);

    for (const [name, mod] of candidates) {
        const target = patchTarget(mod);
        if (!target || patched.has(target[0])) continue;
        patched.add(target[0]);

        patchBanner(name, target[0], target[1]);
        info.patched.push(`${name} (profile banner, via ${target[1]})`);
    }

    // Discord 349 draws the banner with a component that has no usable name, so the element itself is
    // caught instead: anything created with a source that is a user banner on Discord's CDN.
    safe("patch banner elements", () => {
        // temporary diagnostics: shapes of elements that carry anything banner-like
        const seenShapes = new Set<string>();
        const diagnose = (type: any, props: any) => {
            count("Element.seen");
            try {
                for (const key in props) {
                    if (!/banner/i.test(key)) continue;
                    const sig = `${type?.displayName ?? type?.name ?? typeof type}:${Object.keys(props).join(",")}`;
                    if (seenShapes.size >= 25 || seenShapes.has(sig)) return;
                    seenShapes.add(sig);
                    count("Element.bannerProp", () => `type=${short(type?.displayName ?? type?.name ?? typeof type)} ${key}=${short(props[key], 160)} props=${shape(props)}`);
                    return;
                }
                const src = props?.source;
                const uri = typeof src === "string" ? src : src?.uri ?? src?.[0]?.uri;
                if (typeof uri === "string" && /banner/i.test(uri) && !seenShapes.has(uri.split("?")[0])) {
                    seenShapes.add(uri.split("?")[0]);
                    count("Element.bannerUrl", () => `type=${short(type?.displayName ?? type?.name ?? typeof type)} uri=${short(uri, 160)}`);
                }
            } catch (e) {
                // diagnostics must never break rendering
            }
        };

        const wrapElement = (type: any, props: any, el: any) => {
            if (props && type !== Pressable) diagnose(type, props);
            if (!el || !props || type === Pressable || !props.source) return;
            const uri = bannerUri({ source: props.source });
            const banner = uri && resolveBanner(uri);
            if (!banner) return;

            count("Element.banner", () => `type=${short(type?.displayName ?? type?.name ?? typeof type)}, props=${shape(props)}, banner=${short(uri)}`);
            return (
                <Pressable
                    style={props.style}
                    onPress={({ nativeEvent }) => {
                        count("Element.tap", () => `tapped, opening ${banner.url}`);
                        openModal(banner.url, nativeEvent, banner.original);
                    }}
                >
                    {el}
                </Pressable>
            );
        };

        let hooked = 0;
        const runtime: any = findByProps("jsx", "jsxs");
        for (const key of ["jsx", "jsxs", "jsxDEV"]) {
            if (typeof runtime?.[key] !== "function") continue;
            unpatches.push(after(key, runtime, ([type, props], el) => wrapElement(type, props, el)));
            hooked++;
        }
        const react: any = findByProps("createElement", "useState");
        if (typeof react?.createElement === "function") {
            unpatches.push(after("createElement", react, ([type, props], el) => wrapElement(type, props, el)));
            hooked++;
        }
        if (!hooked) throw new Error("no element factory found");
        patched.add("elements");
        info.patched.push(`React elements with a banner source (${hooked} factories)`);
    });

    // what else lives next to the banner preloader, in case the component is exported there
    safe("list banner module", () => {
        const preload: any = findByProps("preloadUserBannerImage");
        if (preload) info.patched.push(`module with preloadUserBannerImage exports: ${Object.keys(preload).slice(0, 30).join(", ")}`);
    });

    if (!patched.size) throw new Error("no profile banner component found");
});

// Server icons and banners.
//
// Discord gives these components no stable export names, so they are found by their display names
// (these are the ones used by Discord 343): GuildIconInner draws the server icon and
// GuildActionSheetHeader draws the banner in the server menu. The icon inside the header has its
// own tap, which wins over the header's, so tapping the icon still opens the icon.
const SERVER_COMPONENTS: Record<string, "icon" | "banner"> = {
    GuildIconInner: "icon",
    GuildIcon: "icon",
    GuildActionSheetHeader: "banner",
};

function serverComponentName(component: any): string | undefined {
    try {
        for (const name of [component?.name, component?.displayName, component?.type?.name, component?.type?.displayName, component?.render?.name, component?.render?.displayName]) {
            if (typeof name === "string" && Object.prototype.hasOwnProperty.call(SERVER_COMPONENTS, name)) return name;
        }
    } catch (e) {
        // exotic export with a throwing getter
    }
}

function serverImage(kind: "icon" | "banner", guild: any): { url: string, original: string } | undefined {
    const hash = kind === "icon" ? guild?.icon : guild?.banner;
    if (typeof guild?.id !== "string" || typeof hash !== "string" || !hash) return;

    const base = `https://cdn.discordapp.com/${kind === "icon" ? "icons" : "banners"}/${guild.id}/${hash}`;
    return {
        url: `${base}.${hash.startsWith("a_") ? "gif" : "png"}?size=4096`,
        original: `${base}.webp?size=1024`,
    };
}

// Icons are drawn everywhere (server list, pickers...), so only the big one opens the viewer.
function isLargeIcon(size: unknown): boolean {
    if (typeof size === "string") return ["XLARGE", "XXLARGE", "XXXLARGE", "JUMBO"].includes(size.toUpperCase());
    if (typeof size === "number") return size >= 64;
    return false;
}

safe("patch server icons and banners", () => {
    const modules = findAll((m: any) => {
        try {
            return !!m && typeof m === "object" && !!m.default && !!serverComponentName(m.default);
        } catch (e) {
            return false;
        }
    }).filter(Boolean);

    const seen = new Set<any>();
    for (const mod of modules) {
        const component = mod.default;
        const kind = SERVER_COMPONENTS[serverComponentName(component)!];

        // plain function component, memo, or forwardRef
        const [owner, key] =
            typeof component === "function" ? [mod, "default"]
            : typeof component?.type === "function" ? [component, "type"]
            : typeof component?.render === "function" ? [component, "render"]
            : [];
        if (!owner || seen.has(owner)) continue;
        seen.add(owner);
        info.patched.push(`${serverComponentName(component)} (server ${kind}, via ${key})`);

        unpatches.push(after(key!, owner, ([props], res) => {
            if (!res) return;
            if (kind === "icon" && !isLargeIcon(props?.size)) return;

            const image = serverImage(kind, props?.guild);
            if (!image) return;

            return (
                <Pressable onPress={({ nativeEvent }) => openModal(image.url, nativeEvent, image.original)}>
                    {res}
                </Pressable>
            );
        }));
    }
});

export const settings = Settings;

export function onUnload() {
    for (const unpatch of unpatches) unpatch?.();
}
