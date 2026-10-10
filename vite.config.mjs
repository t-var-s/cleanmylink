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

// Marks the page's module script as render-blocking where the page asks for
// it. Vite rewrites the script tag during the build, so the attribute is
// added after that instead of in the source HTML.
function renderBlockingScriptPlugin() {
  return {
    name: "cleanmylink-render-blocking-script",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const page = getPageConfig(context.path);

        if (!page?.renderBlockingScript) {
          return html;
        }

        return html.replace(
          /<script type="module"( crossorigin)? src=/g,
          '<script type="module" blocking="render"$1 src='
        );
      }
    }
  };
}

export default defineConfig({
  plugins: [appHeadPlugin(), renderBlockingScriptPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: buildInput()
    }
  }
});
