/**
 * The desktop app in the Microsoft Store, and the installer the site links to.
 */

/**
 * THE WINDOWS APP'S MICROSOFT STORE LISTING, BY ITS STORE ID.
 *
 * The installer on /download is not signed, so Windows meets it with a
 * SmartScreen warning that asks people to click "Run anyway" — the one thing
 * a careful person should not do. The Store copy is checked and signed by
 * Microsoft, installs without a warning and keeps itself up to date (the
 * desktop app already skips its own update card there). So wherever the site
 * offers a Windows download, it is the certified build (windowsInstallerUrl),
 * downloaded right there, and our own installer is only the fallback.
 *
 * The ID is the 12 characters in Partner Center > the app > Product identity
 * > Store ID (or at the end of the listing's own link), starting with 9. ""
 * until it is set, and anything that is not a Store ID is treated the same:
 * every reader then falls back to the installer, as before.
 */
export const WINDOWS_STORE_ID = "9N3GX0XHQ7MX";

const storeId = (id: string) => {
  const s = String(id ?? "").trim().toUpperCase();
  return /^9[0-9A-Z]{11}$/.test(s) ? s : "";
};

/** The listing's web address, for search engines and anyone who asks; "" for no listing. */
export function windowsStoreUrl(id: string): string {
  const s = storeId(id);
  return s ? `https://apps.microsoft.com/detail/${s.toLowerCase()}` : "";
}

/**
 * THE CERTIFIED BUILD, DOWNLOADED STRAIGHT FROM THE BUTTON.
 *
 * Not a trip to the Store: the owner wanted the download button to give the
 * certified copy directly. This is Microsoft's own "direct" install (the
 * address their official badge fetches, microsoft/app-store-badge): one
 * click downloads "Tailzu Installer.exe", a small installer signed by
 * Microsoft, which installs the Store-certified Tailzu without opening the
 * Store, works where the Store app is old or missing, and leaves an install
 * that updates itself. No SmartScreen warning, because nothing in it is ours
 * to vouch for. "" for no listing.
 */
export function windowsInstallerUrl(id: string): string {
  const s = storeId(id);
  return s ? `https://get.microsoft.com/installer/download/${s}?referrer=appbadge&source=x0bot.com` : "";
}
