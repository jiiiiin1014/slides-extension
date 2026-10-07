import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const copyStatic = () => {
  cpSync("src/manifest.json", "dist/manifest.json");
  cpSync("src/sidepanel/index.html", "dist/sidepanel/index.html");
  cpSync("src/sidepanel/style.css", "dist/sidepanel/style.css");
  cpSync("src/sidepanel/viewer.html", "dist/sidepanel/viewer.html");
  cpSync("src/icons", "dist/icons", { recursive: true });
};

const options = {
  entryPoints: {
    "content/index": "src/content/index.ts",
    "background/index": "src/background/index.ts",
    "sidepanel/index": "src/sidepanel/index.ts",
    "sidepanel/viewer": "src/sidepanel/viewer.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  plugins: [{ name: "copy-static", setup: (b) => b.onEnd(copyStatic) }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
