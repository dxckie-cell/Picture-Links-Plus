# Picture Links Plus

Allows you to click on profile pictures and banners to open them full size.

Based on [Picture Links](https://github.com/Rico040/bunny-plugins/tree/master/plugins/picture-links) by redstonekasi and Rico040 (CC0). Credits go to the original developers.

## How to install?

Copy & paste the plugin URL into the Plugins page of your client:

> https://dxckie-cell.github.io/Picture-Links-Plus/picture-links/

(Requires GitHub Pages to be enabled for this repo: Settings → Pages → source "Deploy from a branch", branch `gh-pages`, folder `/ (root)`. The `Build and deploy` workflow creates that branch on the first push to `main`.)

**Updates are not live until GitHub Pages has published them.** After a push, the `Build and deploy` run only builds the plugin; a second run called `pages build and deployment` then publishes it, which usually takes about a minute. Check the Actions tab: the update is live once both have finished. Your client keeps the copy it already downloaded, so after an update remove the plugin and install it again from the URL.

## What's different from the original?

Profile banners could not be tapped while profile pictures could. Changes:

- Banner links are now built by stripping the whole query string instead of a regex that only handled a trailing `?size=`. URLs with extra parameters used to turn into a malformed link, so loading its size failed and the tap silently did nothing.
- Failed image loads are no longer swallowed: they are logged, and the original banner URL is tried as a fallback.
- `bannerSource` can be a string or an object, and non-Discord banner hosts (such as custom banner providers) are left untouched.
- The banner's own tap target in `DisplayBanner` is also hooked, so the banner is clickable even if the `ProfileBanner` patch is not reached on a given Discord version.
- Nothing can throw while the plugin loads. Every lookup and patch is guarded, so a missing component is logged instead of making the client switch the whole plugin off.
- **Server icons and banners** (experimental). Discord does not give these components stable names, so at startup the plugin looks through Discord's modules for components named like a server icon or banner (`GuildIcon`, `GuildBanner`, `ServerBanner…`) and makes them tappable. A component is only touched when a real server image URL can be worked out for it, and server icons are only made tappable at their large size, so the server list keeps working normally. Animated icons and banners open as GIFs.

## Debug screen

The plugin's settings page is a built-in debug report, so you don't need access to the client's logs:

- A short explanation of what the counters mean, for user banners and for server icons and banners separately.
- **Test image viewer** opens a sample image without using any tap target.
- **Probe components** checks which banner and avatar components exist in your Discord version.
- **Scan server components** lists every component with "guild" or "server" in its name and marks the ones the plugin patched. Use this if server icons or banners don't open.
- **Copy report** copies everything so you can paste it into a chat or an issue.

To collect a useful report: open a server's profile, tap its icon and banner, then open the plugin's settings, press **Scan server components** and **Copy report**.

## Building

```sh
pnpm install
node build.mjs   # output goes to dist/
```
