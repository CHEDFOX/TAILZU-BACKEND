/**
 * The Windows download is the Microsoft-certified build, downloaded straight
 * from the button.
 *
 * The owner, first: "the app on microsoft store is published - how do we use
 * that on site also - so it is a trusted version". Then, of a button that
 * opened the Store: "no no - not sending to the store - directly downloading
 * the certified version from the site". So the button downloads Microsoft's
 * signed installer for the Store build (the address their own badge uses in
 * direct mode); the listing is only cited, never the destination.
 */
import { describe, expect, it } from "vitest";
import { SITE_UI, WINDOWS_STORE_ID, windowsInstallerUrl, windowsStoreUrl } from "../src/experience/catalog.js";
import { downloadPageHtml } from "../src/routes/download.js";
import { GETS } from "../src/seo/pages.js";

const ID = "9NBLGGH4NNS1";
const DL = `https://get.microsoft.com/installer/download/${ID}?referrer=appbadge&source=tailzu.space`;

describe("the Store ID", () => {
  it("makes the certified download and the listing from a real Store ID, in any case", () => {
    expect(windowsInstallerUrl(ID)).toBe(DL);
    expect(windowsInstallerUrl(" 9nblggh4nns1 ")).toBe(DL);
    expect(windowsStoreUrl(ID)).toBe("https://apps.microsoft.com/detail/9nblggh4nns1");
  });

  it("is nothing at all when it is not one", () => {
    for (const bad of ["", "8NBLGGH4NNS1", "9NBLGGH4NNS", "9NBLGGH4NNS1X", "Xooteq.Tailzu", "https://evil.example"]) {
      expect(windowsInstallerUrl(bad), bad).toBe("");
      expect(windowsStoreUrl(bad), bad).toBe("");
    }
  });

  it("is Tailzu's, and feeds the site copy", () => {
    expect(WINDOWS_STORE_ID).toBe("9N3GX0XHQ7MX");
    expect(SITE_UI.stores.windowsInstaller).toBe(windowsInstallerUrl(WINDOWS_STORE_ID));
    expect(SITE_UI.stores.windows).toBe(windowsStoreUrl(WINDOWS_STORE_ID));
  });
});

describe("/download", () => {
  it("on Windows the button IS the certified download, and our installer a small link", () => {
    const page = downloadPageHtml(DL);
    expect(page).toContain(`var WIN_DL = "${DL}"`);
    expect(page).toContain('main.textContent = "Download for Windows"');
    expect(page).toContain("Certified by Microsoft");
    expect(page).toMatch(/id="alt"[^>]*hidden/);
    // Never a trip to the Store.
    expect(page).not.toMatch(/apps\.microsoft\.com|ms-windows-store:|Get it from Microsoft Store/);
    // The SmartScreen advice is about our own installer only.
    expect(page).toMatch(/standalone installer is for a PC where that one can't run/);
  });

  it("without a Store ID, it is the page it was", () => {
    const page = downloadPageHtml("");
    expect(page).toContain('var WIN_DL = ""');
    expect(page).toContain("Windows may show a SmartScreen prompt on first run");
    expect(page).not.toMatch(/The Windows download is the Microsoft-certified build/);
  });
});

describe("the search pages", () => {
  it("download the certified build for Windows rather than opening the Store", () => {
    expect(GETS).toContain(`href="${SITE_UI.stores.windowsInstaller}">Windows</a>`);
    expect(GETS).not.toContain("apps.microsoft.com");
  });
});
