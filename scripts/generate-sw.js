const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const templatePath = path.join(rootDir, "src", "sw-template.js");
const outputPath = path.join(distDir, "sw.js");
const packageJson = require("../package.json");

function sanitizeVersionSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function getGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "nogit";
  }
}

function getBuildId() {
  return (
    process.env.DEPLOY_ID ||
    process.env.BUILD_ID ||
    process.env.NETLIFY_BUILD_ID ||
    new Date().toISOString()
  );
}

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function toAppShellPath(filePath) {
  return `./${path.relative(distDir, filePath).split(path.sep).join("/")}`;
}

function getAppShell() {
  const files = collectFiles(distDir)
    .map(toAppShellPath)
    .filter((filePath) => filePath !== "./sw.js")
    .sort();

  return ["./", ...files];
}

function generateServiceWorker() {
  if (!fs.existsSync(distDir)) {
    throw new Error("dist directory does not exist. Run vite build first.");
  }

  const appVersion = [
    packageJson.version,
    getGitSha(),
    getBuildId()
  ].map(sanitizeVersionSegment).join("-");

  const appShell = getAppShell();
  const template = fs.readFileSync(templatePath, "utf8");
  const output = template
    .replace(/"__APP_VERSION__"/, JSON.stringify(appVersion))
    .replace(/__APP_SHELL__/, JSON.stringify(appShell, null, 2));

  if (output.includes("__APP_VERSION__") || output.includes("__APP_SHELL__")) {
    throw new Error("Service worker template placeholders were not replaced.");
  }

  fs.writeFileSync(outputPath, output);
  console.log(`Generated sw.js with ${appShell.length} cached paths for ${appVersion}.`);
}

generateServiceWorker();
