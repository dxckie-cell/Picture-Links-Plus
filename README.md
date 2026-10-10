# Picture Links Plus

Allows you to click on profile pictures and banners to open them full size.

Based on [Picture Links](https://github.com/Rico040/bunny-plugins/tree/master/plugins/picture-links) by redstonekasi and Rico040 (CC0). Credits go to the original developers.

## How to install?

Copy & paste the plugin URL into the Plugins page of your client:

> https://dxckie-cell.github.io/Picture-Links-Plus/picture-links/

(Requires GitHub Pages to be enabled for this repo: Settings → Pages → deploy from the `gh-pages` branch. The `Build and deploy` workflow creates that branch on the first push to `main`.)

## What's different from the original?

Profile banners could not be tapped while profile pictures could. Changes:

- Banner links are now built by stripping the whole query string instead of a regex that only handled a trailing `?size=`. URLs with extra parameters used to turn into a malformed link, so loading its size failed and the tap silently did nothing.
- Failed image loads are no longer swallowed: they are logged, and the original banner URL is tried as a fallback.
- `bannerSource` can be a string or an object, and non-Discord banner hosts (such as custom banner providers) are left untouched.
- The banner's own tap target in `DisplayBanner` is also hooked, so the banner is clickable even if the `ProfileBanner` patch is not reached on a given Discord version.
- A missing component no longer crashes the plugin at load (which would also have taken avatar clicking down with it); a warning is logged instead.

## Debug screen

If banners still don't open, open the plugin's settings page. It has its own built-in debug report, so you don't need access to the client's logs:

- A short explanation of what the counters mean (for example, whether banners are being drawn through the patched components, and whether any banner tap arrived).
- **Test image viewer** opens a sample image without using any banner or avatar tap, to separate "the viewer is broken" from "the tap never arrives".
- **Probe components** checks which banner and avatar components exist in your Discord version.
- **Copy report** copies everything so you can paste it into a chat or an issue.

To collect a useful report: open a profile with a banner, tap the banner, then open the plugin's settings.

For now the plugin also shows a small toast every time it starts: "Picture Links Plus loaded", or a note that something went wrong while loading (the details are then listed under "Problems while loading" in the report). If you never see that toast, your client is still running an older copy of the plugin: remove it and install it again from the URL above.

## Building

```sh
pnpm install
node build.mjs   # output goes to dist/
```
