import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const packageRoot = path.join(projectRoot, 'node_modules/@wonderwhy-er/desktop-commander');
const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
const lockedVersion = lock.packages?.['node_modules/@wonderwhy-er/desktop-commander']?.version;
if (!lockedVersion || lockedVersion !== packageJson.version) {
  throw new Error(`Expected locked Desktop Commander version ${lockedVersion ?? '(missing)'}, found ${packageJson.version}`);
}

const integrationPath = path.join(packageRoot, 'dist/remote-device/desktop-commander-integration.js');
let source = await fs.readFile(integrationPath, 'utf8');

const replacement = `return {\n                command: '/usr/local/bin/drop-uid-exec',\n                args: ['--', process.execPath, devPath],\n                cwd: '/workspace',\n                env: {\n                    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',\n                    HOME: '/home/tool',\n                    TMPDIR: '/tmp',\n                    USER: 'tool',\n                    LOGNAME: 'tool',\n                    DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1',\n                    PUPPETEER_SKIP_DOWNLOAD: '1',\n                    REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD: '1'\n                }\n            };`;
const replacementWithWorkspaceGroup = replacement.replace("args: ['--', process.execPath, devPath]", "args: ['--workspace-gid', process.env.REMOTE_DEVICE_WORKSPACE_GID || '', '--', process.execPath, devPath]");
const marker = 'REMOTE_DEVICE_SANDBOX_DROP_UID_PATCH_V2';
const envAllowlistMarker = 'REMOTE_DEVICE_SANDBOX_ENV_ALLOWLIST_PATCH_V1';

if (source.includes(marker)) {
  console.log(`${marker}: already applied`);
} else {
  const launchBlock = /return\s*\{\s*command:\s*process\.execPath,\s*(?:\/\/[^\n]*\n\s*)?args:\s*\[devPath\],\s*cwd:\s*path\.dirname\(devPath\)\s*\};/g;
  const matches = [...source.matchAll(launchBlock)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one upstream launch block, found ${matches.length}; refusing to patch`);
  }
  source = source.replace(launchBlock, replacementWithWorkspaceGroup);
  const close = source.indexOf('export class DesktopCommanderIntegration');
  if (close < 0) throw new Error('Expected integration class marker missing; refusing to patch');
  source = `${source.slice(0, close)}// ${marker}\n${source.slice(close)}`;
  await fs.writeFile(integrationPath, source);
  console.log(`${marker}: patched Desktop Commander ${packageJson.version}`);
}

const updated = await fs.readFile(integrationPath, 'utf8');
if (!updated.includes(marker)
  || !updated.includes("command: '/usr/local/bin/drop-uid-exec'")
  || !updated.includes("'--workspace-gid', process.env.REMOTE_DEVICE_WORKSPACE_GID || ''")
  || !updated.includes("DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1'")
  || !updated.includes("REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD: '1'")
  || !updated.includes("PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'")) {
  throw new Error('Post-patch verification failed');
}

let integration = updated;
const envMerge = "env: { ...deviceEnvironment(), ...config.env, DC_REMOTE_DEVICE: 'true' }";
const envAllowlist = `env: { ...config.env, DC_REMOTE_DEVICE: 'true' } // ${envAllowlistMarker}`;
if (!integration.includes(envAllowlistMarker)) {
  const occurrences = integration.split(envMerge).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one upstream parent-environment merge, found ${occurrences}; refusing to patch`);
  }
  integration = integration.replace(envMerge, envAllowlist);
  await fs.writeFile(integrationPath, integration);
  console.log(`${envAllowlistMarker}: patched Desktop Commander ${packageJson.version}`);
} else {
  console.log(`${envAllowlistMarker}: already applied`);
}

const updatedIntegration = await fs.readFile(integrationPath, 'utf8');
if (!updatedIntegration.includes(envAllowlistMarker)
  || !updatedIntegration.includes(envAllowlist)
  || updatedIntegration.includes(envMerge)) {
  throw new Error('MCP child environment allowlist post-patch verification failed');
}

const environmentHelper = `/** The device's environment, as the string map a child process gets */
function deviceEnvironment() {
    return Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined));
}`;
const staleEnvironmentComment = / {12}\/\/ The server gets the device's whole environment,[\s\S]*? {12}\/\/ welcome page in a browser the remote user would never see\./g;
const allowlistComment = `            // REMOTE_DEVICE_SANDBOX_ENV_ALLOWLIST_PATCH_V1
            // Pass only the explicit sandbox environment allowlist to the MCP child.
            // DC_REMOTE_DEVICE suppresses local-only behavior such as opening a browser.`;
const helperRemovalMarker = 'REMOTE_DEVICE_SANDBOX_DEVICE_ENVIRONMENT_REMOVED_V1';
let cleanedIntegration = await fs.readFile(integrationPath, 'utf8');
if (!cleanedIntegration.includes(helperRemovalMarker)) {
  const helperOccurrences = cleanedIntegration.split(environmentHelper).length - 1;
  const commentOccurrences = [...cleanedIntegration.matchAll(staleEnvironmentComment)].length;
  if (helperOccurrences !== 1 || commentOccurrences !== 1) {
    throw new Error(`Expected one upstream environment helper/comment, found ${helperOccurrences}/${commentOccurrences}; refusing to patch`);
  }
  cleanedIntegration = cleanedIntegration
    .replace(environmentHelper, `// ${helperRemovalMarker}`)
    .replace(staleEnvironmentComment, allowlistComment);
  await fs.writeFile(integrationPath, cleanedIntegration);
  console.log(`${helperRemovalMarker}: removed unused whole-environment helper`);
} else {
  console.log(`${helperRemovalMarker}: already applied`);
}

const finalIntegration = await fs.readFile(integrationPath, 'utf8');
if (!finalIntegration.includes(helperRemovalMarker)
  || finalIntegration.includes('function deviceEnvironment()')
  || finalIntegration.includes("The server gets the device's whole environment")) {
  throw new Error('MCP child environment cleanup post-patch verification failed');
}

const serverPath = path.join(packageRoot, 'dist/server.js');
let server = await fs.readFile(serverPath, 'utf8');
const schemaMarker = 'REMOTE_DEVICE_SANDBOX_ZOD4_SCHEMA_PATCH_V1';
const schemaImport = 'import { zodToJsonSchema } from "zod-to-json-schema";';
if (!server.includes(schemaMarker)) {
  const occurrences = server.split(schemaImport).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one zod-to-json-schema import, found ${occurrences}; refusing to patch`);
  }
  server = server.replace(
    schemaImport,
    `import { z } from "zod";\nconst zodToJsonSchema = (schema) => z.toJSONSchema(schema, { target: 'draft-07' });\n// ${schemaMarker}`,
  );
  await fs.writeFile(serverPath, server);
  console.log(`${schemaMarker}: patched Desktop Commander ${packageJson.version}`);
} else {
  console.log(`${schemaMarker}: already applied`);
}

const updatedServer = await fs.readFile(serverPath, 'utf8');
if (!updatedServer.includes(schemaMarker)
  || !updatedServer.includes("z.toJSONSchema(schema, { target: 'draft-07' })")) {
  throw new Error('Zod JSON Schema post-patch verification failed');
}

const markdownPath = path.join(packageRoot, 'dist/tools/pdf/markdown.js');
let markdown = await fs.readFile(markdownPath, 'utf8');
const browserMarker = 'REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD_V1';
const browserAnchor = '        // 3. Install Chrome as last resort\n        try {';
const browserPatch = `        // ${browserMarker}\n        if (process.env.REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD === '1') {\n            cachedChromePath = undefined;\n            return undefined;\n        }\n${browserAnchor}`;
if (!markdown.includes(browserMarker)) {
  const occurrences = markdown.split(browserAnchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one Chrome fallback anchor, found ${occurrences}; refusing to patch`);
  }
  markdown = markdown.replace(browserAnchor, browserPatch);
  await fs.writeFile(markdownPath, markdown);
  console.log(`${browserMarker}: patched Desktop Commander ${packageJson.version}`);
} else {
  console.log(`${browserMarker}: already applied`);
}

const updatedMarkdown = await fs.readFile(markdownPath, 'utf8');
if (!updatedMarkdown.includes(browserMarker)
  || !updatedMarkdown.includes("REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD === '1'")) {
  throw new Error('Browser download guard post-patch verification failed');
}
