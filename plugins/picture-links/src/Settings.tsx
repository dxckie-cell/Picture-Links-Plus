import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { KEYS, clearDebug, dlog, dumpDebug, getCounters, probeComponents } from "./debug";
import { openModal } from "./index";

const { FormSection, FormRow } = Forms;
const { ScrollView, Text, View } = ReactNative;

// A small image that always exists, used to test the image viewer without involving any tap target.
const TEST_IMAGE = "https://cdn.discordapp.com/embed/avatars/0.png";

/** Turns the counters into a one-paragraph reading of what is going wrong. */
function diagnose(counts: Record<string, number>): string {
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

export default () => {
    const [, setTick] = React.useState(0);
    const refresh = React.useCallback(() => setTick((t: number) => t + 1), []);

    // Keep the screen live so taps made elsewhere show up without pressing anything.
    React.useEffect(() => {
        const id = setInterval(refresh, 1500);
        return () => clearInterval(id);
    }, []);

    const textColor = semanticColors?.TEXT_NORMAL;
    const mono = ReactNative.Platform.select({ ios: "Menlo", default: "monospace" });

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <FormSection title="What this means">
                <View style={{ padding: 16 }}>
                    <Text style={{ color: textColor }}>{diagnose(getCounters())}</Text>
                </View>
            </FormSection>

            <FormSection title="Actions">
                <FormRow
                    label="Copy report"
                    subLabel="Copies the report below so you can paste it into a chat"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_copy_message_link")} />}
                    onPress={() => {
                        clipboard.setString(dumpDebug());
                        showToast("Copied report", getAssetIDByName("Check"));
                    }}
                />
                <FormRow
                    label="Test image viewer"
                    subLabel="Opens a sample image without using any banner or avatar tap"
                    onPress={() => {
                        dlog("test", "Test image viewer pressed");
                        openModal(TEST_IMAGE);
                    }}
                />
                <FormRow
                    label="Probe components"
                    subLabel="Checks which banner and avatar components exist in this client"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_message_retry")} />}
                    onPress={() => {
                        probeComponents();
                        refresh();
                        showToast("Probe finished");
                    }}
                />
                <FormRow
                    label="Clear report"
                    onPress={() => {
                        clearDebug();
                        refresh();
                    }}
                />
            </FormSection>

            <FormSection title="Report">
                <View style={{ padding: 16 }}>
                    <Text selectable style={{ color: textColor, fontSize: 11, fontFamily: mono }}>
                        {dumpDebug()}
                    </Text>
                </View>
            </FormSection>
        </ScrollView>
    );
};
