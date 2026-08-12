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

const MAX_BODY_CHARS = 3000;
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
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^[-*+]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 24).trimEnd()}\n\n... (mensagem truncada)`;
}

function formatAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    return 'Artefatos:\n- (nenhum artefato listado na release)';
  }

  const lines = ['Artefatos:'];
  for (const asset of assets) {
    const size = formatBytes(asset.size);
    const label = size ? `${asset.name} (${size})` : asset.name;
    lines.push(`- ${label}`);
    if (asset.browser_download_url) {
      lines.push(`  ${asset.browser_download_url}`);
    }
  }
  return lines.join('\n');
}

export function formatReleaseTelegramMessage(release) {
  const tagName = release.tag_name ?? '';
  const parsed = parseTag(tagName);
  const productName = productDisplayName(parsed.product);
  const releaseUrl = release.html_url ?? `https://github.com/pollsof/releases/releases/tag/${tagName}`;

  const lines = [];

  if (parsed.kind === 'preview') {
    lines.push(`[PREVIEW PR] ${productName} — ${tagName}`);
  } else if (parsed.kind === 'production') {
    lines.push(`[NOVA RELEASE] ${productName}${parsed.version ? ` v${parsed.version}` : ''}`);
    lines.push(`Tag: ${tagName}`);
  } else {
    lines.push(`[NOVA RELEASE] ${release.name ?? tagName}`);
    lines.push(`Tag: ${tagName}`);
  }

  lines.push(`Release: ${releaseUrl}`);
  lines.push('');
  lines.push(formatAssets(release.assets));

  if (STAGING_PRODUCTS.has(parsed.product)) {
    lines.push('');
    lines.push(`Staging: https://releases.pollaris.com.br/${parsed.product}/teste.json`);
  }

  const body = markdownToPlain(release.body);
  if (body) {
    lines.push('');
    lines.push('Novidades:');
    lines.push(truncate(body, MAX_BODY_CHARS));
  }

  lines.push('');

  if (parsed.kind === 'preview') {
    lines.push('Preview de PR — nao liberavel via /liberar.');
    lines.push('Use o seletor Colaborando no cliente.');
  } else if (parsed.kind === 'production' && LIBERABLE_PRODUCTS.has(parsed.product) && parsed.version) {
    lines.push(`Para liberar: /liberar ${parsed.product} ${parsed.version}`);
  }

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
