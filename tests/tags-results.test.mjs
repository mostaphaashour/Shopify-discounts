import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopifyClient, validateTag } from '../lib/shopify.ts';
import { summarizeResults } from '../lib/results.ts';

function fixture() {
  const product = { id: 'gid://shopify/Product/1', title: 'Shared product', tags: ['Existing'] };
  const state = { product, variants: [
    { id: 'gid://shopify/ProductVariant/1', sku: 'A', title: 'One', price: '100', compareAtPrice: null, product },
    { id: 'gid://shopify/ProductVariant/2', sku: 'B', title: 'Two', price: '200', compareAtPrice: null, product },
  ], writes: [], mutationError: false, timeout: false };
  const client = createShopifyClient('test.myshopify.com', 'token', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('productVariants(first:')) return Response.json({ data: { productVariants: { nodes: state.variants, pageInfo: { hasNextPage: false } } } });
    if (query.includes('tagsAdd')) {
      state.writes.push(variables);
      if (state.timeout) throw Error('Timeout');
      if (state.mutationError) return Response.json({ data: { tagsAdd: { node: null, userErrors: [{ message: 'Rejected' }] } } });
      product.tags = [...new Set([...product.tags, ...variables.tags])];
      return Response.json({ data: { tagsAdd: { node: product, userErrors: [] } } });
    }
    throw Error('Unexpected mutation: prices must never be updated by tagging');
  });
  return { client, state };
}

test('tagging appends only the requested tag to the parent product', async () => {
  const { client, state } = fixture();
  const row = await client.previewTag('A', ' Summer ');
  assert.equal(row.tag, 'Summer');
  assert.equal(state.writes.length, 0);
  await client.applyTag(row, 'Summer');
  assert.deepEqual(state.writes, [{ id: state.product.id, tags: ['Summer'] }]);
  assert.deepEqual(state.product.tags, ['Existing', 'Summer']);
  assert.equal(state.variants[0].price, '100');
});

test('multiple SKUs belonging to the same product do not duplicate tag writes', async () => {
  const { client, state } = fixture();
  const a = await client.previewTag('A', 'Summer');
  const b = await client.previewTag('B', 'Summer');
  await client.applyTag(a, 'Summer');
  assert.equal(await client.applyTag(b, 'Summer'), 'التاج موجود بالفعل');
  assert.equal(state.writes.length, 1);
  assert.equal((await client.previewTag('B', 'Summer')).skipReason, 'already_done');
});

test('not found is a structured code; duplicates remain other failures', async () => {
  const { client, state } = fixture();
  await assert.rejects(client.previewTag('MISSING', 'Summer'), error => error.code === 'SKU_NOT_FOUND');
  state.variants.push({ ...state.variants[0], id: 'other' });
  await assert.rejects(client.previewTag('A', 'Summer'), error => error.code !== 'SKU_NOT_FOUND');
  assert.equal(state.writes.length, 0);
});

test('tag changes, moved SKUs, failed mutations, and timeouts are not marked complete', async () => {
  const { client, state } = fixture();
  const row = await client.previewTag('A', 'Summer');
  await assert.rejects(client.applyTag(row, 'Winter'));
  state.variants[0].product = { ...state.product, id: 'moved' };
  await assert.rejects(client.applyTag(row, 'Summer'));
  state.variants[0].product = state.product;
  state.mutationError = true;
  await assert.rejects(client.applyTag(row, 'Summer'), /Rejected/);
  state.mutationError = false; state.timeout = true;
  await assert.rejects(client.applyTag(row, 'Summer'), /Timeout/);
  assert.equal(state.writes.length, 2);
});

test('validate one tag without accidentally adding comma-separated tags', () => {
  for (const tag of ['', 'a,b', 'a،b', 'a\nb', 'a'.repeat(256)]) assert.throws(() => validateTag(tag));
  assert.equal(validateTag(' عروض الصيف '), 'عروض الصيف');
});

test('result fields separate missing SKUs from errors, skipped, pending and ready rows', () => {
  const result = summarizeResults([
    { sku: 'DONE', outcome: 'success' }, { sku: 'EXISTS', outcome: 'unchanged' },
    { sku: 'FAIL', outcome: 'error' }, { sku: 'FAIL', outcome: 'error' },
    { sku: 'NONE', outcome: 'not_found' }, { sku: 'WAIT', outcome: 'ready' },
    { sku: 'SKIP', outcome: 'skipped' }, { sku: 'PENDING', outcome: 'pending' },
  ]);
  assert.deepEqual(result.missing, ['NONE']);
  assert.deepEqual(result.incomplete, ['FAIL', 'WAIT', 'SKIP', 'PENDING']);
  assert.equal(result.completed, 2);
});
