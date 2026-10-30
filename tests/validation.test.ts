import { describe, expect, it } from "vitest";
import { botFromInput } from "../src/core/validation.js";

const ID = "AbCdEfGhIjKlMnOpQrStU";
const base = {
  name: "  Release Notes Bot ",
  tagline: "Drafts weekly release notes.",
  category: "engineering",
  authorName: "Ann",
  templateRef: `https://x.ai/bot/${ID}`,
};
const recipeText = JSON.stringify({
  profile: { name: "R", description: "d", avatarShape: "capsule", avatarColor: "teal" },
  skills: [{ name: "s", content: "do it" }],
});

function ok(input: unknown) {
  const r = botFromInput(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.errors.join("; ")}`);
  return r.bot;
}
function errs(input: unknown): string[] {
  const r = botFromInput(input);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
}

describe("botFromInput", () => {
  it("accepts a template submission and normalizes fields", () => {
    const bot = ok({ ...base, tags: " Release, notes ,release,, GitHub ", authorUrl: "", imageUrl: "  " });
    expect(bot).toEqual({
      name: "Release Notes Bot",
      tagline: "Drafts weekly release notes.",
      descriptionMd: "",
      category: "engineering",
      tags: ["release", "notes", "github"],
      authorName: "Ann",
      authorUrl: null,
      avatarShape: null,
      avatarColor: null,
      imageUrl: null,
      templateId: ID,
      recipe: null,
      sourceUrl: null,
      homepageUrl: null,
    });
  });

  it("accepts tags as an array", () => {
    expect(ok({ ...base, tags: ["A", "b", "a"] }).tags).toEqual(["a", "b"]);
  });

  it("accepts a bare id and deep links as templateRef", () => {
    expect(ok({ ...base, templateRef: ID }).templateId).toBe(ID);
    expect(ok({ ...base, templateRef: `grokbot://app/v1/bot-template?id=${ID}` }).templateId).toBe(ID);
  });

  it("rejects an unparseable templateRef", () => {
    expect(errs({ ...base, templateRef: "https://example.com/nope" })).toContain(
      "templateRef: not a Grok Bot template link or id",
    );
  });

  it("requires a template or a recipe", () => {
    expect(errs({ ...base, templateRef: "" })).toContain("Provide a template link or a recipe");
    expect(errs({ ...base, templateRef: undefined })).toContain("Provide a template link or a recipe");
  });

  it("parses recipeText and copies avatar from the recipe profile", () => {
    const bot = ok({ ...base, templateRef: "", recipeText });
    expect(bot.templateId).toBeNull();
    expect(bot.recipe?.profile.name).toBe("R");
    expect(bot.recipe?.skills).toHaveLength(1);
    expect(bot.avatarShape).toBe("capsule");
    expect(bot.avatarColor).toBe("teal");
  });

  it("keeps explicit avatar fields over the recipe profile", () => {
    const bot = ok({ ...base, templateRef: "", recipeText, avatarShape: "pebble", avatarColor: "" });
    expect(bot.avatarShape).toBe("pebble");
    expect(bot.avatarColor).toBe("teal");
  });

  it("accepts a recipe object (JSON API)", () => {
    const bot = ok({ ...base, templateRef: undefined, recipe: JSON.parse(recipeText) });
    expect(bot.recipe?.format).toBe("grokbot-recipe/v1");
  });

  it("prefixes recipe errors with recipe:", () => {
    const e = errs({ ...base, templateRef: "", recipeText: "{nope" });
    expect(e.some((m) => m.startsWith("recipe: not valid JSON"))).toBe(true);
    const e2 = errs({ ...base, templateRef: "", recipeText: JSON.stringify({ profile: {} }) });
    expect(e2.some((m) => m.startsWith("recipe: profile.name"))).toBe(true);
  });

  it("reports field errors with the field name", () => {
    const e = errs({ ...base, name: "", category: "nope", authorName: "x".repeat(81) });
    expect(e.some((m) => m.startsWith("name:"))).toBe(true);
    expect(e.some((m) => m.startsWith("category:"))).toBe(true);
    expect(e.some((m) => m.startsWith("authorName:"))).toBe(true);
  });

  it("enforces tag limits", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`).join(",");
    expect(errs({ ...base, tags: eleven }).some((m) => m.startsWith("tags:"))).toBe(true);
    expect(errs({ ...base, tags: "x".repeat(33) }).some((m) => m.startsWith("tags:"))).toBe(true);
  });

  it("only allows https URLs", () => {
    expect(errs({ ...base, authorUrl: "http://example.com" }).some((m) => m.startsWith("authorUrl:"))).toBe(true);
    expect(errs({ ...base, imageUrl: "javascript:alert(1)" }).some((m) => m.startsWith("imageUrl:"))).toBe(true);
    expect(ok({ ...base, homepageUrl: " https://example.com/x " }).homepageUrl).toBe("https://example.com/x");
  });

  it("limits description length", () => {
    expect(errs({ ...base, descriptionMd: "x".repeat(20001) }).some((m) => m.startsWith("descriptionMd:"))).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(botFromInput(null).ok).toBe(false);
    expect(botFromInput("x").ok).toBe(false);
  });
});

describe("botFromInput error aggregation", () => {
  it("reports recipe and template errors alongside field errors", () => {
    const e = errs({ ...base, category: "nope", templateRef: "bad", recipeText: "{nope" });
    expect(e.some((m) => m.startsWith("category:"))).toBe(true);
    expect(e).toContain("templateRef: not a Grok Bot template link or id");
    expect(e.some((m) => m.startsWith("recipe: not valid JSON"))).toBe(true);
  });
});

describe("deeply nested recipe object", () => {
  it("is rejected with a validation error instead of throwing", () => {
    let deep: unknown = {};
    for (let i = 0; i < 200_000; i++) deep = { a: deep };
    const r = botFromInput({ ...base, recipe: deep });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("; ")).toMatch(/nested too deeply/);
  });
});
