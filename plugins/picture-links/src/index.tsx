import { logger } from "@vendetta";
import { findAll, findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";

/**
 * Runs fn and logs instead of throwing. A plugin that throws while loading is switched off by the
 * client, so one missing component must not take the others down with it.
 */
function safe<T>(label: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (e) {
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
        safe("load image size", () => logger.warn(`[Picture Links+] Failed to load image size for ${src}`, e));
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

// Profile banners
safe("patch ProfileBanner", () => {
    if (!ProfileBanner) throw new Error("ProfileBanner component not found");

    unpatches.push(after("default", ProfileBanner, ([props], res) => {
        const banner = resolveBanner(props?.bannerSource);
        if (!banner || !res) return res;

        return (
            <Pressable onPress={({ nativeEvent }) => openModal(banner.url, nativeEvent, banner.original)}>
                {res}
            </Pressable>
        );
    }));
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

export function onUnload() {
    for (const unpatch of unpatches) unpatch?.();
}
