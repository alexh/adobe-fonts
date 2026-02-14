#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BASE_URL = process.env.AFONT_API_BASE || 'https://typekit.com/api/v1/json';
const TOKEN = process.env.ADOBE_FONTS_API_TOKEN || '';
const TOKEN_PAGE_URL = 'https://fonts.adobe.com/account/tokens';
const DEFAULT_KIT = process.env.ADOBE_FONTS_DEFAULT_KIT || '';
const DEFAULT_DOMAINS = process.env.ADOBE_FONTS_DEFAULT_DOMAINS || '';
const CACHE_MAX_AGE_HOURS = Number.parseInt(process.env.AFONT_CACHE_MAX_AGE_HOURS || '168', 10);
const HTTP_TIMEOUT_MS = Number.parseInt(process.env.AFONT_HTTP_TIMEOUT_MS || '25000', 10);
const HTTP_MAX_RETRIES = Number.parseInt(process.env.AFONT_HTTP_MAX_RETRIES || '2', 10);
const HTTP_RETRY_BASE_MS = Number.parseInt(process.env.AFONT_HTTP_RETRY_BASE_MS || '500', 10);
const DEFAULT_SKILL_DIR = process.env.AFONT_SKILL_DIR || path.dirname(path.dirname(__filename));
const CACHE_DIR = process.env.AFONT_CACHE_DIR || path.join(DEFAULT_SKILL_DIR, '.cache');
const CACHE_DB = path.join(CACHE_DIR, 'fonts.sqlite3');
const WARMUP_REFRESH_PER_PAGE = 500;
const WARMUP_REFRESH_MAX_PAGES = 40;
const CACHE_WARMUP_COMMAND = `afont index refresh --per-page ${WARMUP_REFRESH_PER_PAGE} --max-pages ${WARMUP_REFRESH_MAX_PAGES}`;
const VIEW_DEFAULT_WIDTH = 1440;
const VIEW_DEFAULT_HEIGHT = 2200;
const VIEW_DEFAULT_WAIT_MS = 1200;
const VIEW_DEFAULT_TIMEOUT_MS = 45000;
const VIEW_HOSTS = new Set(['fonts.adobe.com', 'typekit.com', 'www.typekit.com']);

function nowIso() {
  return new Date().toISOString();
}

function cacheWarmupWarning() {
  return `Cache is empty. First uncached searches can be slow. Consult the user before running uncached search, or run one-time warmup: \`${CACHE_WARMUP_COMMAND}\`. If warmup takes a while, ask me for a quick Adobe/font joke.`;
}

function staleCacheWarning(lastRefreshAt) {
  if (lastRefreshAt) {
    return `Cache is stale (last refresh: ${lastRefreshAt}). Consult the user before uncached search, or refresh for faster searches: \`${CACHE_WARMUP_COMMAND}\``;
  }
  return `Cache is stale. Consult the user before uncached search, or refresh for faster searches: \`${CACHE_WARMUP_COMMAND}\``;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      positional.push(part);
      continue;
    }

    const eq = part.indexOf('=');
    if (eq !== -1) {
      const key = part.slice(2, eq);
      const value = part.slice(eq + 1);
      flags[key] = value;
      continue;
    }

    const key = part.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positional, flags };
}

function isJson(flags) {
  return Boolean(flags.json);
}

function hasToken() {
  return Boolean(TOKEN && TOKEN.trim().length > 0);
}

function tokenHeaders() {
  return {
    'X-Typekit-Token': TOKEN,
  };
}

function fail(message, code = 1, details = undefined, jsonMode = false) {
  if (jsonMode) {
    const payload = {
      error: {
        message,
        details,
      },
      meta: {
        source: 'adobe_api',
        timestamp: nowIso(),
      },
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
    if (details) {
      process.stderr.write(`${JSON.stringify(details, null, 2)}\n`);
    }
  }
  process.exit(code);
}

function printPayload(payload, jsonMode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const { result } = payload;
  process.stdout.write(`intent: ${result.intent}\n`);
  if (result.warnings && result.warnings.length > 0) {
    process.stdout.write(`warnings:\n`);
    for (const warning of result.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
  if (result.kit) {
    process.stdout.write(`kit: ${result.kit.name || 'unknown'} (${result.kit.id || 'unknown'})\n`);
  }
  if (result.checks) {
    for (const [key, value] of Object.entries(result.checks)) {
      process.stdout.write(`${key}: ${value}\n`);
    }
  }
  if (result.cache) {
    process.stdout.write(`cache:\n`);
    for (const [key, value] of Object.entries(result.cache)) {
      process.stdout.write(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`);
    }
  }
  if (result.stats) {
    process.stdout.write(`stats:\n`);
    for (const [key, value] of Object.entries(result.stats)) {
      process.stdout.write(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`);
    }
  }
  if (result.view) {
    if (result.view.pageUrl) {
      process.stdout.write(`page: ${result.view.pageUrl}\n`);
    }
    if (result.view.screenshotPath) {
      process.stdout.write(`image: ${result.view.screenshotPath}\n`);
    }
  }
  if (result.codex && result.codex.markdownImage) {
    process.stdout.write(`codex: ${result.codex.markdownImage}\n`);
  }
  if (result.fonts && result.fonts.length > 0) {
    process.stdout.write(`fonts:\n`);
    for (const font of result.fonts) {
      process.stdout.write(`- ${font.familyName} (${font.cssFamily})\n`);
    }
  }
  if (result.snippets) {
    if (result.snippets.htmlLinkTag) {
      process.stdout.write(`link: ${result.snippets.htmlLinkTag}\n`);
    }
    if (result.snippets.cssExamples && result.snippets.cssExamples.length > 0) {
      process.stdout.write(`css:\n`);
      for (const css of result.snippets.cssExamples) {
        process.stdout.write(`- ${css}\n`);
      }
    }
  }
  if (result.nextActions && result.nextActions.length > 0) {
    process.stdout.write(`next actions:\n`);
    for (const action of result.nextActions) {
      process.stdout.write(`- ${action}\n`);
    }
  }
}

function usage() {
  return `afont - Adobe Fonts/Typekit CLI\n\nUsage:\n  afont doctor [--json]\n  afont search --query <text> [--classification <name>] [--language <code>] [--limit <n>] [--per-page <n>] [--max-pages <n>] [--refresh-cache] [--cache-only] [--no-cache] [--confirm-uncached] [--json]\n  afont view --family <slug|name> [--url <https://...>] [--output-dir <path>] [--filename <name>] [--width <px>] [--height <px>] [--wait-ms <ms>] [--timeout-ms <ms>] [--full-page] [--dry-run] [--json]\n  afont index refresh [--library <id>] [--per-page <n>] [--max-pages <n>] [--json]\n  afont index status [--json]\n  afont index stats [--limit <n>] [--json]\n  afont kits list [--json]\n  afont kits ensure --name <kit-name> [--domains <d1,d2>] [--dry-run] [--json]\n  afont kits add-family --kit <id|name> --family <slug> [--weights <comma-list>] [--styles <comma-list>] [--dry-run] [--json]\n  afont kits publish --kit <id|name> [--dry-run] [--json]\n  afont kits embed --kit <id|name> [--json]\n`;
}

function normalizeFont(item) {
  const familyName = item.name || item.family || item.slug || item.id || 'unknown';
  const slug = item.slug || item.id || familyName.toLowerCase().replace(/\s+/g, '-');
  const cssFamily = item.css_names?.[0] || item.css_name || item.cssFamily || slug;
  const classification = item.browse_info?.classification?.[0]
    || item.classification
    || item.classifications?.[0]
    || 'unknown';
  const foundry = item.foundry?.name || item.foundry || 'unknown';
  const languages = item.browse_info?.language || item.language || item.languages || [];

  const variations = Array.isArray(item.variations) ? item.variations : [];
  const weights = [];
  const styles = [];
  for (const v of variations) {
    if (v?.fvd && typeof v.fvd === 'string' && v.fvd.length >= 2) {
      const styleCode = v.fvd.slice(0, 1);
      const weightCode = v.fvd.slice(1);
      styles.push(styleCode === 'n' ? 'normal' : 'italic');
      weights.push(weightCode);
    } else if (typeof v === 'string') {
      styles.push(v.includes('i') ? 'italic' : 'normal');
      weights.push(v.replace(/[^0-9]/g, '') || v);
    }
  }

  return {
    familyName,
    slug,
    cssFamily,
    description: item.description || '',
    webLink: item.web_link || item.webLink || '',
    classification,
    foundry,
    languages: Array.isArray(languages) ? languages : [String(languages)],
    cssStack: item.css_stack || 'serif',
    weights: Array.from(new Set(weights)),
    styles: Array.from(new Set(styles)),
  };
}

function normalizeKit(kit) {
  const id = kit.id || kit.kit_id || kit.slug || '';
  const name = kit.name || '';
  const domains = Array.isArray(kit.domains) ? kit.domains : [];
  const embedUrl = id ? `https://use.typekit.net/${id}.css` : '';

  return {
    id,
    name,
    domains,
    embedUrl,
    htmlLinkTag: embedUrl ? `<link rel="stylesheet" href="${embedUrl}">` : '',
  };
}

function kitCssExamples(kit) {
  const families = Array.isArray(kit.families) ? kit.families : [];
  const examples = [];
  for (const f of families) {
    const cssName = f.css_names?.[0] || f.css_name || f.name;
    if (cssName) {
      const fallback = f.stack || 'sans-serif';
      examples.push(`font-family: ${cssName}, ${fallback};`);
    }
  }
  return examples;
}

function serializeForm(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        body.append(`${key}[]`, item);
      }
    } else if (value !== undefined && value !== null && value !== '') {
      body.append(key, String(value));
    }
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function parseRetryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number.parseInt(String(value), 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30000);
  }
  const absolute = Date.parse(String(value));
  if (Number.isFinite(absolute)) {
    return Math.max(0, Math.min(absolute - Date.now(), 30000));
  }
  return 0;
}

async function requestApi(path, options = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (options.query && typeof options.query === 'object') {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const method = options.method || 'GET';
  const headers = {
    Accept: 'application/json',
    ...(hasToken() ? tokenHeaders() : {}),
    ...(options.headers || {}),
  };

  let body = undefined;
  if (options.form) {
    body = serializeForm(options.form);
  }
  const timeoutMs = clampInt(options.timeoutMs || HTTP_TIMEOUT_MS, 1000, 120000, 25000);
  const maxRetries = clampNonNegativeInt(options.maxRetries ?? HTTP_MAX_RETRIES, 0, 8, 2);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        const error = new Error(`Request failed: ${method} ${path} -> HTTP ${response.status}`);
        error.details = data;
        error.status = response.status;
        const retryable = isRetryableStatus(response.status);
        if (retryable && attempt < maxRetries) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          const backoffMs = retryAfterMs || Math.min(30000, HTTP_RETRY_BASE_MS * (2 ** attempt));
          await sleep(backoffMs);
          continue;
        }
        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;
      const isAbort = error?.name === 'AbortError' || /timeout/i.test(String(error?.message || ''));
      const isNetwork = error?.status === undefined;
      const retryable = isAbort || isNetwork || isRetryableStatus(error?.status);
      if (!(retryable && attempt < maxRetries)) {
        if (isAbort) {
          const timeoutError = new Error(`Request timed out: ${method} ${path} after ${timeoutMs}ms`);
          timeoutError.details = { timeoutMs };
          throw timeoutError;
        }
        throw error;
      }
      const backoffMs = Math.min(30000, HTTP_RETRY_BASE_MS * (2 ** attempt));
      await sleep(backoffMs);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error(`Request failed: ${method} ${path}`);
}

function buildError(message, details) {
  const err = new Error(message);
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function loadPlaywrightOrFail(jsonMode) {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('playwright');
  } catch (error) {
    fail(
      'Playwright is not installed. Run `npm install` in this repository before using `afont view`.',
      1,
      {
        hint: 'After install, run `npx playwright install chromium` if browser binaries are missing.',
        originalError: error.message,
      },
      jsonMode,
    );
  }
}

function canonicalizeAdobeUrl(rawUrl, jsonMode) {
  const input = String(rawUrl || '').trim();
  if (!input) {
    fail('Missing --url value for view command.', 2, undefined, jsonMode);
  }

  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    fail(`Invalid --url value: ${input}`, 2, undefined, jsonMode);
  }

  const host = parsed.hostname.toLowerCase();
  if (!VIEW_HOSTS.has(host)) {
    fail('View URL must be hosted on fonts.adobe.com or typekit.com.', 2, { host }, jsonMode);
  }

  parsed.protocol = 'https:';
  if (host === 'typekit.com' || host === 'www.typekit.com') {
    parsed.hostname = 'fonts.adobe.com';
  }
  parsed.hash = '';
  return parsed.toString();
}

function buildViewOutputPath(flags, familySlug) {
  const outputDirRaw = flags['output-dir']
    ? String(flags['output-dir']).trim()
    : path.join(CACHE_DIR, 'views');
  const outputDir = path.resolve(outputDirRaw);

  let filename;
  if (flags.filename) {
    filename = path.basename(String(flags.filename).trim());
    if (!filename.toLowerCase().endsWith('.png')) {
      filename = `${filename}.png`;
    }
  } else {
    const base = safeFilenamePart(familySlug || 'afont-view');
    filename = `${base}-${timestampForFilename()}.png`;
  }

  return {
    outputDir,
    filename,
    outputPath: path.join(outputDir, filename),
  };
}

async function resolveViewTarget(flags, warnings, jsonMode) {
  const familyRef = String(flags.family || '').trim();
  const urlInput = flags.url ? String(flags.url).trim() : '';

  if (!familyRef && !urlInput) {
    fail('Missing --family or --url for view command.', 2, undefined, jsonMode);
  }

  if (urlInput) {
    const pageUrl = canonicalizeAdobeUrl(urlInput, jsonMode);
    const inferredSlug = inferFamilySlugFromUrl(pageUrl);
    return {
      familyRef: familyRef || inferredSlug || '',
      resolvedFamilySlug: inferredSlug || familyRef || '',
      pageUrl,
    };
  }

  if (!hasToken()) {
    fail('Missing ADOBE_FONTS_API_TOKEN. Provide --url or set token to resolve --family.', 2, undefined, jsonMode);
  }

  let detail = await getFamilyDetailSafe(familyRef, warnings);
  if (!detail) {
    const searchPayload = await searchViaApi({ query: familyRef, limit: 1 }, []);
    const searchWarnings = searchPayload?.result?.warnings || [];
    for (const warning of searchWarnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    const top = searchPayload?.result?.fonts?.[0];
    if (!top?.slug) {
      fail(`Could not resolve family "${familyRef}" to an Adobe Fonts page.`, 3, undefined, jsonMode);
    }
    detail = await getFamilyDetailSafe(top.slug, warnings);
    if (!detail) {
      fail(`Failed to resolve family detail for "${top.slug}".`, 3, undefined, jsonMode);
    }
    warnings.push(`Resolved "${familyRef}" via search to "${top.slug}".`);
  }

  const normalized = normalizeFont(detail);
  const fallbackSlug = normalized.slug || familyRef.toLowerCase().replace(/\s+/g, '-');
  const pageUrl = canonicalizeAdobeUrl(
    normalized.webLink || `https://fonts.adobe.com/fonts/${fallbackSlug}`,
    jsonMode,
  );
  const resolvedFamilySlug = normalized.slug || inferFamilySlugFromUrl(pageUrl) || fallbackSlug;

  return {
    familyRef,
    resolvedFamilySlug,
    pageUrl,
  };
}

async function captureAdobeScreenshot(options) {
  const playwright = loadPlaywrightOrFail(options.jsonMode);
  const width = options.width;
  const height = options.height;
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width, height },
    });
    const page = await context.newPage();
    await page.goto(options.pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      // Some pages keep long-polling; do not fail solely on networkidle.
    }
    if (options.waitMs > 0) {
      await page.waitForTimeout(options.waitMs);
    }
    await page.evaluate(() => {
      const selectors = [
        '#onetrust-consent-sdk',
        '.onetrust-pc-dark-filter',
        '[id*="cookie"]',
        '[class*="cookie"]',
      ];
      for (const selector of selectors) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
          if (node instanceof HTMLElement) {
            node.style.setProperty('display', 'none', 'important');
            node.style.setProperty('visibility', 'hidden', 'important');
          }
        }
      }
    });

    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    await page.screenshot({
      path: options.outputPath,
      type: 'png',
      fullPage: options.fullPage,
    });
    await context.close();
  } catch (error) {
    const message = String(error?.message || error || 'unknown playwright error');
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      throw buildError(
        'Chromium is not installed for Playwright. Run `npx playwright install chromium` and retry.',
        { originalError: message },
      );
    }
    if (/Timeout/i.test(message)) {
      throw buildError(
        `Timed out while loading ${options.pageUrl}. Try increasing --timeout-ms or retry.`,
        { originalError: message },
      );
    }
    throw buildError('Failed to capture Adobe Fonts screenshot.', { originalError: message });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const imageBytes = fs.readFileSync(options.outputPath);
  return {
    screenshotBytes: imageBytes.byteLength,
    sha256: crypto.createHash('sha256').update(imageBytes).digest('hex'),
  };
}

async function getAllLibraries() {
  const data = await requestApi('/libraries');
  if (Array.isArray(data.libraries)) {
    return data.libraries;
  }
  if (Array.isArray(data.library)) {
    return data.library;
  }
  return [];
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = toPositiveInt(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
}

function clampNonNegativeInt(value, min, max, fallback) {
  const parsed = toNonNegativeInt(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function parseBooleanFlag(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function safeFilenamePart(value, fallback = 'afont-view') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return normalized || fallback;
}

function timestampForFilename() {
  return nowIso().replace(/[:.]/g, '-');
}

function inferFamilySlugFromUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    const match = parsed.pathname.match(/^\/fonts\/([^/]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]).toLowerCase();
    }
  } catch {
    return '';
  }
  return '';
}

function scoreBasicFamilyName(name, id, query) {
  const n = String(name || '').toLowerCase();
  const fid = String(id || '').toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;

  let score = 0;
  if (n === q) score += 140;
  if (fid === q) score += 130;
  if (n.includes(q)) score += 90;
  if (n.split(/[\s-]+/).some((part) => part.startsWith(q))) score += 35;
  return score;
}

async function getLibraryFamiliesPage(libraryId, page, perPage) {
  const data = await requestApi(`/libraries/${encodeURIComponent(libraryId)}`, {
    query: {
      page,
      per_page: perPage,
    },
  });
  const library = data.library || data;
  const families = Array.isArray(library.families) ? library.families : [];
  const pagination = library.pagination || {};
  return { families, pagination };
}

async function getLibraryFamiliesPaged(libraryId, options = {}) {
  const perPage = clampInt(options.perPage || 500, 1, 500, 500);
  const maxPages = clampInt(options.maxPages || 20, 1, 100, 20);

  const families = [];
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount && page <= maxPages) {
    const result = await getLibraryFamiliesPage(libraryId, page, perPage);
    families.push(...result.families);
    pageCount = toPositiveInt(result.pagination.page_count, page);
    if (result.families.length === 0) break;
    page += 1;
  }

  return {
    families,
    pagesScanned: Math.min(maxPages, pageCount),
    pageCount,
    truncated: maxPages < pageCount,
  };
}

function preferredSearchLibraries(libraries) {
  const ids = libraries
    .map((lib) => lib.id || lib.slug || '')
    .filter(Boolean);

  for (const preferred of ['full', 'personal', 'trial']) {
    if (ids.includes(preferred)) return [preferred];
  }
  return ids.length > 0 ? [ids[0]] : [];
}

async function getFamilyDetailSafe(ref, warnings) {
  try {
    const data = await requestApi(`/families/${encodeURIComponent(ref)}`);
    return data.family || null;
  } catch (err) {
    if (err.status === 404) return null;
    warnings.push(`Failed loading family ${ref}: ${err.message}`);
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  if (items.length === 0) return [];
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const out = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      out[current] = await fn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}

function scoreFont(font, query, classification, language) {
  if (classification) {
    const classMatch = String(font.classification || '').toLowerCase().includes(classification.toLowerCase());
    if (!classMatch) return 0;
  }
  if (language) {
    const languageMatches = Array.isArray(font.languages)
      && font.languages.some((lang) => String(lang).toLowerCase() === language.toLowerCase());
    if (!languageMatches) return 0;
  }

  let score = 0;
  const q = query.toLowerCase();
  if (font.familyName.toLowerCase() === q || font.slug.toLowerCase() === q) score += 120;
  if (font.familyName.toLowerCase().includes(q)) score += 90;
  if (font.slug.toLowerCase().includes(q)) score += 70;
  if (classification) score += 20;
  if (language) score += 15;
  return score;
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hasSqliteCli() {
  const result = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
  return result.status === 0;
}

function runSqlite(sql, options = {}) {
  const json = Boolean(options.json);
  ensureCacheDir();
  const args = [];
  args.push('-cmd', '.timeout 5000');
  if (json) args.push('-json');
  args.push(CACHE_DB);
  const result = spawnSync('sqlite3', args, {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.error) {
    throw new Error(`sqlite3 failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(`sqlite3 failed: ${details || 'unknown error'}`);
  }
  if (json) {
    const trimmed = result.stdout.trim();
    return trimmed ? JSON.parse(trimmed) : [];
  }
  return result.stdout;
}

function ensureIndexSchema() {
  runSqlite(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      slug TEXT,
      name TEXT NOT NULL,
      description TEXT,
      web_link TEXT,
      classification TEXT,
      foundry TEXT,
      css_stack TEXT,
      languages_json TEXT,
      variations_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS page_hashes (
      library_id TEXT NOT NULL,
      page INTEGER NOT NULL,
      hash TEXT NOT NULL,
      family_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (library_id, page)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS families_fts USING fts5(
      id UNINDEXED,
      slug,
      name,
      description,
      classification,
      foundry
    );
  `);
}

function hashPageFamilies(families) {
  const payload = families
    .map((family) => `${family.id || ''}:${family.name || ''}`)
    .join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function buildFtsQuery(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
  return tokens.map((token) => `${token}*`).join(' AND ');
}

function rowToFont(row) {
  const languages = (() => {
    try {
      return JSON.parse(row.languages_json || '[]');
    } catch {
      return [];
    }
  })();
  const variations = (() => {
    try {
      return JSON.parse(row.variations_json || '[]');
    } catch {
      return [];
    }
  })();
  return normalizeFont({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    web_link: row.web_link,
    foundry: row.foundry ? { name: row.foundry } : undefined,
    classification: row.classification,
    css_stack: row.css_stack || 'serif',
    browse_info: {
      classification: row.classification ? [row.classification] : [],
      language: Array.isArray(languages) ? languages : [],
    },
    variations,
  });
}

function getIndexStatusSync() {
  if (!fs.existsSync(CACHE_DB)) {
    return {
      exists: false,
      dbPath: CACHE_DB,
      stale: true,
      staleAfterHours: CACHE_MAX_AGE_HOURS,
    };
  }

  ensureIndexSchema();
  const metadataRows = runSqlite('SELECT key, value FROM metadata;', { json: true });
  const metadata = {};
  for (const row of metadataRows) metadata[row.key] = row.value;
  const countRows = runSqlite('SELECT COUNT(*) AS count FROM families;', { json: true });
  const familyCount = Number.parseInt(String(countRows[0]?.count || '0'), 10) || 0;
  const lastRefreshAt = metadata.last_refresh_at || null;
  const ageMs = lastRefreshAt ? (Date.now() - Date.parse(lastRefreshAt)) : Number.POSITIVE_INFINITY;
  const stale = !Number.isFinite(ageMs) || ageMs > CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;

  return {
    exists: true,
    dbPath: CACHE_DB,
    familyCount,
    lastRefreshAt,
    stale,
    staleAfterHours: CACHE_MAX_AGE_HOURS,
    libraries: metadata.libraries || '',
  };
}

function getIndexStatusSafe() {
  if (!fs.existsSync(CACHE_DB)) {
    return getIndexStatusSync();
  }
  if (!hasSqliteCli()) {
    return {
      exists: true,
      dbPath: CACHE_DB,
      stale: true,
      staleAfterHours: CACHE_MAX_AGE_HOURS,
      error: 'sqlite3 CLI is not available; status metadata unavailable.',
    };
  }
  return getIndexStatusSync();
}

function queryTopCounts(column, limit) {
  return runSqlite(`
    SELECT
      CASE
        WHEN TRIM(COALESCE(${column}, '')) = '' THEN 'unknown'
        ELSE LOWER(TRIM(${column}))
      END AS value,
      COUNT(*) AS count
    FROM families
    GROUP BY value
    ORDER BY count DESC, value ASC
    LIMIT ${limit};
  `, { json: true }).map((row) => ({
    value: row.value,
    count: Number.parseInt(String(row.count || '0'), 10) || 0,
  }));
}

function getIndexStatsSync(limit = 8) {
  ensureIndexSchema();
  const safeLimit = clampInt(limit, 1, 50, 8);
  const totalRows = runSqlite('SELECT COUNT(*) AS count FROM families;', { json: true });
  const distinctClassRows = runSqlite(`
    SELECT COUNT(DISTINCT CASE WHEN TRIM(COALESCE(classification, '')) = '' THEN 'unknown' ELSE LOWER(TRIM(classification)) END) AS count
    FROM families;
  `, { json: true });
  const distinctFoundryRows = runSqlite(`
    SELECT COUNT(DISTINCT CASE WHEN TRIM(COALESCE(foundry, '')) = '' THEN 'unknown' ELSE LOWER(TRIM(foundry)) END) AS count
    FROM families;
  `, { json: true });

  return {
    familyCount: Number.parseInt(String(totalRows[0]?.count || '0'), 10) || 0,
    distinctClassifications: Number.parseInt(String(distinctClassRows[0]?.count || '0'), 10) || 0,
    distinctFoundries: Number.parseInt(String(distinctFoundryRows[0]?.count || '0'), 10) || 0,
    topClassifications: queryTopCounts('classification', safeLimit),
    topFoundries: queryTopCounts('foundry', safeLimit),
  };
}

function searchLocalIndex(query, options = {}) {
  ensureIndexSchema();
  const limit = clampInt(options.limit || 8, 1, 50, 8);
  const classification = String(options.classification || '').trim().toLowerCase();
  const language = String(options.language || '').trim().toLowerCase();
  const warnings = options.warnings || [];

  const filters = [];
  if (classification) filters.push(`LOWER(COALESCE(f.classification, '')) LIKE ${sqlLiteral(`%${classification}%`)}`);
  if (language) filters.push(`LOWER(COALESCE(f.languages_json, '')) LIKE ${sqlLiteral(`%${language}%`)}`);
  const whereExtra = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';

  const ftsQuery = buildFtsQuery(query);
  let rows = [];
  if (ftsQuery) {
    rows = runSqlite(`
      SELECT
        f.id,
        f.slug,
        f.name,
        f.description,
        f.web_link,
        f.classification,
        f.foundry,
        f.css_stack,
        f.languages_json,
        f.variations_json
      FROM families_fts
      JOIN families f ON f.id = families_fts.id
      WHERE families_fts MATCH ${sqlLiteral(ftsQuery)}${whereExtra}
      ORDER BY bm25(families_fts)
      LIMIT ${limit};
    `, { json: true });
  }

  if (rows.length === 0) {
    rows = runSqlite(`
      SELECT
        f.id,
        f.slug,
        f.name,
        f.description,
        f.web_link,
        f.classification,
        f.foundry,
        f.css_stack,
        f.languages_json,
        f.variations_json
      FROM families f
      WHERE (
        LOWER(COALESCE(f.name, '')) LIKE ${sqlLiteral(`%${String(query).toLowerCase()}%`)}
        OR LOWER(COALESCE(f.slug, '')) LIKE ${sqlLiteral(`%${String(query).toLowerCase()}%`)}
        OR LOWER(COALESCE(f.description, '')) LIKE ${sqlLiteral(`%${String(query).toLowerCase()}%`)}
      )${whereExtra}
      ORDER BY f.name
      LIMIT ${limit};
    `, { json: true });
  }

  const fonts = rows.map((row) => rowToFont(row));
  if (fonts.length === 0 && ftsQuery) {
    warnings.push('No local cache match. Try `afont search --query <term> --refresh-cache`.');
  }
  return fonts;
}

async function refreshLocalIndex(options = {}) {
  if (!hasSqliteCli()) {
    throw new Error('sqlite3 CLI is required for local font indexing.');
  }
  if (!hasToken()) {
    throw new Error('Missing ADOBE_FONTS_API_TOKEN.');
  }

  const perPage = clampInt(options.perPage || 500, 1, 500, 500);
  const maxPages = clampInt(options.maxPages || 40, 1, 200, 40);
  const warnings = options.warnings || [];

  ensureIndexSchema();
  const libraries = await getAllLibraries();
  const availableLibraryIds = libraries.map((library) => library.id || library.slug).filter(Boolean);
  const selectedLibraries = options.libraryId
    ? [String(options.libraryId)]
    : preferredSearchLibraries(libraries);

  if (selectedLibraries.length === 0) {
    throw new Error('No libraries available for indexing.');
  }
  for (const libraryId of selectedLibraries) {
    if (!availableLibraryIds.includes(libraryId)) {
      warnings.push(`Library "${libraryId}" is not in token-visible libraries: ${availableLibraryIds.join(', ')}`);
    }
  }

  const existingHashes = runSqlite('SELECT library_id, page, hash FROM page_hashes;', { json: true });
  const pageHashMap = new Map(existingHashes.map((row) => [`${row.library_id}:${row.page}`, row.hash]));
  const existingFamilies = runSqlite('SELECT id FROM families;', { json: true });
  const existingIds = new Set(existingFamilies.map((row) => row.id));

  const allFamilyIds = new Set();
  const idsToFetch = new Set();
  const pageHashes = [];

  for (const libraryId of selectedLibraries) {
    let page = 1;
    let pageCount = 1;
    while (page <= pageCount && page <= maxPages) {
      const result = await getLibraryFamiliesPage(libraryId, page, perPage);
      pageCount = toPositiveInt(result.pagination.page_count, page);
      const families = result.families || [];
      const pageHash = hashPageFamilies(families);
      pageHashes.push({
        libraryId,
        page,
        hash: pageHash,
        familyCount: families.length,
      });

      const priorHash = pageHashMap.get(`${libraryId}:${page}`);
      const pageChanged = priorHash !== pageHash;
      if (page > maxPages) {
        warnings.push(`Library "${libraryId}" was truncated at max pages (${maxPages}).`);
      }

      for (const family of families) {
        if (!family?.id) continue;
        allFamilyIds.add(family.id);
        if (pageChanged || !existingIds.has(family.id)) {
          idsToFetch.add(family.id);
        }
      }
      if (families.length === 0) break;
      page += 1;
    }
  }

  const familyIds = Array.from(idsToFetch);
  const detailedFamilies = await mapLimit(familyIds, 4, async (familyId) => getFamilyDetailSafe(familyId, warnings));
  const validFamilies = detailedFamilies.filter((family) => family && family.id);
  const refreshedAt = nowIso();

  const statements = ['BEGIN;'];
  for (const family of validFamilies) {
    statements.push(`
      INSERT INTO families (
        id, slug, name, description, web_link, classification, foundry, css_stack, languages_json, variations_json, updated_at
      ) VALUES (
        ${sqlLiteral(family.id)},
        ${sqlLiteral(family.slug || '')},
        ${sqlLiteral(family.name || family.id)},
        ${sqlLiteral(family.description || '')},
        ${sqlLiteral(family.web_link || '')},
        ${sqlLiteral(family.browse_info?.classification?.[0] || '')},
        ${sqlLiteral(family.foundry?.name || '')},
        ${sqlLiteral(family.css_stack || 'serif')},
        ${sqlLiteral(JSON.stringify(family.browse_info?.language || []))},
        ${sqlLiteral(JSON.stringify(family.variations || []))},
        ${sqlLiteral(refreshedAt)}
      )
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug,
        name=excluded.name,
        description=excluded.description,
        web_link=excluded.web_link,
        classification=excluded.classification,
        foundry=excluded.foundry,
        css_stack=excluded.css_stack,
        languages_json=excluded.languages_json,
        variations_json=excluded.variations_json,
        updated_at=excluded.updated_at;
    `);
  }

  if (allFamilyIds.size > 0) {
    const idList = Array.from(allFamilyIds).map((id) => sqlLiteral(id)).join(', ');
    statements.push(`DELETE FROM families WHERE id NOT IN (${idList});`);
  }

  const selectedLibraryList = selectedLibraries.map((id) => sqlLiteral(id)).join(', ');
  statements.push(`DELETE FROM page_hashes WHERE library_id IN (${selectedLibraryList});`);
  for (const row of pageHashes) {
    statements.push(`
      INSERT INTO page_hashes (library_id, page, hash, family_count, updated_at)
      VALUES (
        ${sqlLiteral(row.libraryId)},
        ${row.page},
        ${sqlLiteral(row.hash)},
        ${row.familyCount},
        ${sqlLiteral(refreshedAt)}
      );
    `);
  }

  statements.push(`DELETE FROM families_fts;`);
  statements.push(`
    INSERT INTO families_fts (id, slug, name, description, classification, foundry)
    SELECT
      id,
      COALESCE(slug, ''),
      COALESCE(name, ''),
      COALESCE(description, ''),
      COALESCE(classification, ''),
      COALESCE(foundry, '')
    FROM families;
  `);
  statements.push(`
    INSERT INTO metadata (key, value) VALUES ('last_refresh_at', ${sqlLiteral(refreshedAt)})
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  `);
  statements.push(`
    INSERT INTO metadata (key, value) VALUES ('libraries', ${sqlLiteral(selectedLibraries.join(','))})
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  `);
  statements.push('COMMIT;');

  runSqlite(statements.join('\n'));
  const status = getIndexStatusSync();
  return {
    refreshedAt,
    fetchedFamilies: validFamilies.length,
    requestedFamilies: familyIds.length,
    libraries: selectedLibraries,
    status,
    warnings,
  };
}

async function commandDoctor(flags) {
  const warnings = [];
  const checks = {
    tokenPresent: hasToken(),
    apiReachable: false,
    endpoint: BASE_URL,
    sqliteCliAvailable: hasSqliteCli(),
  };

  if (!checks.tokenPresent) {
    warnings.push(`ADOBE_FONTS_API_TOKEN is not set. Generate a token at ${TOKEN_PAGE_URL} and export it before retrying.`);
  }

  try {
    await requestApi('/kits');
    checks.apiReachable = true;
  } catch (err) {
    warnings.push(`API reachability check failed: ${err.message}`);
  }

  const cache = getIndexStatusSafe();
  if (!checks.sqliteCliAvailable) {
    warnings.push('sqlite3 CLI is not available; local search cache cannot be used.');
  } else if (!cache.exists) {
    warnings.push(cacheWarmupWarning());
  } else if (cache.stale) {
    warnings.push(staleCacheWarning(cache.lastRefreshAt));
  }

  const payload = {
    result: {
      intent: 'doctor',
      checks,
      cache,
      warnings,
      nextActions: checks.apiReachable
        ? (!cache.exists
            ? [CACHE_WARMUP_COMMAND, 'Run afont search --query <keyword>']
            : (cache.stale
                ? [CACHE_WARMUP_COMMAND, 'Run afont search --query <keyword>']
                : ['Run afont search --query <keyword>']))
        : ['Verify token and run afont doctor again'],
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
  if (!checks.tokenPresent || !checks.apiReachable) {
    process.exit(1);
  }
}

async function searchViaApi(flags, inheritedWarnings = []) {
  const query = String(flags.query || '').trim();
  const classification = flags.classification ? String(flags.classification) : '';
  const language = flags.language ? String(flags.language) : '';
  const limit = clampInt(flags.limit || 8, 1, 50, 8);
  const perPage = clampInt(flags['per-page'] || 500, 1, 500, 500);
  const maxPages = clampInt(flags['max-pages'] || 20, 1, 100, 20);

  if (!query) {
    fail('Missing --query for search command.', 2, undefined, isJson(flags));
  }
  if (!hasToken()) fail('Missing ADOBE_FONTS_API_TOKEN.', 2, undefined, isJson(flags));

  const warnings = [...inheritedWarnings];
  const libraries = await getAllLibraries();
  const searchLibraryIds = preferredSearchLibraries(libraries);
  if (searchLibraryIds.length === 0) {
    fail('No Adobe font libraries are available for this token.', 1, undefined, isJson(flags));
  }

  const basicFamilyMap = new Map();
  for (const libraryId of searchLibraryIds) {
    try {
      const paged = await getLibraryFamiliesPaged(libraryId, { perPage, maxPages });
      if (paged.truncated) {
        warnings.push(`Search scanned first ${paged.pagesScanned}/${paged.pageCount} pages in "${libraryId}". Increase --max-pages for exhaustive results.`);
      }
      for (const family of paged.families) {
        if (family && family.id && !basicFamilyMap.has(family.id)) {
          basicFamilyMap.set(family.id, family);
        }
      }
    } catch (err) {
      warnings.push(`Failed loading library ${libraryId}: ${err.message}`);
    }
  }

  const basics = Array.from(basicFamilyMap.values());
  const rankedBasics = basics
    .map((family) => ({
      ...family,
      _score: scoreBasicFamilyName(family.name, family.id, query),
    }))
    .filter((family) => family._score > 0)
    .sort((a, b) => b._score - a._score || String(a.name).localeCompare(String(b.name)));

  const detailMap = new Map();
  const directRefs = Array.from(new Set([
    query,
    query.toLowerCase().replace(/\s+/g, '-'),
  ]));
  for (const ref of directRefs) {
    const detail = await getFamilyDetailSafe(ref, warnings);
    if (detail?.id) detailMap.set(detail.id, detail);
  }

  const detailWindow = Math.max(limit * 8, 40);
  const familyIdsForDetail = rankedBasics
    .slice(0, detailWindow)
    .map((family) => family.id)
    .filter((id) => !detailMap.has(id));

  const detailedFamilies = await mapLimit(familyIdsForDetail, 4, async (familyId) => getFamilyDetailSafe(familyId, warnings));
  for (const detail of detailedFamilies) {
    if (detail?.id) detailMap.set(detail.id, detail);
  }

  const filtered = Array.from(detailMap.values())
    .map((family) => normalizeFont(family))
    .map((font) => ({ ...font, score: scoreFont(font, query, classification, language) }))
    .filter((font) => font.score > 0)
    .sort((a, b) => b.score - a.score || a.familyName.localeCompare(b.familyName))
    .slice(0, limit)
    .map(({ score, ...font }) => font);

  const payload = {
    result: {
      intent: 'search',
      fonts: filtered,
      snippets: {
        htmlLinkTag: '',
        cssExamples: filtered.slice(0, 3).map((f) => `font-family: ${f.cssFamily}, ${f.cssStack || 'serif'};`),
      },
      nextActions: filtered.length > 0
        ? [
            `Run afont kits ensure --name <kit-name> --domains <domain1,domain2>`,
            `Run afont kits add-family --kit <kit> --family ${filtered[0].slug}`,
          ]
        : ['Try a broader --query keyword'],
      warnings,
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  return payload;
}

async function commandIndexRefresh(flags) {
  const warnings = [];
  const result = await refreshLocalIndex({
    libraryId: flags.library ? String(flags.library) : undefined,
    perPage: flags['per-page'],
    maxPages: flags['max-pages'],
    warnings,
  });

  const payload = {
    result: {
      intent: 'index_refresh',
      cache: {
        dbPath: CACHE_DB,
        lastRefreshAt: result.refreshedAt,
        familyCount: result.status.familyCount,
        libraries: result.libraries,
        fetchedFamilies: result.fetchedFamilies,
        requestedFamilies: result.requestedFamilies,
      },
      warnings,
      nextActions: [
        'Run afont search --query <keyword>',
      ],
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
}

function commandIndexStatus(flags) {
  const status = getIndexStatusSafe();
  const warnings = [];
  if (!hasSqliteCli()) {
    warnings.push('sqlite3 CLI is not available; local search cache cannot be used.');
  } else if (!status.exists) {
    warnings.push(cacheWarmupWarning());
  } else if (status.stale) {
    warnings.push(staleCacheWarning(status.lastRefreshAt));
  }
  const payload = {
    result: {
      intent: 'index_status',
      cache: status,
      warnings,
      nextActions: status.exists
        ? (status.stale
            ? [CACHE_WARMUP_COMMAND, 'Run afont search --query <keyword>']
            : ['Run afont search --query <keyword>'])
        : [CACHE_WARMUP_COMMAND],
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };
  printPayload(payload, isJson(flags));
}

function commandIndexStats(flags) {
  const status = getIndexStatusSafe();
  const warnings = [];
  if (!hasSqliteCli()) {
    warnings.push('sqlite3 CLI is not available; local cache stats cannot be queried.');
  }
  if (!status.exists) {
    warnings.push(cacheWarmupWarning());
  } else if (status.stale) {
    warnings.push(staleCacheWarning(status.lastRefreshAt));
  }

  let stats = null;
  if (status.exists && hasSqliteCli()) {
    stats = getIndexStatsSync(flags.limit);
  }

  const payload = {
    result: {
      intent: 'index_stats',
      cache: status,
      stats,
      warnings,
      nextActions: !status.exists
        ? [CACHE_WARMUP_COMMAND]
        : ['Run afont search --query <keyword> --cache-only'],
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };
  printPayload(payload, isJson(flags));
}

async function commandSearch(flags) {
  const query = String(flags.query || '').trim();
  if (!query) fail('Missing --query for search command.', 2, undefined, isJson(flags));

  const classification = flags.classification ? String(flags.classification) : '';
  const language = flags.language ? String(flags.language) : '';
  const limit = clampInt(flags.limit || 8, 1, 50, 8);
  const warnings = [];

  const useCache = !Boolean(flags['no-cache']);
  const cacheOnly = Boolean(flags['cache-only']);
  const refreshCache = Boolean(flags['refresh-cache']);
  const confirmUncached = Boolean(flags['confirm-uncached']) || Boolean(flags['force-uncached']);

  if (!useCache && !confirmUncached) {
    const status = getIndexStatusSafe();
    if (!status.exists || status.stale) {
      fail(
        `Refusing uncached search with ${status.exists ? 'stale' : 'empty'} cache. Consult user first, then rerun with --confirm-uncached or warm cache with \`${CACHE_WARMUP_COMMAND}\`.`,
        2,
        {
          cache: status,
          nextActions: [CACHE_WARMUP_COMMAND, 'Rerun with --no-cache --confirm-uncached only if user approves slow uncached search.'],
        },
        isJson(flags),
      );
    }
  }

  if (useCache && hasSqliteCli()) {
    let status = getIndexStatusSync();
    if (refreshCache && hasToken()) {
      try {
        await refreshLocalIndex({
          perPage: flags['per-page'],
          maxPages: flags['max-pages'],
          warnings,
        });
        status = getIndexStatusSync();
      } catch (err) {
        warnings.push(`Cache refresh failed: ${err.message}`);
      }
    } else if (!hasToken() && refreshCache) {
      warnings.push('Token missing; cache refresh skipped.');
    } else if (!status.exists) {
      warnings.push(cacheWarmupWarning());
    } else if (status.stale) {
      warnings.push(staleCacheWarning(status.lastRefreshAt));
    }

    if (status.exists) {
      const fonts = searchLocalIndex(query, {
        classification,
        language,
        limit,
        warnings,
      });
      const payload = {
        result: {
          intent: 'search',
          fonts,
          snippets: {
            htmlLinkTag: '',
            cssExamples: fonts.slice(0, 3).map((font) => `font-family: ${font.cssFamily}, ${font.cssStack || 'serif'};`),
          },
          nextActions: fonts.length > 0
            ? [
                'Run afont kits ensure --name <kit-name> --domains <domain1,domain2>',
                `Run afont kits add-family --kit <kit> --family ${fonts[0].slug}`,
              ]
            : ['Try a broader --query keyword'],
          warnings,
          cache: {
            dbPath: CACHE_DB,
            lastRefreshAt: status.lastRefreshAt || null,
            stale: status.stale,
          },
        },
        meta: {
          source: 'adobe_api',
          timestamp: nowIso(),
        },
      };

      if (fonts.length > 0 || cacheOnly || !hasToken()) {
        printPayload(payload, isJson(flags));
        return;
      }
    }
  }

  if (cacheOnly) {
    const payload = {
      result: {
        intent: 'search',
        fonts: [],
        snippets: { htmlLinkTag: '', cssExamples: [] },
        nextActions: [CACHE_WARMUP_COMMAND, 'Consult user before running uncached search (--no-cache).'],
        warnings: [...warnings, 'Cache-only mode enabled and no cache match found.'],
      },
      meta: {
        source: 'adobe_api',
        timestamp: nowIso(),
      },
    };
    printPayload(payload, isJson(flags));
    return;
  }

  const payload = await searchViaApi(flags, warnings);
  printPayload(payload, isJson(flags));
}

async function commandView(flags) {
  const jsonMode = isJson(flags);
  const dryRun = Boolean(flags['dry-run']);
  const warnings = [];
  const width = clampInt(flags.width || VIEW_DEFAULT_WIDTH, 320, 5000, VIEW_DEFAULT_WIDTH);
  const height = clampInt(flags.height || VIEW_DEFAULT_HEIGHT, 320, 8000, VIEW_DEFAULT_HEIGHT);
  const waitMs = clampNonNegativeInt(flags['wait-ms'] ?? VIEW_DEFAULT_WAIT_MS, 0, 60000, VIEW_DEFAULT_WAIT_MS);
  const timeoutMs = clampInt(flags['timeout-ms'] || VIEW_DEFAULT_TIMEOUT_MS, 1000, 300000, VIEW_DEFAULT_TIMEOUT_MS);
  const fullPage = parseBooleanFlag(flags['no-full-page'], false)
    ? false
    : parseBooleanFlag(flags['full-page'], true);

  const target = await resolveViewTarget(flags, warnings, jsonMode);
  const output = buildViewOutputPath(flags, target.resolvedFamilySlug || target.familyRef || 'afont-preview');
  const imagePath = output.outputPath;
  const markdownImage = `![afont-preview](${imagePath})`;

  let screenshotBytes = 0;
  let sha256 = '';
  if (!dryRun) {
    const capture = await captureAdobeScreenshot({
      pageUrl: target.pageUrl,
      outputPath: imagePath,
      width,
      height,
      waitMs,
      timeoutMs,
      fullPage,
      jsonMode,
    });
    screenshotBytes = capture.screenshotBytes;
    sha256 = capture.sha256;
  }

  const payload = {
    result: {
      intent: 'view',
      view: {
        familyRef: target.familyRef || '',
        resolvedFamilySlug: target.resolvedFamilySlug || '',
        pageUrl: target.pageUrl,
        source: 'adobe_page',
        outputDir: output.outputDir,
        screenshotPath: imagePath,
        screenshotBytes,
        sha256,
        viewport: {
          width,
          height,
        },
        fullPage,
      },
      codex: {
        imagePath,
        markdownImage,
      },
      warnings,
      nextActions: dryRun
        ? ['Run afont view without --dry-run to capture a real screenshot.']
        : ['Give result.codex.markdownImage to Codex for visual analysis.'],
      dryRun,
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, jsonMode);
}

async function listKits() {
  const data = await requestApi('/kits');
  if (Array.isArray(data.kits)) return data.kits;
  if (Array.isArray(data.kit)) return data.kit;
  if (data.kit) return [data.kit];
  return [];
}

async function findKitByNameOrId(value) {
  const kits = await listKits();
  const lowered = String(value).toLowerCase();
  const match = kits.find((k) => String(k.id).toLowerCase() === lowered)
    || kits.find((k) => String(k.name).toLowerCase() === lowered);

  if (!match) {
    return null;
  }

  return match;
}

async function commandKitsList(flags) {
  if (!hasToken()) {
    fail('Missing ADOBE_FONTS_API_TOKEN.', 2, undefined, isJson(flags));
  }

  const rawKits = await listKits();
  const kits = rawKits.map((k) => normalizeKit(k));

  const payload = {
    result: {
      intent: 'kit_list',
      kits,
      warnings: [],
      nextActions: kits.length > 0
        ? ['Run afont kits embed --kit <kit-name-or-id>']
        : ['Run afont kits ensure --name <kit-name> --domains <domain1,domain2>'],
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
}

async function commandKitsEnsure(flags) {
  if (!hasToken()) {
    fail('Missing ADOBE_FONTS_API_TOKEN.', 2, undefined, isJson(flags));
  }

  const name = String(flags.name || '').trim();
  const domainsArg = String(flags.domains || DEFAULT_DOMAINS || '').trim();
  const domains = domainsArg ? domainsArg.split(',').map((d) => d.trim()).filter(Boolean) : [];
  const dryRun = Boolean(flags['dry-run']);

  if (!name) {
    fail('Missing --name for kits ensure.', 2, undefined, isJson(flags));
  }

  let existing = await findKitByNameOrId(name);
  let action = 'none';
  let kit;

  if (!existing) {
    action = 'create';
    if (dryRun) {
      kit = normalizeKit({ id: 'dry-run-kit', name, domains });
    } else {
      const created = await requestApi('/kits', {
        method: 'POST',
        form: {
          name,
          domains,
        },
      });
      kit = normalizeKit(created.kit || created);
    }
  } else {
    action = 'update';
    if (dryRun) {
      kit = normalizeKit({ ...existing, domains: domains.length > 0 ? domains : existing.domains });
    } else if (domains.length > 0) {
      const updated = await requestApi(`/kits/${encodeURIComponent(existing.id)}`, {
        method: 'POST',
        form: {
          domains,
        },
      });
      kit = normalizeKit(updated.kit || updated);
    } else {
      kit = normalizeKit(existing);
    }
  }

  const payload = {
    result: {
      intent: 'kit_update',
      kit,
      warnings: [],
      nextActions: [
        `Run afont kits add-family --kit ${kit.id || name} --family <family-slug>`,
        `Run afont kits publish --kit ${kit.id || name}`,
      ],
      dryRun,
      action,
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
}

function parseCommaList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function resolveKitOrFail(input, jsonMode) {
  const value = input || DEFAULT_KIT;
  if (!value) {
    fail('Missing --kit and ADOBE_FONTS_DEFAULT_KIT is not set.', 2, undefined, jsonMode);
  }

  const match = await findKitByNameOrId(value);
  if (!match) {
    fail(`Could not find kit: ${value}`, 3, undefined, jsonMode);
  }

  return match;
}

async function commandKitsAddFamily(flags) {
  if (!hasToken()) {
    fail('Missing ADOBE_FONTS_API_TOKEN.', 2, undefined, isJson(flags));
  }

  const kitRef = flags.kit;
  const family = String(flags.family || '').trim();
  const weights = parseCommaList(flags.weights);
  const styles = parseCommaList(flags.styles);
  const dryRun = Boolean(flags['dry-run']);

  if (!family) {
    fail('Missing --family for kits add-family.', 2, undefined, isJson(flags));
  }

  const kit = await resolveKitOrFail(kitRef, isJson(flags));

  const variations = [];
  if (weights.length > 0) {
    for (const weight of weights) {
      if (styles.length > 0) {
        for (const style of styles) {
          const prefix = style.toLowerCase().startsWith('i') ? 'i' : 'n';
          variations.push(`${prefix}${weight}`);
        }
      } else {
        variations.push(`n${weight}`);
      }
    }
  }

  if (!dryRun) {
    const form = {};
    if (variations.length > 0) {
      form.variations = variations;
    }
    await requestApi(`/kits/${encodeURIComponent(kit.id)}/families/${encodeURIComponent(family)}`, {
      method: 'POST',
      form,
    });
  }

  const refreshed = dryRun
    ? normalizeKit(kit)
    : normalizeKit((await requestApi(`/kits/${encodeURIComponent(kit.id)}`)).kit || kit);

  const payload = {
    result: {
      intent: 'kit_update',
      kit: refreshed,
      fonts: [{ familyName: family, cssFamily: family, classification: 'unknown', foundry: 'unknown', weights, styles }],
      warnings: [],
      nextActions: [`Run afont kits publish --kit ${kit.id}`],
      dryRun,
      action: 'add-family',
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
}

async function commandKitsPublish(flags) {
  if (!hasToken()) {
    fail('Missing ADOBE_FONTS_API_TOKEN.', 2, undefined, isJson(flags));
  }

  const dryRun = Boolean(flags['dry-run']);
  const kit = await resolveKitOrFail(flags.kit, isJson(flags));

  if (!dryRun) {
    await requestApi(`/kits/${encodeURIComponent(kit.id)}/publish`, { method: 'POST' });
  }

  const published = dryRun
    ? normalizeKit(kit)
    : normalizeKit((await requestApi(`/kits/${encodeURIComponent(kit.id)}/published`)).kit || kit);

  const payload = {
    result: {
      intent: 'kit_update',
      kit: published,
      warnings: [],
      nextActions: [`Run afont kits embed --kit ${kit.id}`],
      dryRun,
      action: 'publish',
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
}

async function commandKitsEmbed(flags) {
  if (!hasToken()) {
    fail('Missing ADOBE_FONTS_API_TOKEN.', 2, undefined, isJson(flags));
  }

  const kit = await resolveKitOrFail(flags.kit, isJson(flags));
  const detail = (await requestApi(`/kits/${encodeURIComponent(kit.id)}`)).kit || kit;
  const normalized = normalizeKit(detail);
  const cssExamples = kitCssExamples(detail);

  const payload = {
    result: {
      intent: 'embed',
      kit: normalized,
      snippets: {
        htmlLinkTag: normalized.htmlLinkTag,
        cssExamples,
      },
      warnings: [],
      nextActions: [
        'Insert the link tag in your app head/layout.',
        'Apply a cssExample value to your target selector.',
      ],
    },
    meta: {
      source: 'adobe_api',
      timestamp: nowIso(),
    },
  };

  printPayload(payload, isJson(flags));
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (positional.length === 0 || flags.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const command = positional[0];

  try {
    if (command === 'doctor') {
      await commandDoctor(flags);
      return;
    }

    if (command === 'search') {
      await commandSearch(flags);
      return;
    }

    if (command === 'view') {
      await commandView(flags);
      return;
    }

    if (command === 'index') {
      const sub = positional[1];
      if (!sub) fail('Missing index subcommand.', 2, undefined, isJson(flags));

      if (sub === 'refresh') {
        await commandIndexRefresh(flags);
        return;
      }
      if (sub === 'status') {
        commandIndexStatus(flags);
        return;
      }
      if (sub === 'stats') {
        commandIndexStats(flags);
        return;
      }

      fail(`Unknown index subcommand: ${sub}`, 2, undefined, isJson(flags));
      return;
    }

    if (command === 'kits') {
      const sub = positional[1];
      if (!sub) {
        fail('Missing kits subcommand.', 2, undefined, isJson(flags));
      }

      if (sub === 'list') {
        await commandKitsList(flags);
        return;
      }
      if (sub === 'ensure') {
        await commandKitsEnsure(flags);
        return;
      }
      if (sub === 'add-family') {
        await commandKitsAddFamily(flags);
        return;
      }
      if (sub === 'publish') {
        await commandKitsPublish(flags);
        return;
      }
      if (sub === 'embed') {
        await commandKitsEmbed(flags);
        return;
      }

      fail(`Unknown kits subcommand: ${sub}`, 2, undefined, isJson(flags));
      return;
    }

    fail(`Unknown command: ${command}`, 2, undefined, isJson(flags));
  } catch (error) {
    fail(error.message, 1, error.details || undefined, isJson(flags));
  }
}

main();
