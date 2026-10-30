import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { CATEGORIES, type Category } from "../core/categories.js";
import type { Recipe } from "../core/recipe.js";
import { MAX_SLUG_LENGTH, slugify } from "../core/slug.js";
export type { Category, Recipe };

export type Bot = {
  slug: string;
  name: string;
  tagline: string;
  descriptionMd: string;
  category: Category;
  tags: string[];
  authorName: string;
  authorUrl: string | null;
  avatarShape: string | null;
  avatarColor: string | null;
  imageUrl: string | null;
  templateId: string | null;
  recipe: Recipe | null;
  sourceUrl: string | null;
  homepageUrl: string | null;
  status: "published" | "pending";
  featured: boolean;
  installClicks: number;
  upvotes: number;
  createdAt: string;
  updatedAt: string;
};

export type NewBot = Omit<
  Bot,
  "installClicks" | "upvotes" | "createdAt" | "updatedAt" | "featured" | "status" | "slug"
> & { slug?: string; status?: Bot["status"]; featured?: boolean };

export type FilterOpts = {
  status?: Bot["status"] | "all";
  category?: Category;
  q?: string;
  featured?: boolean;
};
export type ListOpts = FilterOpts & {
  sort?: "new" | "top" | "installs";
  limit?: number;
  offset?: number;
};

type Row = Record<string, SQLInputValue>;

function fromRow(r: Row): Bot {
  return {
    slug: r.slug as string,
    name: r.name as string,
    tagline: r.tagline as string,
    descriptionMd: r.description_md as string,
    category: r.category as Category,
    tags: JSON.parse(r.tags_json as string) as string[],
    authorName: r.author_name as string,
    authorUrl: r.author_url as string | null,
    avatarShape: r.avatar_shape as string | null,
    avatarColor: r.avatar_color as string | null,
    imageUrl: r.image_url as string | null,
    templateId: r.template_id as string | null,
    recipe: r.recipe_json ? (JSON.parse(r.recipe_json as string) as Recipe) : null,
    sourceUrl: r.source_url as string | null,
    homepageUrl: r.homepage_url as string | null,
    status: r.status as Bot["status"],
    featured: r.featured === 1,
    installClicks: r.install_clicks as number,
    upvotes: r.upvotes as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

const ORDER: Record<NonNullable<ListOpts["sort"]>, string> = {
  new: "created_at DESC, rowid DESC",
  top: "upvotes DESC, created_at DESC, rowid DESC",
  installs: "install_clicks DESC, created_at DESC, rowid DESC",
};

export class BotsRepo {
  constructor(
    private db: DatabaseSync,
    private now: () => Date = () => new Date(),
  ) {}

  private where(opts: FilterOpts): { sql: string; params: SQLInputValue[] } {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    const status = opts.status ?? "published";
    if (status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    if (opts.category) {
      clauses.push("category = ?");
      params.push(opts.category);
    }
    if (opts.featured !== undefined) {
      clauses.push("featured = ?");
      params.push(opts.featured ? 1 : 0);
    }
    if (opts.q && opts.q.trim()) {
      const like = `%${opts.q.trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(
        "(lower(name) LIKE ? ESCAPE '\\' OR lower(tagline) LIKE ? ESCAPE '\\' OR lower(tags_json) LIKE ? ESCAPE '\\')",
      );
      params.push(like, like, like);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  list(opts: ListOpts = {}): Bot[] {
    const { sql, params } = this.where(opts);
    const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
    const rows = this.db
      .prepare(`SELECT * FROM bots ${sql} ORDER BY ${ORDER[opts.sort ?? "new"]} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Row[];
    return rows.map(fromRow);
  }

  count(opts: FilterOpts = {}): number {
    const { sql, params } = this.where(opts);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM bots ${sql}`).get(...params) as { n: number };
    return r.n;
  }

  get(slug: string): Bot | null {
    const r = this.db.prepare("SELECT * FROM bots WHERE slug = ?").get(slug) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  private freeSlug(base: string): string {
    const exists = this.db.prepare("SELECT 1 FROM bots WHERE slug = ?");
    if (!exists.get(base)) return base;
    for (let i = 2; ; i++) {
      // Trim the base so base-N stays within the slug length limit (and importable as catalog JSON).
      const suffix = `-${i}`;
      const stem = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "") || "bot";
      const candidate = `${stem}${suffix}`;
      if (!exists.get(candidate)) return candidate;
    }
  }

  private writeNew(slug: string, bot: NewBot): void {
    const ts = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO bots (slug, name, tagline, description_md, category, tags_json, author_name, author_url,
          avatar_shape, avatar_color, image_url, template_id, recipe_json, source_url, homepage_url,
          status, featured, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        slug,
        bot.name,
        bot.tagline,
        bot.descriptionMd,
        bot.category,
        JSON.stringify(bot.tags),
        bot.authorName,
        bot.authorUrl,
        bot.avatarShape,
        bot.avatarColor,
        bot.imageUrl,
        bot.templateId,
        bot.recipe ? JSON.stringify(bot.recipe) : null,
        bot.sourceUrl,
        bot.homepageUrl,
        bot.status ?? "published",
        bot.featured ? 1 : 0,
        ts,
        ts,
      );
  }

  insert(bot: NewBot): Bot {
    const slug = this.freeSlug(bot.slug || slugify(bot.name));
    this.writeNew(slug, bot);
    return this.get(slug) as Bot;
  }

  update(slug: string, patch: Partial<NewBot>): Bot | null {
    const cur = this.get(slug);
    if (!cur) return null;
    const { slug: _ignored, ...rest } = patch;
    const m = { ...cur, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) } as Bot;
    this.db
      .prepare(
        `UPDATE bots SET name=?, tagline=?, description_md=?, category=?, tags_json=?, author_name=?, author_url=?,
          avatar_shape=?, avatar_color=?, image_url=?, template_id=?, recipe_json=?, source_url=?, homepage_url=?,
          status=?, featured=?, updated_at=? WHERE slug=?`,
      )
      .run(
        m.name,
        m.tagline,
        m.descriptionMd,
        m.category,
        JSON.stringify(m.tags),
        m.authorName,
        m.authorUrl,
        m.avatarShape,
        m.avatarColor,
        m.imageUrl,
        m.templateId,
        m.recipe ? JSON.stringify(m.recipe) : null,
        m.sourceUrl,
        m.homepageUrl,
        m.status,
        m.featured ? 1 : 0,
        this.now().toISOString(),
        slug,
      );
    return this.get(slug);
  }

  delete(slug: string): boolean {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM events WHERE slug = ?").run(slug);
      const n = Number(this.db.prepare("DELETE FROM bots WHERE slug = ?").run(slug).changes);
      this.db.exec("COMMIT");
      return n > 0;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  setStatus(slug: string, status: Bot["status"]): void {
    this.db
      .prepare("UPDATE bots SET status = ?, updated_at = ? WHERE slug = ?")
      .run(status, this.now().toISOString(), slug);
  }

  setFeatured(slug: string, featured: boolean): void {
    this.db
      .prepare("UPDATE bots SET featured = ?, updated_at = ? WHERE slug = ?")
      .run(featured ? 1 : 0, this.now().toISOString(), slug);
  }

  recordEvent(slug: string, kind: "install" | "upvote", visitorHash: string): boolean {
    if (!this.db.prepare("SELECT 1 FROM bots WHERE slug = ?").get(slug)) return false;
    const day = this.now().toISOString().slice(0, 10);
    const col = kind === "install" ? "install_clicks" : "upvotes";
    this.db.exec("BEGIN");
    try {
      const r = this.db
        .prepare("INSERT OR IGNORE INTO events (slug, kind, visitor_hash, day) VALUES (?,?,?,?)")
        .run(slug, kind, visitorHash, day);
      if (Number(r.changes) === 0) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db.prepare(`UPDATE bots SET ${col} = ${col} + 1 WHERE slug = ?`).run(slug);
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  categoryCounts(): Record<Category, number> {
    const out = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<Category, number>;
    const rows = this.db
      .prepare("SELECT category, COUNT(*) AS n FROM bots WHERE status = 'published' GROUP BY category")
      .all() as { category: Category; n: number }[];
    for (const r of rows) if (r.category in out) out[r.category] = r.n;
    return out;
  }

  upsertFromCatalog(bot: NewBot & { slug: string }): Bot {
    if (!this.get(bot.slug)) {
      this.writeNew(bot.slug, { ...bot, status: bot.status ?? "published", featured: bot.featured ?? false });
      return this.get(bot.slug) as Bot;
    }
    const { slug, ...fields } = bot;
    // status/featured are admin state: undefined keeps the existing values.
    return this.update(slug, fields) as Bot;
  }
}
