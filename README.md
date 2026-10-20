# Picture Links+

Tap profile pictures, profile banners, and server icons and banners to view them full size.

Based on [Picture Links](https://github.com/Rico040/bunny-plugins/tree/master/plugins/picture-links) by redstonekasi and Rico040 (CC0). Credits go to the original developers.

## Install

Copy & paste the plugin URL into the Plugins page of your client:

> https://dxckie-cell.github.io/Picture-Links-Plus/picture-links/

GitHub Pages must be enabled for this repo (Settings → Pages → "Deploy from a branch", branch `gh-pages`, folder `/ (root)`). After a push, wait for both the `Build and deploy` and `pages build and deployment` runs in the Actions tab; your client keeps the copy it downloaded, so remove and reinstall the plugin to update.

## What's different from the original?

- **Profile banners open again.** The old code built the full-size banner link with a regex that only handled a trailing `?size=`; any extra parameter produced a broken link and the tap silently did nothing. The whole query string is now replaced, failed image loads are logged, and the original link is tried as a fallback.
- **Server icons and banners.** Tap the large server icon in the server menu to open the icon, or the header's banner area to open the banner (animated ones open as GIFs). On Discord 343 these are the `GuildIconInner` and `GuildActionSheetHeader` components. Small icons (the server list, pickers) are left alone.
- **Survives Discord updates.** Banners (users and bots) are caught as the app draws them, by their image link or a banner-named prop, so they keep working when Discord renames the banner component (as it did in 349).
- **Safe loading.** Every lookup and patch is guarded, so a component that is missing in your Discord version is logged instead of making the client switch the whole plugin off.

## Building

```sh
pnpm install
node build.mjs   # output goes to dist/
```
