import { CATEGORIES, type Category } from "../core/categories.js";
import type { Recipe } from "../core/recipe.js";
import { MAX_SLUG_LENGTH, slugify } from "../core/slug.js";
import type { Driver, SqlDatabase, SqlRow, SqlValue } from "./sql.js";
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

/** Decodes a bots row. Numbers go through Number() so both backends' rows decode the same way. */
function fromRow(r: SqlRow): Bot {
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
    featured: Number(r.featured) === 1,
    installClicks: Number(r.install_clicks),
    upvotes: Number(r.upvotes),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** ORDER BY clauses; `tiebreak` is the insertion-order column (rowid in SQLite, id in Postgres). */
function orderClauses(tiebreak: string): Record<NonNullable<ListOpts["sort"]>, string> {
  return {
    new: `created_at DESC, ${tiebreak} DESC`,
    top: `upvotes DESC, created_at DESC, ${tiebreak} DESC`,
    installs: `install_clicks DESC, created_at DESC, ${tiebreak} DESC`,
  };
}

export class BotsRepo {
  readonly driver: Driver;
  private readonly order: Record<NonNullable<ListOpts["sort"]>, string>;

  constructor(
    private db: SqlDatabase,
    private now: () => Date = () => new Date(),
  ) {
    this.driver = db.driver;
    this.order = orderClauses(db.driver === "postgres" ? "id" : "rowid");
  }

  ping(): Promise<void> {
    return this.db.ping();
  }

  close(): Promise<void> {
    return this.db.close();
  }

  private where(opts: FilterOpts): { sql: string; params: SqlValue[] } {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
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

  async list(opts: ListOpts = {}): Promise<Bot[]> {
    const { sql, params } = this.where(opts);
    const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
    const rows = await this.db.all(
      `SELECT * FROM bots ${sql} ORDER BY ${this.order[opts.sort ?? "new"]} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map(fromRow);
  }

  async count(opts: FilterOpts = {}): Promise<number> {
    const { sql, params } = this.where(opts);
    const r = await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM bots ${sql}`, params);
    return Number(r?.n ?? 0);
  }

  async get(slug: string): Promise<Bot | null> {
    const r = await this.db.get("SELECT * FROM bots WHERE slug = ?", [slug]);
    return r ? fromRow(r) : null;
  }

  private async exists(slug: string): Promise<boolean> {
    return (await this.db.get("SELECT 1 FROM bots WHERE slug = ?", [slug])) !== undefined;
  }

  private async freeSlug(base: string): Promise<string> {
    if (!(await this.exists(base))) return base;
    for (let i = 2; ; i++) {
      // Trim the base so base-N stays within the slug length limit (and importable as catalog JSON).
      const suffix = `-${i}`;
      const stem = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "") || "bot";
      const candidate = `${stem}${suffix}`;
      if (!(await this.exists(candidate))) return candidate;
    }
  }

  private async writeNew(slug: string, bot: NewBot): Promise<void> {
    const ts = this.now().toISOString();
    await this.db.run(
      `INSERT INTO bots (slug, name, tagline, description_md, category, tags_json, author_name, author_url,
          avatar_shape, avatar_color, image_url, template_id, recipe_json, source_url, homepage_url,
          status, featured, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
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
      ],
    );
  }

  async insert(bot: NewBot): Promise<Bot> {
    const slug = await this.freeSlug(bot.slug || slugify(bot.name));
    await this.writeNew(slug, bot);
    return (await this.get(slug)) as Bot;
  }

  async update(slug: string, patch: Partial<NewBot>): Promise<Bot | null> {
    const cur = await this.get(slug);
    if (!cur) return null;
    const { slug: _ignored, ...rest } = patch;
    const m = { ...cur, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) } as Bot;
    await this.db.run(
      `UPDATE bots SET name=?, tagline=?, description_md=?, category=?, tags_json=?, author_name=?, author_url=?,
          avatar_shape=?, avatar_color=?, image_url=?, template_id=?, recipe_json=?, source_url=?, homepage_url=?,
          status=?, featured=?, updated_at=? WHERE slug=?`,
      [
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
      ],
    );
    return this.get(slug);
  }

  async delete(slug: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.run("DELETE FROM events WHERE slug = ?", [slug]);
      const { changes } = await tx.run("DELETE FROM bots WHERE slug = ?", [slug]);
      return changes > 0;
    });
  }

  async setStatus(slug: string, status: Bot["status"]): Promise<void> {
    await this.db.run("UPDATE bots SET status = ?, updated_at = ? WHERE slug = ?", [
      status,
      this.now().toISOString(),
      slug,
    ]);
  }

  async setFeatured(slug: string, featured: boolean): Promise<void> {
    await this.db.run("UPDATE bots SET featured = ?, updated_at = ? WHERE slug = ?", [
      featured ? 1 : 0,
      this.now().toISOString(),
      slug,
    ]);
  }

  /** Counts one event per visitor, bot, kind and day. False for an unknown bot or a repeat. */
  async recordEvent(slug: string, kind: "install" | "upvote", visitorHash: string): Promise<boolean> {
    if (!(await this.exists(slug))) return false;
    const day = this.now().toISOString().slice(0, 10);
    const col = kind === "install" ? "install_clicks" : "upvotes";
    return this.db.transaction(async (tx) => {
      const r = await tx.run(
        "INSERT INTO events (slug, kind, visitor_hash, day) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
        [slug, kind, visitorHash, day],
      );
      if (r.changes === 0) return false;
      await tx.run(`UPDATE bots SET ${col} = ${col} + 1 WHERE slug = ?`, [slug]);
      return true;
    });
  }

  async categoryCounts(): Promise<Record<Category, number>> {
    const out = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<Category, number>;
    const rows = await this.db.all<{ category: Category; n: number }>(
      "SELECT category, COUNT(*) AS n FROM bots WHERE status = 'published' GROUP BY category",
    );
    for (const r of rows) if (r.category in out) out[r.category] = Number(r.n);
    return out;
  }

  async upsertFromCatalog(bot: NewBot & { slug: string }): Promise<Bot> {
    if (!(await this.get(bot.slug))) {
      await this.writeNew(bot.slug, { ...bot, status: bot.status ?? "published", featured: bot.featured ?? false });
      return (await this.get(bot.slug)) as Bot;
    }
    const { slug, ...fields } = bot;
    // status/featured are admin state: undefined keeps the existing values.
    return (await this.update(slug, fields)) as Bot;
  }
}
