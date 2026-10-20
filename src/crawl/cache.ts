import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { parseMedicinePath } from "../shared/urls";

export interface CacheStorage {
  get(url: string): Promise<string | null>;
  set(url: string, html: string): Promise<void>;
  has(url: string): Promise<boolean>;
  resolvePath(url: string): string;
}

export class FilePageCache implements CacheStorage {
  private readonly baseDir: string;

  constructor(baseDir: string = path.resolve("cache")) {
    this.baseDir = path.resolve(baseDir);
  }

  resolvePath(url: string): string {
    const { slug, subSlug, isIndex } = parseMedicinePath(url);

    if (isIndex || !slug) {
      return path.join(this.baseDir, "index.html");
    }

    const filename = `${subSlug ?? "index"}.html`;
    return path.join(this.baseDir, slug, filename);
  }

  async get(url: string): Promise<string | null> {
    const file = this.resolvePath(url);
    try {
      return await readFile(file, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async set(url: string, html: string): Promise<void> {
    const file = this.resolvePath(url);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html, "utf8");
  }

  async has(url: string): Promise<boolean> {
    const content = await this.get(url);
    return content !== null;
  }
}

export const defaultCache = new FilePageCache();
