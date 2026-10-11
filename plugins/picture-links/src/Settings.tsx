import { React, ReactNative, clipboard, stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { showToast } from "@vendetta/ui/toasts";

import { KEYS, clearDebug, dlog, dumpDebug, getCounters, hooks, probeComponents } from "./debug";
import { isTracing, scanServerNames, startTrace, stopTrace } from "./servers";

// NOTE: nothing in this file may touch the client (Forms, ReactNative, semanticColors, ...) while
// the module is being evaluated. A throw there stops the whole plugin from loading, which is
// exactly what hides this screen. Everything is looked up lazily, inside the component.

// A small image that always exists, used to test the image viewer without involving any tap target.
const TEST_IMAGE = "https://cdn.discordapp.com/embed/avatars/0.png";

/** Turns the counters into a short reading of what is going wrong. */
function diagnose(counts: Record<string, number>): string {
    if (hooks.loadErrors.length) {
        return `Something failed while the plugin was loading (listed under "Problems while loading" in the report below). ${hooks.loadErrors[0]}`;
    }

    const bannerRenders = (counts[KEYS.bannerRender] ?? 0) + (counts[KEYS.displayBannerRender] ?? 0);
    const bannerTaps = (counts[KEYS.bannerTap] ?? 0) + (counts[KEYS.displayBannerTap] ?? 0);

    if (!bannerRenders) {
        return "No banner has been drawn through the patched components yet. Open a profile that has a banner, come back here and check again. If this stays empty, this Discord version draws banners with a different component than the ones this plugin patches.";
    }
    if (!bannerTaps) {
        return "Banners are being drawn through the patched components, but no banner tap has arrived. Tap a banner, come back here and check again. If it is still zero, something is sitting on top of the banner and taking the touch.";
    }
    return "Banner taps are reaching the plugin. If the image still does not open, look for 'image size failed' lines in the report below.";
}

/** Same idea for server icons and banners, plus what trace mode has seen. */
function diagnoseServers(counts: Record<string, number>): string {
    // counters look like "trace.<Component>.<what it drew>", list each component once
    const traced = [...new Set(
        Object.keys(counts)
            .filter((key) => key.startsWith("trace."))
            .map((key) => key.slice("trace.".length).split(".")[0])
    )];

    const traceNote = traced.length
        ? ` Trace has seen server images drawn by: ${traced.join(", ")}.`
        : hooks.tracing
            ? " Tracing is on but has not seen a server image yet."
            : "";

    return serverVerdict(counts) + traceNote;
}

function serverVerdict(counts: Record<string, number>): string {
    const sum = (suffix: string) =>
        Object.keys(counts)
            .filter((key) => key.startsWith("server.") && key.endsWith(suffix))
            .reduce((total, key) => total + counts[key], 0);

    if (!hooks.serverComponents.length) {
        return "Server icons and banners: no component with a recognised name was found in this Discord version, so nothing was patched. Press \"Scan server components\" and send me the report.";
    }
    if (!sum(".render")) {
        return "Server icons and banners: components were found and patched, but none has been drawn yet. Open a server's profile or banner, come back here and check again.";
    }
    if (!sum(".tap")) {
        return "Server icons and banners: patched components are being drawn, but no tap has arrived. Tap the server icon or banner, come back here and check again. If it stays at zero, check \"noImage\" and the icon \"size=\" counters in the report: they say why a component was left alone.";
    }
    return "Server icons and banners: taps are reaching the plugin.";
}

function toast(message: string) {
    try {
        showToast(message);
    } catch (e) {
        dlog("ui", "toast failed", e);
    }
}

function copyReport() {
    try {
        if (!clipboard?.setString) throw new Error("clipboard is not available");
        clipboard.setString(dumpDebug());
        toast("Copied report");
    } catch (e) {
        dlog("ui", "copy failed", e);
        toast("Could not copy. Long-press the report text to select and copy it instead.");
    }
}

let cachedStyles: any;

/** Theme-aware styles. Falls back to fixed colours if the client has no themed stylesheet. */
function getStyles() {
    if (cachedStyles) return cachedStyles;

    const font = ReactNative.Platform?.select?.({ ios: "Menlo", default: "monospace" });
    const layout = {
        container: { padding: 16, paddingBottom: 48 },
        verdict: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
        heading: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
        button: { padding: 14, borderRadius: 10, marginBottom: 8 },
        buttonLabel: { fontSize: 16, fontWeight: "600" },
        buttonSub: { fontSize: 12, marginTop: 2 },
        report: { fontSize: 11, fontFamily: font },
    };

    try {
        cachedStyles = stylesheet.createThemedStyleSheet({
            container: layout.container,
            verdict: { ...layout.verdict, color: semanticColors.TEXT_NORMAL },
            heading: { ...layout.heading, color: semanticColors.TEXT_MUTED },
            button: { ...layout.button, backgroundColor: semanticColors.BACKGROUND_SECONDARY },
            buttonLabel: { ...layout.buttonLabel, color: semanticColors.TEXT_NORMAL },
            buttonSub: { ...layout.buttonSub, color: semanticColors.TEXT_MUTED },
            report: { ...layout.report, color: semanticColors.TEXT_NORMAL },
        });
    } catch (e) {
        dlog("ui", "themed stylesheet unavailable, using fixed colours", e);
        const text = "#B5BAC1";
        const muted = "#949BA4";
        cachedStyles = ReactNative.StyleSheet.create({
            container: layout.container,
            verdict: { ...layout.verdict, color: text },
            heading: { ...layout.heading, color: muted },
            button: { ...layout.button, backgroundColor: "#2B2D31" },
            buttonLabel: { ...layout.buttonLabel, color: text },
            buttonSub: { ...layout.buttonSub, color: muted },
            report: { ...layout.report, color: text },
        });
    }

    return cachedStyles;
}

export default () => {
    const { ScrollView, Text, View, Pressable, TouchableOpacity } = ReactNative;
    const Touchable = Pressable ?? TouchableOpacity;
    const styles = getStyles();

    const [, setTick] = React.useState(0);
    const refresh = React.useCallback(() => setTick((t: number) => t + 1), []);

    // Keep the screen live so taps made elsewhere show up without pressing anything.
    React.useEffect(() => {
        const id = setInterval(refresh, 1500);
        return () => clearInterval(id);
    }, []);

    const button = (label: string, sub: string | undefined, onPress: () => void) => (
        <Touchable key={label} onPress={onPress} style={styles.button}>
            <Text style={styles.buttonLabel}>{label}</Text>
            {sub ? <Text style={styles.buttonSub}>{sub}</Text> : null}
        </Touchable>
    );

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
            <Text style={styles.heading}>WHAT THIS MEANS</Text>
            <Text style={styles.verdict}>{diagnose(getCounters())}</Text>
            <Text style={styles.verdict}>{diagnoseServers(getCounters())}</Text>

            <Text style={styles.heading}>ACTIONS</Text>
            {button("Copy report", "Copies the report below so you can paste it into a chat", copyReport)}
            {button("Test image viewer", "Opens a sample image without using any banner or avatar tap", () => {
                dlog("test", "Test image viewer pressed");
                if (hooks.openModal) hooks.openModal(TEST_IMAGE);
                else dlog("test", "image viewer is not available because the plugin did not finish loading");
                refresh();
            })}
            {button("Probe components", "Checks which banner and avatar components exist in this client", () => {
                probeComponents();
                refresh();
                toast("Probe finished");
            })}
            {button("Scan server components", "Lists every component with guild or server in its name (can take a few seconds)", () => {
                try {
                    hooks.scanResults = scanServerNames();
                    toast(`Scan found ${hooks.scanResults.length} component(s)`);
                } catch (e) {
                    dlog("scan", "scan failed", e);
                    hooks.scanResults = [`scan failed: ${String(e)}`];
                    toast("Scan failed, see the report");
                }
                refresh();
            })}
            {button(
                isTracing() ? "Stop tracing" : "Start tracing server images",
                isTracing()
                    ? "Tracing is ON. Open a server's sheet, profile and invite, tap around, then come back here and copy the report"
                    : "Watches which components draw server icons and banners. Start it, open those screens, then come back and copy the report",
                () => {
                    try {
                        if (isTracing()) {
                            stopTrace();
                            hooks.tracing = undefined;
                            toast("Tracing stopped");
                        } else {
                            hooks.tracing = startTrace();
                            toast(`Tracing ${hooks.tracing} components`);
                        }
                    } catch (e) {
                        dlog("trace", "toggle failed", e);
                        toast("Tracing failed, see the report");
                    }
                    refresh();
                }
            )}
            {button("Clear report", undefined, () => {
                clearDebug();
                refresh();
            })}

            <Text style={styles.heading}>REPORT</Text>
            <View>
                <Text selectable style={styles.report}>
                    {dumpDebug()}
                </Text>
            </View>
        </ScrollView>
    );
};
