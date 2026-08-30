import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KvUnavailableError,
  listProducts,
  resolveProduct,
  addProduct,
  removeProduct,
  isValidProductName,
} from './products.js';

function memoryKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    _store: store,
  };
}

describe('isValidProductName', () => {
  it('aceita nomes simples', () => {
    assert.equal(isValidProductName('green'), true);
    assert.equal(isValidProductName('instaladores'), true);
    assert.equal(isValidProductName('tech-api'), true);
  });

  it('rejeita nomes invalidos', () => {
    assert.equal(isValidProductName(''), false);
    assert.equal(isValidProductName('com espaco'), false);
    assert.equal(isValidProductName('../x'), false);
  });
});

describe('listProducts', () => {
  it('usa seed VALID_PRODUCTS sem KV', async () => {
    const env = { VALID_PRODUCTS: 'green, snack' };
    assert.deepEqual(await listProducts(env), ['green', 'snack']);
  });

  it('persiste seed no KV na primeira leitura', async () => {
    const env = {
      VALID_PRODUCTS: 'green,snack',
      POLLARIS_KV: memoryKv(),
    };
    assert.deepEqual(await listProducts(env), ['green', 'snack']);
    assert.equal(env.POLLARIS_KV._store.bot_products, '["green","snack"]');
  });
});

describe('addProduct / removeProduct', () => {
  it('falha sem KV', async () => {
    await assert.rejects(
      () => addProduct({ VALID_PRODUCTS: 'green' }, 'tech'),
      (err) => err instanceof KvUnavailableError
    );
  });

  it('adiciona e remove produto', async () => {
    const env = {
      VALID_PRODUCTS: 'green,snack',
      POLLARIS_KV: memoryKv(),
    };

    const added = await addProduct(env, 'Tech');
    assert.deepEqual(added, { name: 'tech', added: true });
    assert.equal(await resolveProduct(env, 'TECH'), 'tech');

    const again = await addProduct(env, 'tech');
    assert.equal(again.added, false);

    const removed = await removeProduct(env, 'tech');
    assert.deepEqual(removed, { name: 'tech', removed: true });
    assert.equal(await resolveProduct(env, 'tech'), null);
  });
});
