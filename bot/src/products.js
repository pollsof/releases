/**
 * Gerenciamento de produtos (Cloudflare KV).
 * VALID_PRODUCTS no ambiente e usado como seed inicial.
 */

import { KvUnavailableError, assertKv, splitEnv } from './users.js';

export const KV_PRODUCTS_KEY = 'bot_products';

const PRODUCT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function normalizeProductName(input) {
  return String(input ?? '').trim().toLowerCase();
}

export function isValidProductName(name) {
  return Boolean(name) && PRODUCT_NAME_RE.test(name);
}

function seedProducts(env) {
  return splitEnv(env.VALID_PRODUCTS).map(normalizeProductName).filter(Boolean);
}

export async function listProducts(env) {
  if (!env.POLLARIS_KV) return seedProducts(env);

  const stored = await env.POLLARIS_KV.get(KV_PRODUCTS_KEY);
  if (stored) {
    const list = JSON.parse(stored);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeProductName).filter(Boolean);
  }

  const seed = seedProducts(env);
  if (seed.length) {
    await env.POLLARIS_KV.put(KV_PRODUCTS_KEY, JSON.stringify(seed));
  }
  return seed;
}

export async function resolveProduct(env, input) {
  const raw = normalizeProductName(input);
  if (!raw) return null;
  const products = await listProducts(env);
  if (!products.length) return raw;
  return products.includes(raw) ? raw : null;
}

export async function addProduct(env, nameRaw) {
  assertKv(env);
  const name = normalizeProductName(nameRaw);
  if (!isValidProductName(name)) {
    throw new Error(
      'Nome de produto invalido. Use letras, numeros, _ ou - (ex.: green, instaladores).'
    );
  }

  const products = await listProducts(env);
  if (products.includes(name)) {
    return { name, added: false };
  }

  products.push(name);
  products.sort();
  await env.POLLARIS_KV.put(KV_PRODUCTS_KEY, JSON.stringify(products));
  return { name, added: true };
}

export async function removeProduct(env, nameRaw) {
  assertKv(env);
  const name = normalizeProductName(nameRaw);
  if (!name) {
    throw new Error('Nome de produto invalido.');
  }

  const products = await listProducts(env);
  const next = products.filter(p => p !== name);
  if (next.length === products.length) {
    return { name, removed: false };
  }

  await env.POLLARIS_KV.put(KV_PRODUCTS_KEY, JSON.stringify(next));
  return { name, removed: true };
}

export { KvUnavailableError };
