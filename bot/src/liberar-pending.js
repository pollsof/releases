/**
 * Liberacoes pendentes ate o GitHub Pages publicar o JSON.
 */

import { assertKv } from './users.js';

export const KV_LIBERAR_PREFIX = 'liberar_pending:';
export const PAGES_BASE_URL = 'https://releases.pollaris.com.br';

const PAGES_ATTEMPTS = 3;
const PAGES_DELAY_MS = 2000;

export function pendingKey(sha) {
  return `${KV_LIBERAR_PREFIX}${String(sha ?? '').trim()}`;
}

export function isCnpjAlvo(sistema, alvo) {
  return String(alvo) !== String(sistema);
}

export function buildLiberarStartedMessage({ sistema, versao, alvo, destPath }) {
  const isCnpj = isCnpjAlvo(sistema, alvo);
  const destino = isCnpj
    ? `cliente \`${esc(alvo)}\``
    : `producao (\`${esc(destPath)}\`)`;

  return [
    'Liberacao de versao iniciada...',
    '',
    `Produto: \`${esc(sistema)}\``,
    `Versao: \`${esc(versao)}\``,
    `Destino: ${destino}`,
    '',
    'Aviso quando o GitHub Pages publicar.',
  ].join('\n');
}

export function buildLiberarReadyMessage({ username, sistema, versao, alvo }) {
  const who = mention(username);
  if (isCnpjAlvo(sistema, alvo)) {
    return `${who}, o cliente ${alvo} ja pode atualizar para a versao ${versao}`;
  }
  return `${who}, a producao de ${sistema} ja pode atualizar para a versao ${versao}`;
}

export function buildLiberarFailedMessage({ username, sistema, versao, alvo }) {
  const who = mention(username);
  if (isCnpjAlvo(sistema, alvo)) {
    return `${who}, o GitHub Pages falhou ao publicar a versao ${versao} para o cliente ${alvo} (${sistema}).`;
  }
  return `${who}, o GitHub Pages falhou ao publicar a versao ${versao} na producao de ${sistema}.`;
}

export async function saveLiberarPending(env, sha, pending) {
  assertKv(env);
  await env.POLLARIS_KV.put(pendingKey(sha), JSON.stringify(pending));
}

export async function loadLiberarPending(env, sha) {
  if (!env.POLLARIS_KV || !sha) return null;
  const stored = await env.POLLARIS_KV.get(pendingKey(sha));
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export async function deleteLiberarPending(env, sha) {
  if (!env.POLLARIS_KV || !sha) return;
  if (typeof env.POLLARIS_KV.delete === 'function') {
    await env.POLLARIS_KV.delete(pendingKey(sha));
    return;
  }
  await env.POLLARIS_KV.put(pendingKey(sha), '');
}

export function authorizePagesNotify(request, env) {
  const expected = String(env.PAGES_NOTIFY_SECRET ?? '');
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(match[1], expected);
}

export async function waitForPagesJson(destPath, { fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const url = `${PAGES_BASE_URL}/${String(destPath).replace(/^\/+/, '')}`;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= PAGES_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'GET' });
      lastStatus = res.status;
      if (res.ok) return true;
    } catch {
      lastStatus = 0;
    }
    if (attempt < PAGES_ATTEMPTS) {
      await sleepImpl(PAGES_DELAY_MS);
    }
  }
  return lastStatus === 200;
}

function mention(username) {
  const raw = String(username ?? '').trim();
  if (!raw) return 'usuario';
  return raw.startsWith('@') ? raw : `@${raw}`;
}

function esc(str) {
  return String(str ?? '').replace(/[_*`[\]]/g, '\\$&');
}

function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  const len = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
