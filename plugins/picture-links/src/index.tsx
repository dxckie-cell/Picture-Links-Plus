import { logger } from "@vendetta";
import { findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";

/**
 * Runs fn. If it throws, the failure is logged instead of stopping the plugin from loading. A
 * plugin that throws while loading is switched off by the client, so one missing component must
 * not take the others down with it.
 */
function safe<T>(label: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (e) {
        try {
            logger.warn(`[Picture Links] ${label} failed`, e);
        } catch (e2) {
            // the client logger must never break the plugin either
        }
    }
}

const Pressable = safe("find Pressable", () => findByProps("Button", "Text", "View")?.Pressable ?? ReactNative.Pressable);
const ProfileBanner = safe("find ProfileBanner", () => findByName("ProfileBanner", false));
const DisplayBanner = safe("find DisplayBanner", () => findByName("DisplayBanner", false));
const HeaderAvatar = safe("find HeaderAvatar", () => findByName("HeaderAvatar", false));
const openMediaModal = safe("find openMediaModal", () => findByProps("openMediaModal")?.openMediaModal);
const hideActionSheet = safe("find hideActionSheet", () => findByProps("hideActionSheet")?.hideActionSheet);
const getChannelId = safe("find SelectedChannelStore", () => findByStoreName("SelectedChannelStore")?.getChannelId);
const getGuildId = safe("find SelectedGuildStore", () => findByStoreName("SelectedGuildStore")?.getGuildId);

function getImageSize(uri: string): Promise<{width: number, height: number}> {
    return new Promise((resolve, reject) => {
        ReactNative.Image.getSize(
        uri,
        (width, height) => resolve({width, height}),
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
        // Previously this rejection was swallowed, so a tap just did nothing.
        safe("load image size", () => logger.warn(`[Picture Links] Failed to load image size for ${src}`, e));
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

// Returns the full-size URL for a banner plus the untouched original as a fallback.
function resolveBanner(bannerSource: any): { url: string, original: string } | undefined {
    const original = typeof bannerSource === "string" ? bannerSource : bannerSource?.uri;
    if (typeof original !== "string" || !original) return;

    // Only rewrite Discord CDN links. Anything else (e.g. custom banner hosts) is used as-is.
    if (!/^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(original)) {
        return { url: original, original };
    }

    // Drop every query parameter (the old regex broke when the URL had more than just ?size=),
    // then request the largest size.
    const url = `${original.split("?")[0].replace(".webp", ".png")}?size=4096`;
    return { url, original };
}

const unpatches: (() => void)[] = [];

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

// DisplayBanner is the component that renders the banner together with its own tap target.
// If the ProfileBanner patch above is not reached on a given Discord version, hooking that
// tap target directly still makes the banner clickable.
safe("patch DisplayBanner", () => {
    if (!DisplayBanner) throw new Error("DisplayBanner component not found");

    unpatches.push(after("default", DisplayBanner, (_, res) => {
        safe("hook DisplayBanner tap target", () => {
            const wrapper = findInReactTree(res, (x) => x?.accessibilityRole === "image" && x.onPress != null);
            if (!wrapper) return;

            const bannerProps = findInReactTree(wrapper, (x) => x?.bannerSource != null);
            const banner = resolveBanner(bannerProps?.bannerSource);
            if (!banner) return;

            wrapper.onPress = (e) => openModal(banner.url, e?.nativeEvent, banner.original);
        });
    }));
});

//var unpatchGuildIcon

//if (typeof findByName("GuildIcon").prototype.render !== "undefined") {
//    // Compatibility patch with older versions
//    const GuildIcon = findByName("GuildIcon");
//    unpatchGuildIcon = after("render", GuildIcon.prototype, function (_, res) {
//        if (this.props?.size !== "XLARGE") return;
//        const url = this.props?.guild?.getIconURL?.(4096);
//        if (!url) return res;
//
//        return (
//            <Pressable onPress={({ nativeEvent }) => openModal(url, nativeEvent)}>
//                {res}
//            </Pressable>
//        );
//    });
//} else {
//    // Patch for newer versions
//    const GuildIcon = findByName("GuildIcon", false);
//    unpatchGuildIcon = after("default", GuildIcon, ([{ size, guild }], res) => {
//        if (size !== "XLARGE" || guild?.icon == null) return;
//        var ext = "png"
//        if (guild?.icon.includes('a_')) { ext = "gif"; }
//        const url = `https://cdn.discordapp.com/icons/${guild?.id}/${guild?.icon}.${ext}?size=4096`
//
//        return (
//            <Pressable onPress={({ nativeEvent }) => openModal(url, nativeEvent)}>
//                {res}
//            </Pressable>
//        );
//    });
//}

export function onUnload() {
    for (const unpatch of unpatches) unpatch?.();
//    unpatchGuildIcon();
}
