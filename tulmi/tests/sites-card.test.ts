/**
 * THE SIGN-IN CARD READ OFF A PAGE (src/sites/card.ts) and filled through the panel (src/sites/panel.ts fill).
 *
 * Two things are being held here, and the second is the one that matters. The first is that a page which plainly
 * asks for a sign-in becomes boxes with names and kinds. The second is that everything else does NOT: the ids are
 * positions in a walk of the page, so a page that moved has a different box under the same name, and a card drawn
 * over the wrong page would type somebody's password into a box that shows it. A refusal here is the safe answer
 * and the common one — the panel then draws the page, which always works.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; });

const { cardFor } = await import("../src/sites/card.js");
type El = Parameters<typeof cardFor>[0][number];

const el = (id: string, role: string, label?: string): El => ({ id, role, ...(label ? { label } : {}) }) as El;

describe("reading a card off a page", () => {
  it("names the boxes and says what each one is for", () => {
    const card = cardFor([
      el("e1", "link", "Home"),
      el("e2", "field", "Email address"),
      el("e3", "secret", "Password"),
      el("e4", "button", "Sign in"),
    ])!;
    expect(card.fields).toEqual([
      { id: "e2", kind: "email", label: "Email address" },
      { id: "e3", kind: "secret", label: "Password" },
    ]);
    expect(card.submit).toEqual({ id: "e4", label: "Sign in" });
  });

  it("knows a phone, a one-time code and a password apart", () => {
    const card = cardFor([el("e1", "field", "Mobile number"), el("e2", "field", "Enter OTP"), el("e3", "secret", "Password")])!;
    expect(card.fields.map((f) => f.kind)).toEqual(["phone", "code", "secret"]);
  });

  // A password box is known by its ROLE, which the page reader sets from type="password" — never by its name,
  // because a box called "Password" that is not one would show what was typed into it.
  it("takes secret from the role and not from the words", () => {
    const [a] = cardFor([el("e1", "field", "Password"), el("e2", "secret", "PIN")])!.fields;
    expect(a).toEqual({ id: "e1", kind: "text", label: "Password" });
    expect(cardFor([el("e1", "secret")])!.fields[0]).toMatchObject({ kind: "secret", label: "Password" });
  });

  it("offers the other ways in the page offers", () => {
    const card = cardFor([el("e1", "secret", "Password"), el("e2", "button", "Continue with Google"), el("e3", "link", "Use email instead")])!;
    expect(card.also).toEqual([{ id: "e2", label: "Continue with Google" }, { id: "e3", label: "Use email instead" }]);
  });

  describe("and refusing to, which is the common answer", () => {
    it("says nothing about a page with no boxes", () => {
      expect(cardFor([el("e1", "button", "Order now"), el("e2", "link", "Offers")])).toBeNull();
    });

    it("says nothing about a page that is a form rather than a sign-in", () => {
      const many = Array.from({ length: 7 }, (_, i) => el(`e${i + 1}`, "field", `Box ${i + 1}`));
      expect(cardFor(many)).toBeNull();
    });

    it("says nothing about one lone box that could be a search", () => {
      expect(cardFor([el("e1", "field", "Search for restaurants")])).toBeNull();
      // The same box, with a way to send it, is the first step of a sign-in.
      expect(cardFor([el("e1", "field", "Phone number"), el("e2", "button", "Send OTP")])).not.toBeNull();
    });

    it("says nothing when the page did not name its boxes", () => {
      expect(cardFor([el("e1", "field"), el("e2", "field")])).toBeNull();
    });
  });
});
