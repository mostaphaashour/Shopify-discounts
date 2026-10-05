import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, calculateTarget } from '../lib/pricing.ts';
import { createShopifyClient, normalizeShop, requestToken } from '../lib/shopify.ts';

const variant = { id: 'gid://shopify/ProductVariant/1', sku: 'A', title: 'Default', price: '100.00', compareAtPrice: null, product: { id: 'gid://shopify/Product/1', title: 'Product' } };
function mockClient(options = {}) {
  const state = { variants: [structuredClone(variant)], writes: [], pages: null, ...options };
  const fetcher = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('productVariants(first:')) {
      const page = state.pages ? state.pages.shift() : { nodes: state.variants, pageInfo: { hasNextPage: false, endCursor: null } };
      return Response.json({ data: { productVariants: page } });
    }
    if (query.includes('mutation')) {
      state.writes.push(variables);
      return Response.json({ data: { productVariantsBulkUpdate: { productVariants: variables.variants, userErrors: [] } } });
    }
    throw new Error('Unexpected request');
  };
  return { state, client: createShopifyClient('test.myshopify.com', 'test-token', fetcher) };
}

test('discount bases and currency rounding', () => {
  assert.deepEqual(calculate('1000.00', null, 20, 'original', 2), { base: '1000.00', newPrice: '800.00' });
  assert.equal(calculate('80.00', '100.00', 20, 'original', 2).newPrice, '80.00');
  assert.equal(calculate('80.00', '100.00', 20, 'current', 2).newPrice, '64.00');
  assert.equal(calculate('10.05', null, 10, 'current', 2).newPrice, '9.05');
  assert.equal(calculate('100', null, 12.5, 'current', 0).newPrice, '88');
  assert.equal(calculate('10.005', null, 10, 'current', 3).newPrice, '9.005');
});

test('invalid discounts and prices never produce writes', () => {
  for (const discount of [0, 100, -1, NaN, 0.001]) assert.throws(() => calculate('100', null, discount, 'current', 2));
  for (const price of ['0', '-10', 'NaN', '']) assert.throws(() => calculate(price, null, 20, 'current', 2));
  assert.throws(() => calculate('0.01', null, 99, 'current', 2));
});

test('only Shopify shop domains are accepted', () => {
  assert.equal(normalizeShop('https://My-Shop.myshopify.com/'), 'my-shop.myshopify.com');
  for (const domain of ['example.com', 'localhost', 'shop.myshopify.com.evil.test', 'shop.myshopify.com/path', 'user@shop.myshopify.com']) assert.throws(() => normalizeShop(domain));
});

test('token exchange uses server-side client credentials', async () => {
  const result = await requestToken({ shop: 'test.myshopify.com', clientId: 'id', secret: 'secret' }, async (url, init) => {
    assert.equal(url, 'https://test.myshopify.com/admin/oauth/access_token');
    assert.equal(init.body.get('grant_type'), 'client_credentials');
    assert.equal(init.body.get('client_secret'), 'secret');
    assert.equal(init.redirect, 'error');
    return Response.json({ access_token: 'test-token', expires_in: 86399 });
  });
  assert.equal(result.token, 'test-token');
  assert.ok(result.expiresAt > Date.now());
});

test('preview never writes', async () => {
  const { client, state } = mockClient();
  assert.equal((await client.preview('A', 20, 'original', 2)).newPrice, '80.00');
  assert.equal(state.writes.length, 0);
});

test('near matches and case differences are excluded', async () => {
  const { client } = mockClient({ variants: [{ ...variant, sku: 'AA' }, { ...variant, sku: 'a' }] });
  await assert.rejects(client.preview('A', 20, 'original', 2), /مطابقة تامة/);
});

test('duplicates across pages are rejected', async () => {
  const { client } = mockClient({ pages: [
    { nodes: [variant], pageInfo: { hasNextPage: true, endCursor: 'next' } },
    { nodes: [{ ...variant, id: 'other' }], pageInfo: { hasNextPage: false } },
  ] });
  await assert.rejects(client.preview('A', 20, 'original', 2), /مكرر/);
});

test('write targets exactly the selected variant and only price fields', async () => {
  const { client, state } = mockClient();
  const row = await client.preview('A', 20, 'original', 2);
  assert.equal(await client.apply(row, 20, 'original', 2), 'تم التطبيق');
  assert.deepEqual(state.writes, [{ productId: variant.product.id, variants: [{ id: variant.id, price: '80.00', compareAtPrice: '100.00' }] }]);
});

test('a changed price blocks the update', async () => {
  const { client, state } = mockClient();
  const row = await client.preview('A', 20, 'original', 2);
  state.variants[0].price = '95.00';
  await assert.rejects(client.apply(row, 20, 'original', 2), /بعد المعاينة/);
  assert.equal(state.writes.length, 0);
});

test('a new duplicate after preview blocks the update', async () => {
  const { client, state } = mockClient();
  const row = await client.preview('A', 20, 'original', 2);
  state.variants.push({ ...variant, id: 'new' });
  await assert.rejects(client.apply(row, 20, 'original', 2), /مكرر/);
  assert.equal(state.writes.length, 0);
});

test('repeated application of the same preview is a no-op', async () => {
  const { client, state } = mockClient();
  const row = await client.preview('A', 20, 'original', 2);
  state.variants[0] = { ...variant, price: '80.00', compareAtPrice: '100.00' };
  assert.equal(await client.apply(row, 20, 'original', 2), 'مطبّق بالفعل');
  assert.equal(state.writes.length, 0);
});

test('edited preview values or settings are rejected', async () => {
  const { client, state } = mockClient();
  const row = await client.preview('A', 20, 'original', 2);
  await assert.rejects(client.apply({ ...row, newPrice: '1.00' }, 20, 'original', 2), /أعد المعاينة/);
  await assert.rejects(client.apply(row, 30, 'original', 2), /أعد المعاينة/);
  assert.equal(state.writes.length, 0);
});

test('write timeout is surfaced without retrying a mutation', async () => {
  let writes = 0;
  const client = createShopifyClient('test.myshopify.com', 'token', async (_url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.includes('mutation')) { writes++; throw new Error('Timeout'); }
    return Response.json({ data: { productVariants: { nodes: [variant], pageInfo: { hasNextPage: false } } } });
  });
  const row = await client.preview('A', 20, 'original', 2);
  await assert.rejects(client.apply(row, 20, 'original', 2), /Timeout/);
  assert.equal(writes, 1);
});

test('restore previews old comparison price without writing', async () => {
  const { client, state } = mockClient({ variants: [{ ...variant, price: '80.00', compareAtPrice: '100.00' }] });
  const row = await client.previewRestore('A');
  assert.equal(row.newPrice, '100.00');
  assert.equal(row.operation, 'restore');
  assert.equal(row.skipped, undefined);
  assert.equal(state.writes.length, 0);
  assert.equal(await client.applyRestore(row), 'تم استرجاع السعر الأصلي وإزالة سعر المقارنة');
  assert.deepEqual(state.writes, [{ productId: variant.product.id, variants: [{ id: variant.id, price: '100.00', compareAtPrice: null }] }]);
});

test('restore leaves absent, equal, and lower comparison prices untouched', async () => {
  for (const compareAtPrice of [null, '100.00', '90.00', '0.00']) {
    const { client, state } = mockClient({ variants: [{ ...variant, compareAtPrice }] });
    const row = await client.previewRestore('A');
    assert.ok(row.skipped);
    assert.equal(row.newPrice, '100.00');
    await assert.rejects(client.applyRestore(row));
    assert.equal(state.writes.length, 0);
  }
});

test('restore rejects changed prices and changed comparison prices', async () => {
  for (const changed of [{ price: '70.00' }, { compareAtPrice: '120.00' }, { compareAtPrice: null }]) {
    const { client, state } = mockClient({ variants: [{ ...variant, price: '80.00', compareAtPrice: '100.00' }] });
    const row = await client.previewRestore('A');
    Object.assign(state.variants[0], changed);
    await assert.rejects(client.applyRestore(row), /بعد المعاينة/);
    assert.equal(state.writes.length, 0);
  }
});

test('restore rejects duplicates and missing exact SKUs', async () => {
  const { client, state } = mockClient({ variants: [{ ...variant, price: '80.00', compareAtPrice: '100.00' }] });
  const row = await client.previewRestore('A');
  state.variants.push({ ...state.variants[0], id: 'other' });
  await assert.rejects(client.applyRestore(row), /مكرر/);
  state.variants = [{ ...variant, sku: 'AA' }];
  await assert.rejects(client.previewRestore('A'), /مطابقة تامة/);
  assert.equal(state.writes.length, 0);
});

test('restoring the same preview twice is a no-op after success', async () => {
  const { client, state } = mockClient({ variants: [{ ...variant, price: '80.00', compareAtPrice: '100.00' }] });
  const row = await client.previewRestore('A');
  state.variants[0] = { ...variant, price: '100.00', compareAtPrice: null };
  assert.equal(await client.applyRestore(row), 'تم الاسترجاع بالفعل');
  assert.equal(state.writes.length, 0);
});

test('restore rejects modified preview values or the wrong operation', async () => {
  const { client, state } = mockClient({ variants: [{ ...variant, price: '80.00', compareAtPrice: '100.00' }] });
  const row = await client.previewRestore('A');
  await assert.rejects(client.applyRestore({ ...row, newPrice: '200.00' }));
  await assert.rejects(client.applyRestore({ ...row, operation: 'discount' }));
  assert.equal(state.writes.length, 0);
});


test('manual prices set exact before and after values, or clear comparison', async () => {
  for (const beforePrice of ['150.00', '']) {
    const { client, state } = mockClient();
    const settings = { operation: 'manual', salePrice: '80', beforePrice };
    const row = await client.previewTarget('A', settings, 2);
    assert.equal(row.newPrice, '80.00');
    assert.equal(state.writes.length, 0);
    await client.applyTarget(row, settings, 2);
    assert.deepEqual(state.writes[0].variants, [{ id: variant.id, price: '80.00', compareAtPrice: beforePrice || null }]);
  }
});

test('increase changes current selling price using only the percentage', async () => {
  const { client, state } = mockClient({ variants: [{ ...variant, compareAtPrice: '500.00' }] });
  const settings = { operation: 'increase', increase: 20 };
  const row = await client.previewTarget('A', settings, 2);
  assert.equal(row.newCompareAtPrice, '500.00');
  assert.equal(row.newPrice, '120.00');
  await client.applyTarget(row, settings, 2);
  assert.deepEqual(state.writes[0].variants, [{ id: variant.id, price: '120.00', compareAtPrice: '500.00' }]);
});

test('increase calculates the new selling price independently per SKU', () => {
  const settings = { operation: 'increase', increase: 20 };
  assert.equal(calculateTarget('100', settings, 2).newPrice, '120.00');
  assert.equal(calculateTarget('200', settings, 2).newPrice, '240.00');
  assert.equal(calculateTarget('10.05', { ...settings, increase: 10 }, 2).newPrice, '11.06');
});

test('invalid before/after relationships and currency precision are rejected', () => {
  for (const beforePrice of ['50', '80']) assert.throws(() => calculateTarget('100', { operation: 'manual', beforePrice, salePrice: '80' }, 2));
  for (const salePrice of ['', '0', '-1', 'NaN', '1.001']) assert.throws(() => calculateTarget('100', { operation: 'manual', salePrice }, 2));
  for (const increase of [0, -1, NaN, 0.001, 10001]) assert.throws(() => calculateTarget('100', { operation: 'increase', increase, salePrice: '80' }, 2));
  assert.deepEqual(calculateTarget('100', { operation: 'increase', increase: 20 }, 2), { newPrice: '120.00', newCompareAtPrice: null });
  assert.equal(calculateTarget('100', { operation: 'manual', salePrice: '80.00' }, 0).newPrice, '80');
});

test('new pricing modes reject stale prices, edited settings, and wrong operations', async () => {
  const { client, state } = mockClient();
  const settings = { operation: 'manual', beforePrice: '150', salePrice: '80' };
  const row = await client.previewTarget('A', settings, 2);
  await assert.rejects(client.applyTarget(row, { ...settings, salePrice: '70' }, 2));
  await assert.rejects(client.applyTarget(row, { operation: 'increase', increase: 50, salePrice: '80' }, 2));
  await assert.rejects(client.apply(row, 20, 'original', 2));
  state.variants[0].price = '110.00';
  await assert.rejects(client.applyTarget(row, settings, 2), /بعد المعاينة/);
  assert.equal(state.writes.length, 0);
});

test('matching manual prices skip and reapplication does not rewrite', async () => {
  const { client, state } = mockClient();
  const settings = { operation: 'manual', salePrice: '100', beforePrice: '' };
  const row = await client.previewTarget('A', settings, 2);
  assert.ok(row.skipped);
  assert.equal(await client.applyTarget(row, settings, 2), 'مطبّق بالفعل');
  assert.equal(state.writes.length, 0);
});

test('new modes reject duplicate SKUs before a write', async () => {
  const { client, state } = mockClient();
  const settings = { operation: 'increase', increase: 20, salePrice: '80' };
  const row = await client.previewTarget('A', settings, 2);
  state.variants.push({ ...variant, id: 'other' });
  await assert.rejects(client.applyTarget(row, settings, 2), /مكرر/);
  assert.equal(state.writes.length, 0);
});


test('increase clears comparison when new selling price reaches or exceeds it', async () => {
  for (const compareAtPrice of [null, '110.00', '120.00']) {
    const { client, state } = mockClient({ variants: [{ ...variant, compareAtPrice }] });
    const settings = { operation: 'increase', increase: 20 };
    const row = await client.previewTarget('A', settings, 2);
    assert.equal(row.newPrice, '120.00');
    assert.equal(row.newCompareAtPrice, null);
    await client.applyTarget(row, settings, 2);
    assert.deepEqual(state.writes[0].variants, [{ id: variant.id, price: '120.00', compareAtPrice: null }]);
  }
});
