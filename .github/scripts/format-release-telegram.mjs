#!/usr/bin/env node

const PRODUCT_NAMES = {
  green: 'Pollaris Green',
  tech: 'Pollaris Tech',
  stock: 'Pollaris Stock',
  snack: 'Pollaris Snack',
  instalador: 'Instalador',
  desinstalador: 'Desinstalador',
  api: 'Pollaris Api.Local',
  etiquetas: 'Pollaris Etiquetas Designer',
};

const STAGING_PRODUCTS = new Set(['green', 'tech', 'stock', 'snack']);
const LIBERABLE_PRODUCTS = new Set(['green', 'tech', 'stock', 'snack']);
const PAGES_NOTIFIED_PREFIXES = ['green', 'tech', 'stock', 'snack', 'api', 'instalador', 'desinstalador'];

const MAX_CHANGELOG_CHARS = 2800;
const MAX_MESSAGE_CHARS = 4096;

function parseTag(tagName) {
  const production = tagName.match(/^(\w+)-v(.+)$/);
  if (production) {
    return {
      product: production[1].toLowerCase(),
      version: production[2],
      kind: 'production',
    };
  }

  const preview = tagName.match(/^(\w+)-prv-(.+)$/);
  if (preview) {
    return {
      product: preview[1].toLowerCase(),
      version: preview[2],
      kind: 'preview',
    };
  }

  return {
    product: tagName.split('-')[0]?.toLowerCase() ?? 'release',
    version: null,
    kind: 'unknown',
  };
}

export function resolveReleaseTagFromCommitMessage(message) {
  const firstLine = String(message ?? '').split('\n')[0].trim();

  let match = firstLine.match(/^Atualiza (\w+)\/teste\.json para v(.+)$/i);
  if (match) return `${match[1].toLowerCase()}-v${match[2]}`;

  match = firstLine.match(/^Atualiza api\/winapi\.json para v(.+)$/i);
  if (match) return `api-v${match[1]}`;

  match = firstLine.match(/^chore: atualizar instaladores v(.+)$/i);
  if (match) return `instalador-v${match[1]}`;

  match = firstLine.match(/^chore: atualizar Desinstalador v(.+)$/i);
  if (match) return `desinstalador-v${match[1]}`;

  match = firstLine.match(/^release: (\w+) PR #(\d+) index entry v([\d.]+)$/i);
  if (match) {
    const revision = match[3].split('.').pop();
    return `${match[1].toLowerCase()}-prv-${match[2]}.${revision}`;
  }

  return null;
}

export function shouldNotifyOnReleaseEvent(tagName) {
  const product = parseTag(tagName).product;
  return !PAGES_NOTIFIED_PREFIXES.includes(product);
}

function productDisplayName(product) {
  return PRODUCT_NAMES[product] ?? product;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return null;

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function markdownToPlain(text) {
  const preserved = [];
  const keep = (value) => {
    const id = preserved.length;
    preserved.push(value);
    return `\x00${id}\x00`;
  };

  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `${keep(label)} (${keep(url)})`)
    .replace(/https?:\/\/[^\s)]+/g, keep)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\x00(\d+)\x00/g, (_, index) => preserved[Number(index)])
    .trim();
}

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 24).trimEnd()}\n\n... (mensagem truncada)`;
}

function extractChangelog(body) {
  let text = markdownToPlain(body);
  if (!text) return '';

  const parts = text.split(/\n-{3,}\n/);
  text = parts[0];

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (/^novidades(?:\s+e\s+melhorias)?$/i.test(line)) return false;
      if (/^pollaris\s+/i.test(line) && /\bv?\d+\.\d+\.\d+\.\d+/i.test(line)) return false;
      if (/^download:/i.test(line)) return false;
      if (/^configurac[aã]o de atualiza[cç][aã]o:/i.test(line)) return false;
      if (/^requisitos:/i.test(line)) return false;
      if (/^manifesto /i.test(line)) return false;
      if (/^linux /i.test(line) || /^windows /i.test(line)) return false;
      return true;
    });

  const changelog = lines.join('\n').trim();
  return truncate(changelog, MAX_CHANGELOG_CHARS);
}

function buildLinks(release, parsed) {
  const links = [];

  for (const asset of release.assets ?? []) {
    const size = formatBytes(asset.size);
    const label = size ? `${asset.name} (${size})` : asset.name;
    links.push(`- ${label}: ${asset.browser_download_url}`);
  }

  if (STAGING_PRODUCTS.has(parsed.product)) {
    links.push(`- Staging: https://releases.pollaris.com.br/${parsed.product}/teste.json`);
  }

  if (release.html_url) {
    links.push(`- Release: ${release.html_url}`);
  }

  if (parsed.kind === 'preview') {
    links.push('- Preview de PR (nao liberavel via /liberar)');
  } else if (parsed.kind === 'production' && LIBERABLE_PRODUCTS.has(parsed.product) && parsed.version) {
    links.push(`- Liberar: /liberar ${parsed.product} ${parsed.version}`);
  }

  if (links.length === 0) {
    links.push('- (nenhum link disponivel)');
  }

  return links.join('\n');
}

function buildHeader(release, parsed) {
  const productName = productDisplayName(parsed.product);

  if (parsed.kind === 'preview') {
    return `[PREVIEW PR] ${productName}`;
  }

  if (parsed.kind === 'production' && parsed.version) {
    return `[NOVA RELEASE] ${productName} v${parsed.version}`;
  }

  return `[NOVA RELEASE] ${release.name ?? release.tag_name}`;
}

export function formatReleaseTelegramMessage(release) {
  const parsed = parseTag(release.tag_name ?? '');
  const header = buildHeader(release, parsed);
  const changelog = extractChangelog(release.body);
  const links = buildLinks(release, parsed);

  const lines = [header, ''];

  lines.push('Novidades:');
  lines.push(changelog || '- Melhorias gerais e correcoes');

  lines.push('');
  lines.push('Links:');
  lines.push(links);

  return truncate(lines.join('\n'), MAX_MESSAGE_CHARS);
}

async function fetchReleaseAssets(releaseId, token) {
  const response = await fetch(`https://api.github.com/repos/pollsof/releases/releases/${releaseId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pollaris-notify-release',
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar release ${releaseId}: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.assets ?? [];
}

async function main() {
  const releaseJson = process.env.RELEASE_JSON;
  if (!releaseJson) {
    console.error('RELEASE_JSON nao definido');
    process.exit(1);
  }

  let release;
  try {
    release = JSON.parse(releaseJson);
  } catch (error) {
    console.error('RELEASE_JSON invalido:', error.message);
    process.exit(1);
  }

  if ((!release.assets || release.assets.length === 0) && release.id && process.env.GITHUB_TOKEN) {
    release.assets = await fetchReleaseAssets(release.id, process.env.GITHUB_TOKEN);
  }

  const message = formatReleaseTelegramMessage(release);

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `message<<EOF\n${message}\nEOF\n`);
  } else {
    process.stdout.write(`${message}\n`);
  }
}

import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
