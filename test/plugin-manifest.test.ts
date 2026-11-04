/**
 * The Claude Code plugin (.claude-plugin/) and llms.txt describe this
 * repository to agents. Neither ships in the npm tarball, so nothing else
 * checks them: this keeps their version in step with the package
 * (`npm run bump` writes all of them) and their links pointing at files that
 * exist.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../src/env";

const ROOT = resolve(__dirname, "..");
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const pkg = readJson("package.json");
const plugin = readJson(".claude-plugin/plugin.json");
const marketplace = readJson(".claude-plugin/marketplace.json");

describe("Claude Code plugin manifests", () => {
  it("carry the package version", () => {
    expect(plugin.version).toBe(pkg.version);
    expect(PACKAGE_VERSION).toBe(pkg.version);
    for (const entry of marketplace.plugins) expect(entry.version).toBe(pkg.version);
  });

  it("name one plugin, and the marketplace lists it", () => {
    expect(typeof plugin.name).toBe("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].name).toBe(plugin.name);
  });

  it("point the plugin source at the directory that holds the setup skill", () => {
    // Relative sources resolve from the marketplace root: the directory that holds .claude-plugin/.
    const source = resolve(ROOT, marketplace.plugins[0].source);
    expect(source).toBe(ROOT);
    expect(existsSync(join(source, "skills", "annokit-setup", "SKILL.md"))).toBe(true);
  });

  it("describe the same project as package.json", () => {
    expect(plugin.license).toBe(pkg.license);
    expect(plugin.repository).toBe(pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""));
    expect(plugin.homepage).toBe(pkg.homepage);
  });
});

describe("llms.txt", () => {
  const text = readFileSync(join(ROOT, "llms.txt"), "utf8");

  it("opens with the project title and a one-paragraph summary", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# AnnoKit");
    expect(lines[2].startsWith("> ")).toBe(true);
  });

  it("links only to files and directories that exist in this repository", () => {
    const links = [...text.matchAll(/https:\/\/github\.com\/joinearlybird\/annokit\/(?:blob|tree)\/main\/([^)\s#]+)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const path of links) {
      expect(existsSync(join(ROOT, path)), `${path} is linked from llms.txt but does not exist`).toBe(true);
    }
    const dirs = [...text.matchAll(/\/tree\/main\/([^)\s#]+)/g)].map((m) => m[1]);
    for (const path of dirs) expect(statSync(join(ROOT, path)).isDirectory(), `${path} is linked as a tree`).toBe(true);
  });

  it("names the setup skill by its own path", () => {
    expect(text).toContain("skills/annokit-setup/SKILL.md");
    expect(dirname("skills/annokit-setup/SKILL.md")).toBe("skills/annokit-setup");
  });
});
