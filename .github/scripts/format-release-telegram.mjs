#!/usr/bin/env node

const MAX_MESSAGE_CHARS = 4096;

function isZipUrl(url) {
  return /\.zip(?:\?|#|$)/i.test(String(url ?? ''));
}

function zipAssets(release) {
  return (release.assets ?? []).filter(asset => {
    const name = String(asset.name ?? '');
    return /\.zip$/i.test(name) && !/^source code/i.test(name);
  });
}

export function formatReleaseBody(markdown) {
  let text = String(markdown ?? '').replace(/\r\n/g, '\n');

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    if (isZipUrl(url)) return `${label}\n${url}`;
    return label;
  });

  text = text
    .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\n-{3,}\n/g, '\n\n');

  const filtered = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^configurac[aã]o de atualiza[cç][aã]o:/i.test(trimmed)) continue;
    if (/releases\.pollaris\.com\.br\/.+\.(json)/i.test(trimmed)) continue;
    filtered.push(line.trimEnd());
  }

  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatReleaseTelegramMessage(release) {
  const title = String(release.name || release.tag_name || 'Release').trim();
  let body = formatReleaseBody(release.body ?? '');

  if (body) {
    const lines = body.split('\n');
    if (lines[0]?.trim() === title) {
      body = lines.slice(1).join('\n').trim();
    }
  }

  const extraZips = [];
  for (const asset of zipAssets(release)) {
    const url = asset.browser_download_url;
    if (!url) continue;
    if (body.includes(url)) continue;
    extraZips.push(`${asset.name}\n${url}`);
  }

  const parts = [title];
  if (body) parts.push('', body);
  if (extraZips.length) parts.push('', extraZips.join('\n\n'));

  return truncate(parts.join('\n'), MAX_MESSAGE_CHARS);
}

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 24).trimEnd()}\n\n... (mensagem truncada)`;
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
