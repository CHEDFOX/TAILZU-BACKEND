/**
 * Windows goes to the Microsoft Store first, once the listing is set.
 *
 * The owner: "the app on microsoft store is published - how do we use that on
 * site also - so it is a trusted version". The installer on /download is
 * unsigned and Windows warns about it; the Store copy is signed by Microsoft
 * and updates itself. Until the Store ID is set, nothing changes.
 */
import { describe, expect, it } from "vitest";
import { SITE_UI, WINDOWS_STORE_ID, windowsStoreUrl } from "../src/experience/catalog.js";
import { downloadPageHtml } from "../src/routes/download.js";

const LISTING = "https://apps.microsoft.com/detail/9nblggh4nns1";

describe("the Store ID", () => {
  it("makes the listing's address from a real Store ID, in any case", () => {
    expect(windowsStoreUrl("9NBLGGH4NNS1")).toBe(LISTING);
    expect(windowsStoreUrl(" 9nblggh4nns1 ")).toBe(LISTING);
  });

  it("is no listing at all when it is not one", () => {
    for (const bad of ["", "8NBLGGH4NNS1", "9NBLGGH4NNS", "9NBLGGH4NNS1X", "Xooteq.Tailzu", "https://evil.example"]) {
      expect(windowsStoreUrl(bad), bad).toBe("");
    }
  });

  it("feeds the site copy, empty until it is set", () => {
    expect(SITE_UI.stores.windows).toBe(windowsStoreUrl(WINDOWS_STORE_ID));
  });
});

describe("/download", () => {
  it("with a listing, Windows gets the Store as the button and the installer as a small link", () => {
    const page = downloadPageHtml(LISTING);
    expect(page).toContain(`var WIN_STORE = "${LISTING}"`);
    expect(page).toContain("Get it from Microsoft Store");
    expect(page).toMatch(/id="alt"[^>]*hidden/);
    expect(page).toMatch(/get Tailzu from the Microsoft Store/);
    // The SmartScreen advice is about the installer only.
    expect(page).toMatch(/installer link is for a PC without the Store/);
  });

  it("without one, it is the page it was", () => {
    const page = downloadPageHtml("");
    expect(page).toContain('var WIN_STORE = ""');
    expect(page).toContain("Windows may show a SmartScreen prompt on first run");
    expect(page).not.toMatch(/get Tailzu from the Microsoft Store/);
  });
});
