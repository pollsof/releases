/**
 * Gerenciamento de acesso (Cloudflare KV).
 */

export const VALID_PROFILES = ['root', 'usuario'];
export const KV_USERS_KEY = 'bot_users';
export const KV_LEGACY_KEY = 'allowed_users';

export class KvUnavailableError extends Error {
  constructor(message = 'Armazenamento de usuarios (KV) nao configurado.') {
    super(message);
    this.name = 'KvUnavailableError';
  }
}

export function splitEnv(str) {
  return (str ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export function isEnvRoot(env, userId) {
  return env.ROOT_ID && userId === String(env.ROOT_ID);
}

export function profileIsRoot(profile) {
  return profile === 'root';
}

export function profileIsAuthorized(profile) {
  return profile === 'root' || profile === 'usuario';
}

export function assertKv(env) {
  if (!env.POLLARIS_KV) {
    throw new KvUnavailableError();
  }
}

export async function loadBotUsers(env) {
  if (!env.POLLARIS_KV) return {};

  const stored = await env.POLLARIS_KV.get(KV_USERS_KEY);
  if (stored) return JSON.parse(stored);

  const legacy = await env.POLLARIS_KV.get(KV_LEGACY_KEY);
  const users = {};
  if (legacy) {
    const list = JSON.parse(legacy);
    if (Array.isArray(list)) {
      for (const id of list) {
        users[String(id)] = 'usuario';
      }
      await env.POLLARIS_KV.put(KV_USERS_KEY, JSON.stringify(users));
    }
  }
  return users;
}

export async function getKvUserProfile(env, userId) {
  const users = await loadBotUsers(env);
  return users[userId] ?? null;
}

export async function getUserProfile(env, userId) {
  if (isEnvRoot(env, userId)) return 'root';
  const kvProfile = await getKvUserProfile(env, userId);
  if (kvProfile) return kvProfile;
  const seed = splitEnv(env.ALLOWED_USERS);
  if (seed.includes(userId)) return 'usuario';
  return null;
}

export async function setUserProfile(env, userId, profile) {
  assertKv(env);
  const users = await loadBotUsers(env);
  users[String(userId)] = profile;
  await env.POLLARIS_KV.put(KV_USERS_KEY, JSON.stringify(users));
}

export async function removeBotUser(env, userId) {
  assertKv(env);
  const users = await loadBotUsers(env);
  delete users[String(userId)];
  await env.POLLARIS_KV.put(KV_USERS_KEY, JSON.stringify(users));
}

export async function listAllUsers(env) {
  const users = await loadBotUsers(env);
  const seen = new Set();
  const result = [];

  if (env.ROOT_ID) {
    const rootId = String(env.ROOT_ID);
    result.push({ id: rootId, profile: 'root' });
    seen.add(rootId);
  }

  for (const [id, profile] of Object.entries(users)) {
    if (!seen.has(id)) {
      result.push({ id, profile });
      seen.add(id);
    }
  }

  const seed = splitEnv(env.ALLOWED_USERS);
  for (const id of seed) {
    if (!seen.has(id)) {
      result.push({ id, profile: 'usuario' });
      seen.add(id);
    }
  }

  return result;
}
