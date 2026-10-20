import { findAll } from "@vendetta/metro";
import { React, ReactNative, clipboard, stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { showToast } from "@vendetta/ui/toasts";

import { clearLog, countEnding, info, note, report, short } from "./log";

// Nothing in this file may touch the client while the module is being evaluated: a throw there
// stops the whole plugin from loading and hides this screen. Everything is looked up lazily,
// inside the component or the button handlers.

/** A short reading of what the counters say about profile banners. */
function verdict(): string {
    if (info.errors.some((e) => e.startsWith("patch profile banners"))) {
        return "No profile banner component was found, so banners cannot be made tappable. Press \"Scan banner components\" and send me the report.";
    }
    const renders = countEnding(".render") + countEnding(".banner");
    const wrapped = countEnding(".wrapped") + countEnding(".banner");
    const taps = countEnding(".tap");

    if (!renders) return "Profile banner components were found and patched, but none has been drawn yet. Open a profile that has a banner, come back here and check again.";
    if (!wrapped) return "Banner components are being drawn, but none was given a banner image I can use. Open a profile that has a banner, come back here and check again; if it stays like this, send me the report (it shows what the component receives).";
    if (!taps) return "Banners are drawn and made tappable, but no tap has arrived. Tap a banner, come back here and check again. If it stays at zero, something is covering the banner and taking the touch.";
    return "Banner taps are reaching the plugin. If the image still does not open, look for \"image failed to load\" in the report.";
}

/** Components that mention banner/profile, patched or not: the names to look at when nothing works. */
function scan(): string[] {
    const modules = findAll((m: any) => {
        try {
            if (!m || typeof m !== "object" || !m.default) return false;
            const c = m.default;
            return [c?.name, c?.displayName, c?.type?.name, c?.type?.displayName, c?.render?.name].some(
                (n) => typeof n === "string" && /banner|profile.*(header|hero|cover)/i.test(n)
            );
        } catch (e) {
            return false;
        }
    }).filter(Boolean);

    const lines = new Set<string>();
    for (const mod of modules) {
        const c = mod.default;
        const name = [c?.name, c?.displayName, c?.type?.name, c?.type?.displayName, c?.render?.name].find((n) => typeof n === "string" && /banner|profile.*(header|hero|cover)/i.test(n)) ?? "?";
        const kind = typeof c === "function" ? "function" : c?.type ? "memo" : c?.render ? "forwardRef" : "object";
        lines.add(`${name} [${kind}]`);
    }
    return [...lines].sort();
}

function toast(message: string) {
    try {
        showToast(message);
    } catch (e) {
        note(`toast failed: ${short(e)}`);
    }
}

let cachedStyles: any;

function getStyles() {
    if (cachedStyles) return cachedStyles;

    const font = ReactNative.Platform?.select?.({ ios: "Menlo", default: "monospace" });
    const layout = {
        container: { padding: 16, paddingBottom: 48 },
        verdict: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
        heading: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
        button: { padding: 14, borderRadius: 10, marginBottom: 8 },
        buttonLabel: { fontSize: 16, fontWeight: "600" },
        report: { fontSize: 11, fontFamily: font },
    };

    try {
        cachedStyles = stylesheet.createThemedStyleSheet({
            container: layout.container,
            verdict: { ...layout.verdict, color: semanticColors.TEXT_NORMAL },
            heading: { ...layout.heading, color: semanticColors.TEXT_MUTED },
            button: { ...layout.button, backgroundColor: semanticColors.BACKGROUND_SECONDARY },
            buttonLabel: { ...layout.buttonLabel, color: semanticColors.TEXT_NORMAL },
            report: { ...layout.report, color: semanticColors.TEXT_NORMAL },
        });
    } catch (e) {
        const text = "#B5BAC1";
        cachedStyles = ReactNative.StyleSheet.create({
            container: layout.container,
            verdict: { ...layout.verdict, color: text },
            heading: { ...layout.heading, color: "#949BA4" },
            button: { ...layout.button, backgroundColor: "#2B2D31" },
            buttonLabel: { ...layout.buttonLabel, color: text },
            report: { ...layout.report, color: text },
        });
    }
    return cachedStyles;
}

export default () => {
    const { ScrollView, Text, Pressable, TouchableOpacity } = ReactNative;
    const Touchable = Pressable ?? TouchableOpacity;
    const styles = getStyles();

    const [, setTick] = React.useState(0);
    const refresh = React.useCallback(() => setTick((t: number) => t + 1), []);

    // keep the screen live, so taps made elsewhere show up without pressing anything
    React.useEffect(() => {
        const id = setInterval(refresh, 1500);
        return () => clearInterval(id);
    }, []);

    const button = (label: string, onPress: () => void) => (
        <Touchable key={label} onPress={onPress} style={styles.button}>
            <Text style={styles.buttonLabel}>{label}</Text>
        </Touchable>
    );

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
            <Text style={styles.heading}>WHAT THIS MEANS</Text>
            <Text style={styles.verdict}>{verdict()}</Text>

            <Text style={styles.heading}>ACTIONS</Text>
            {button("Copy report", () => {
                try {
                    clipboard.setString(report());
                    toast("Copied report");
                } catch (e) {
                    toast("Could not copy. Long-press the report text to select it instead.");
                }
            })}
            {button("Scan banner components", () => {
                try {
                    info.scan = scan();
                    toast(`Scan found ${info.scan.length} component(s)`);
                } catch (e) {
                    info.scan = [`scan failed: ${short(e)}`];
                    toast("Scan failed, see the report");
                }
                refresh();
            })}
            {button("Clear report", () => {
                clearLog();
                refresh();
            })}

            <Text style={styles.heading}>REPORT</Text>
            <Text selectable style={styles.report}>
                {report()}
            </Text>
        </ScrollView>
    );
};
