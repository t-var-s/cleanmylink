import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { getPageConfig, pages, renderHeadTags } from "./site.config.mjs";

function buildInput() {
  return Object.fromEntries(
    Object.values(pages).map((page) => [
      page.inputName,
      fileURLToPath(new URL(page.input, import.meta.url))
    ])
  );
}

function appHeadPlugin() {
  return {
    name: "cleanmylink-app-head",
    enforce: "pre",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const page = getPageConfig(context.path);

        if (!page) {
          return html;
        }

        if (!html.includes("<!-- app-head -->")) {
          throw new Error(`Missing app-head marker in ${context.path}.`);
        }

        return html.replace("<!-- app-head -->", renderHeadTags(page));
      }
    }
  };
}

export default defineConfig({
  plugins: [appHeadPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: buildInput()
    }
  }
});
