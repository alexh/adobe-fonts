'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const AFONT_JS = path.join(ROOT_DIR, 'scripts', 'afont.js');
const TEST_TOKEN = 'test-token';

async function runAfont(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [AFONT_JS, ...args], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        AFONT_SKILL_DIR: ROOT_DIR,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        error: null,
        signal,
        timedOut,
      });
    });
  });
}

function parseJsonOutput(run) {
  const raw = run.stdout.trim() || run.stderr.trim();
  assert.ok(raw, `Expected JSON output.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    assert.fail(`Failed to parse JSON output: ${error.message}\nOutput:\n${raw}`);
  }
}

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function hasSqliteCli() {
  const probe = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function fixtureFamily(id, options = {}) {
  const slug = options.slug || id;
  const name = options.name || id.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const classification = options.classification || 'serif';
  const cssStack = options.cssStack || (classification.includes('sans') ? 'sans-serif' : 'serif');
  const languages = options.languages || ['en'];
  const description = options.description || `${name} test fixture family`;

  return {
    id,
    slug,
    name,
    description,
    web_link: options.webLink || `http://typekit.com/fonts/${slug}`,
    css_names: options.cssNames || [slug],
    browse_info: {
      classification: [classification],
      language: languages,
    },
    foundry: {
      name: options.foundry || 'Adobe',
    },
    css_stack: cssStack,
    variations: options.variations || [{ fvd: 'n4' }, { fvd: 'n7' }],
  };
}

function toKitFamily(family) {
  return {
    name: family.name,
    css_names: Array.isArray(family.css_names) ? [...family.css_names] : [family.slug],
    stack: family.css_stack || 'serif',
  };
}

function createApiState() {
  const families = [
    fixtureFamily('droid-serif', {
      name: 'Droid Serif',
      classification: 'serif',
      cssStack: 'serif',
    }),
    fixtureFamily('source-sans-3', {
      name: 'Source Sans 3',
      classification: 'sans-serif',
      cssStack: 'sans-serif',
    }),
    fixtureFamily('adobe-caslon-pro', {
      name: 'Adobe Caslon Pro',
      classification: 'serif',
      cssStack: 'serif',
    }),
  ];

  const kits = [
    {
      id: 'kit123',
      name: 'marketing-site',
      domains: ['example.com'],
      families: [toKitFamily(families[0])],
    },
  ];

  return {
    families,
    kits,
    nextKitId: 200,
    libraries: [{ id: 'full' }],
    libraryFamilyIds: families.map((family) => family.id),
  };
}

function findFamily(state, refValue) {
  const ref = String(refValue || '').toLowerCase();
  return state.families.find((family) => {
    const byId = String(family.id || '').toLowerCase() === ref;
    const bySlug = String(family.slug || '').toLowerCase() === ref;
    const byName = String(family.name || '').toLowerCase() === ref;
    return byId || bySlug || byName;
  }) || null;
}

function findKit(state, refValue) {
  const ref = String(refValue || '').toLowerCase();
  return state.kits.find((kit) => {
    const byId = String(kit.id || '').toLowerCase() === ref;
    const byName = String(kit.name || '').toLowerCase() === ref;
    return byId || byName;
  }) || null;
}

function cloneKit(kit) {
  return {
    id: kit.id,
    name: kit.name,
    domains: [...kit.domains],
    families: Array.isArray(kit.families) ? kit.families.map((family) => ({ ...family })) : [],
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    connection: 'close',
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function readFormList(params, key) {
  const plural = params.getAll(`${key}[]`).filter(Boolean);
  if (plural.length > 0) return plural;
  const single = params.get(key);
  if (!single) return [];
  return [single];
}

async function startMockApi(t) {
  const state = createApiState();

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (!requestUrl.pathname.startsWith('/api')) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }

    const token = req.headers['x-typekit-token'];
    if (token !== TEST_TOKEN) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    const pathname = requestUrl.pathname.slice('/api'.length) || '/';
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const bodyRaw = ['POST', 'PUT', 'PATCH'].includes(method) ? await readRequestBody(req) : '';
    const form = new URLSearchParams(bodyRaw);

    if (segments.length === 1 && segments[0] === 'kits' && method === 'GET') {
      sendJson(res, 200, { kits: state.kits.map((kit) => cloneKit(kit)) });
      return;
    }

    if (segments.length === 1 && segments[0] === 'kits' && method === 'POST') {
      const name = String(form.get('name') || '').trim();
      const domains = readFormList(form, 'domains');
      const id = `kit${state.nextKitId}`;
      state.nextKitId += 1;
      const newKit = {
        id,
        name: name || `kit-${id}`,
        domains,
        families: [],
      };
      state.kits.push(newKit);
      sendJson(res, 200, { kit: cloneKit(newKit) });
      return;
    }

    if (segments[0] === 'kits' && segments.length >= 2) {
      const kitRef = segments[1];
      const kit = findKit(state, kitRef);
      if (!kit) {
        sendJson(res, 404, { error: 'kit-not-found' });
        return;
      }

      if (segments.length === 2 && method === 'GET') {
        sendJson(res, 200, { kit: cloneKit(kit) });
        return;
      }

      if (segments.length === 2 && method === 'POST') {
        const domains = readFormList(form, 'domains');
        if (domains.length > 0) {
          kit.domains = domains;
        }
        sendJson(res, 200, { kit: cloneKit(kit) });
        return;
      }

      if (segments.length === 4 && segments[2] === 'families' && method === 'POST') {
        const familyRef = segments[3];
        const family = findFamily(state, familyRef);
        if (!family) {
          sendJson(res, 404, { error: 'family-not-found' });
          return;
        }

        const alreadyPresent = (kit.families || []).some((item) => {
          const cssNames = Array.isArray(item.css_names) ? item.css_names : [];
          return cssNames.includes(family.slug);
        });
        if (!alreadyPresent) {
          if (!Array.isArray(kit.families)) kit.families = [];
          kit.families.push(toKitFamily(family));
        }
        sendJson(res, 200, { kit: cloneKit(kit) });
        return;
      }

      if (segments.length === 3 && segments[2] === 'publish' && method === 'POST') {
        sendJson(res, 200, { kit: cloneKit(kit) });
        return;
      }

      if (segments.length === 3 && segments[2] === 'published' && method === 'GET') {
        sendJson(res, 200, { kit: cloneKit(kit) });
        return;
      }
    }

    if (segments.length === 1 && segments[0] === 'libraries' && method === 'GET') {
      sendJson(res, 200, { libraries: state.libraries.map((library) => ({ ...library })) });
      return;
    }

    if (segments.length === 2 && segments[0] === 'libraries' && method === 'GET') {
      const libraryRef = segments[1];
      const exists = state.libraries.some((library) => library.id === libraryRef);
      if (!exists) {
        sendJson(res, 404, { error: 'library-not-found' });
        return;
      }

      const page = Number.parseInt(requestUrl.searchParams.get('page') || '1', 10);
      const perPage = Number.parseInt(requestUrl.searchParams.get('per_page') || '500', 10);
      const start = Math.max(0, (page - 1) * perPage);
      const end = Math.max(start, start + perPage);
      const pageFamilyIds = state.libraryFamilyIds.slice(start, end);
      const families = pageFamilyIds
        .map((familyId) => findFamily(state, familyId))
        .filter(Boolean)
        .map((family) => ({ id: family.id, slug: family.slug, name: family.name }));
      const pageCount = Math.max(1, Math.ceil(state.libraryFamilyIds.length / perPage));

      sendJson(res, 200, {
        library: {
          id: libraryRef,
          families,
          pagination: {
            page_count: pageCount,
          },
        },
      });
      return;
    }

    if (segments.length === 2 && segments[0] === 'families' && method === 'GET') {
      const familyRef = segments[1];
      const family = findFamily(state, familyRef);
      if (!family) {
        sendJson(res, 404, { error: 'family-not-found' });
        return;
      }

      sendJson(res, 200, { family: { ...family } });
      return;
    }

    sendJson(res, 404, { error: 'not-found' });
  });
  server.keepAliveTimeout = 1;
  server.headersTimeout = 5000;

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
  };
}

async function setupContext(t, envOverrides = {}) {
  const api = await startMockApi(t);
  const cacheDir = makeTempDir(t, 'afont-cache-');
  return {
    env: {
      AFONT_API_BASE: api.baseUrl,
      AFONT_CACHE_DIR: cacheDir,
      ADOBE_FONTS_API_TOKEN: TEST_TOKEN,
      ...envOverrides,
    },
    cacheDir,
  };
}

function assertExitCode(run, expectedCode) {
  assert.equal(
    run.timedOut,
    false,
    `Process timed out. stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
  assert.equal(
    run.code,
    expectedCode,
    `Unexpected exit code ${run.code}. stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
}

test('help output lists view command', async () => {
  const run = await runAfont(['--help']);
  assertExitCode(run, 0);
  assert.match(run.stdout, /afont view --family/);
});

test('unknown command returns structured json error', async () => {
  const run = await runAfont(['unknown-command', '--json']);
  assertExitCode(run, 2);
  const payload = parseJsonOutput(run);
  assert.match(payload.error.message, /Unknown command: unknown-command/);
});

test('doctor succeeds when token and API are available', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['doctor', '--json'], { env });
  assertExitCode(run, 0);

  const payload = parseJsonOutput(run);
  assert.equal(payload.result.intent, 'doctor');
  assert.equal(payload.result.checks.tokenPresent, true);
  assert.equal(payload.result.checks.apiReachable, true);
});

test('doctor fails with missing token', async (t) => {
  const { env } = await setupContext(t, { ADOBE_FONTS_API_TOKEN: '' });
  const run = await runAfont(['doctor', '--json'], { env });
  assertExitCode(run, 1);

  const payload = parseJsonOutput(run);
  assert.equal(payload.result.intent, 'doctor');
  assert.equal(payload.result.checks.tokenPresent, false);
  assert.equal(payload.result.checks.apiReachable, false);
});

test('search requires --query', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['search', '--json'], { env });
  assertExitCode(run, 2);
  const payload = parseJsonOutput(run);
  assert.match(payload.error.message, /Missing --query/);
});

test('search via API returns ranked fonts', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['search', '--query', 'droid', '--no-cache', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);

  assert.equal(payload.result.intent, 'search');
  assert.ok(Array.isArray(payload.result.fonts));
  assert.ok(payload.result.fonts.some((font) => font.slug === 'droid-serif'));
  assert.ok(Array.isArray(payload.result.snippets.cssExamples));
});

test('kits list fails without token', async (t) => {
  const { env } = await setupContext(t, { ADOBE_FONTS_API_TOKEN: '' });
  const run = await runAfont(['kits', 'list', '--json'], { env });
  assertExitCode(run, 2);
  const payload = parseJsonOutput(run);
  assert.match(payload.error.message, /Missing ADOBE_FONTS_API_TOKEN/);
});

test('kits list returns known kits', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['kits', 'list', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.intent, 'kit_list');
  assert.ok(payload.result.kits.some((kit) => kit.name === 'marketing-site'));
});

test('kits ensure dry-run creates new kit metadata', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['kits', 'ensure', '--name', 'new-kit', '--domains', 'a.com,b.com', '--dry-run', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.intent, 'kit_update');
  assert.equal(payload.result.action, 'create');
  assert.equal(payload.result.dryRun, true);
  assert.equal(payload.result.kit.id, 'dry-run-kit');
});

test('kits ensure dry-run updates existing kit metadata', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['kits', 'ensure', '--name', 'marketing-site', '--domains', 'example.com,www.example.com', '--dry-run', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.action, 'update');
  assert.equal(payload.result.dryRun, true);
  assert.deepEqual(payload.result.kit.domains, ['example.com', 'www.example.com']);
});

test('kits add-family dry-run returns action and family metadata', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont([
    'kits',
    'add-family',
    '--kit',
    'marketing-site',
    '--family',
    'source-sans-3',
    '--weights',
    '400,700',
    '--styles',
    'normal,italic',
    '--dry-run',
    '--json',
  ], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.action, 'add-family');
  assert.equal(payload.result.dryRun, true);
  assert.equal(payload.result.fonts[0].familyName, 'source-sans-3');
  assert.deepEqual(payload.result.fonts[0].weights, ['400', '700']);
});

test('kits publish dry-run returns publish action', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['kits', 'publish', '--kit', 'marketing-site', '--dry-run', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.action, 'publish');
  assert.equal(payload.result.dryRun, true);
});

test('kits embed returns link tag and css examples', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['kits', 'embed', '--kit', 'marketing-site', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.intent, 'embed');
  assert.match(payload.result.snippets.htmlLinkTag, /https:\/\/use\.typekit\.net\/kit123\.css/);
  assert.ok(payload.result.snippets.cssExamples.length > 0);
});

test('index status works when cache does not exist', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['index', 'status', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.intent, 'index_status');
  assert.equal(payload.result.cache.exists, false);
});

test('index refresh builds cache and cache-only search uses sqlite index', async (t) => {
  if (!hasSqliteCli()) {
    t.skip('sqlite3 CLI is not available in PATH');
    return;
  }

  const { env } = await setupContext(t);
  const refreshRun = await runAfont(['index', 'refresh', '--per-page', '2', '--max-pages', '5', '--json'], { env });
  assertExitCode(refreshRun, 0);
  const refreshPayload = parseJsonOutput(refreshRun);

  assert.equal(refreshPayload.result.intent, 'index_refresh');
  assert.ok(refreshPayload.result.cache.familyCount >= 3);

  const searchRun = await runAfont(['search', '--query', 'droid', '--cache-only', '--json'], { env });
  assertExitCode(searchRun, 0);
  const searchPayload = parseJsonOutput(searchRun);
  assert.equal(searchPayload.result.intent, 'search');
  assert.ok(searchPayload.result.fonts.some((font) => font.slug === 'droid-serif'));
});

test('view requires either --family or --url', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--json'], { env });
  assertExitCode(run, 2);
  const payload = parseJsonOutput(run);
  assert.match(payload.error.message, /Missing --family or --url/);
});

test('view rejects non-adobe URL hosts', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--url', 'https://example.com/font', '--dry-run', '--json'], { env });
  assertExitCode(run, 2);
  const payload = parseJsonOutput(run);
  assert.match(payload.error.message, /fonts\.adobe\.com or typekit\.com/);
});

test('view dry-run with URL returns codex handoff fields', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--url', 'https://fonts.adobe.com/fonts/droid-serif', '--dry-run', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);

  assert.equal(payload.result.intent, 'view');
  assert.equal(payload.result.view.source, 'adobe_page');
  assert.equal(payload.result.view.screenshotBytes, 0);
  assert.equal(payload.result.view.sha256, '');
  assert.equal(payload.result.view.fullPage, true);
  assert.match(payload.result.codex.imagePath, /\.png$/);
  assert.match(payload.result.codex.markdownImage, /^!\[afont-preview\]\(.+\.png\)$/);
});

test('view canonicalizes typekit URL to fonts.adobe.com', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--url', 'http://typekit.com/fonts/droid-serif', '--dry-run', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.view.pageUrl, 'https://fonts.adobe.com/fonts/droid-serif');
});

test('view with --family requires token when --url is omitted', async (t) => {
  const { env } = await setupContext(t, { ADOBE_FONTS_API_TOKEN: '' });
  const run = await runAfont(['view', '--family', 'droid-serif', '--dry-run', '--json'], { env });
  assertExitCode(run, 2);
  const payload = parseJsonOutput(run);
  assert.match(payload.error.message, /Provide --url or set token/);
});

test('view dry-run resolves family and canonical page URL with token', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--family', 'droid-serif', '--dry-run', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);
  assert.equal(payload.result.view.familyRef, 'droid-serif');
  assert.equal(payload.result.view.resolvedFamilySlug, 'droid-serif');
  assert.equal(payload.result.view.pageUrl, 'https://fonts.adobe.com/fonts/droid-serif');
});

test('view non-json output includes page/image/codex lines', async (t) => {
  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--url', 'https://fonts.adobe.com/fonts/droid-serif', '--dry-run'], { env });
  assertExitCode(run, 0);
  assert.match(run.stdout, /^page: /m);
  assert.match(run.stdout, /^image: /m);
  assert.match(run.stdout, /^codex: !\[afont-preview\]\(/m);
});

test('view e2e screenshot capture (optional)', { timeout: 120000 }, async (t) => {
  if (process.env.AFONT_RUN_VIEW_E2E !== '1') {
    t.skip('Set AFONT_RUN_VIEW_E2E=1 to run browser screenshot e2e test.');
    return;
  }

  const { env } = await setupContext(t);
  const run = await runAfont(['view', '--url', 'https://fonts.adobe.com/fonts/droid-serif', '--json'], { env });
  assertExitCode(run, 0);
  const payload = parseJsonOutput(run);

  assert.equal(payload.result.intent, 'view');
  assert.ok(payload.result.view.screenshotBytes > 0);
  assert.match(payload.result.view.sha256, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(payload.result.view.screenshotPath));
});
