import { calculate, calculateTarget, type PriceSettings } from './pricing.ts';

export const API_VERSION = '2026-07';
export class ShopifyOperationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function validateTag(input: string) {
  const tag = input.trim();
  if (!tag || tag.length > 255 || /[,،\r\n]/.test(tag)) {
    throw new Error('أدخل تاجًا واحدًا من 1 إلى 255 حرفًا، بدون فواصل أو أسطر جديدة');
  }
  return tag;
}
export type Credentials = { shop: string; clientId: string; secret: string };
export type Variant = {
  id: string;
  sku: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  product: { id: string; title: string; tags?: string[] };
};
export type PreviewRow = {
  id: string;
  sku: string;
  productId: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  base: string;
  newPrice: string;
  operation?: 'discount' | 'restore' | 'manual' | 'increase' | 'tag';
  tag?: string;
  currentTags?: string[];
  skipReason?: 'already_done' | 'not_applicable';
  newCompareAtPrice?: string | null;
  skipped?: string;
};

export function normalizeShop(value: string) {
  const shop = value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error('استخدم دومين المتجر المنتهي بـ myshopify.com');
  }
  return shop;
}

export async function requestToken(credentials: Credentials, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`https://${credentials.shop}/admin/oauth/access_token`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.secret,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error('تعذر توليد التوكن. راجع المفاتيح وتثبيت التطبيق، وأن التطبيق والمتجر ضمن نفس مؤسسة Shopify.');
  }
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!result.access_token || !result.expires_in) throw new Error('استجابة توكن غير صالحة من Shopify');
  return { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
}

export function createShopifyClient(shop: string, token: string, fetcher: typeof fetch = fetch) {
  async function query<T>(document: string, variables: object = {}): Promise<T> {
    const response = await fetcher(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: document, variables }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('التوكن غير صالح؛ أعد ربط المتجر.');
      if (response.status === 429) throw new Error('Shopify طلب تقليل معدل الطلبات؛ انتظر قليلًا ثم أعد المعاينة.');
      throw new Error(`تعذر الاتصال بـ Shopify (${response.status})`);
    }
    const result = await response.json() as { data?: T; errors?: { message: string }[] };
    if (result.errors?.length) throw new Error('Shopify: ' + result.errors.map(error => error.message).join(' / '));
    if (!result.data) throw new Error('استجابة غير مكتملة من Shopify');
    return result.data;
  }

  const fields = 'id sku title price compareAtPrice product { id title tags }';

  async function info() {
    const result = await query<{
      shop: { name: string; currencyCode: string };
      currentAppInstallation: { accessScopes: { handle: string }[] };
    }>('{ shop { name currencyCode } currentAppInstallation { accessScopes { handle } } }');
    if (!result.currentAppInstallation.accessScopes.some(scope => scope.handle === 'write_products')) {
      throw new Error('فعّل صلاحية write_products في التطبيق واعتمد الصلاحيات الجديدة ثم أعد الربط.');
    }
    return result.shop;
  }

  async function findExact(sku: string): Promise<Variant> {
    const matches: Variant[] = [];
    let cursor: string | null = null;
    let pages = 0;
    // Shopify search may return close matches. Only exact, case-sensitive SKUs qualify.
    do {
      const result: { productVariants: { nodes: Variant[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await query(
        `query($q: String!, $cursor: String) {
          productVariants(first: 100, after: $cursor, query: $q) {
            nodes { ${fields} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { q: 'sku:"' + sku.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"', cursor },
      );
      matches.push(...result.productVariants.nodes.filter(variant => variant.sku === sku));
      if (matches.length > 1) throw new Error('SKU مكرر على أكثر من متغير؛ لن يُعدّل');
      cursor = result.productVariants.pageInfo.hasNextPage ? result.productVariants.pageInfo.endCursor : null;
      if (++pages >= 20 && cursor) throw new Error('نتائج كثيرة؛ تعذر تأكيد تطابق فريد');
    } while (cursor);
    if (!matches.length) throw new ShopifyOperationError('SKU_NOT_FOUND', 'SKU غير موجود بمطابقة تامة');
    return matches[0];
  }

  async function preview(sku: string, discount: number, basis: string, digits: number): Promise<PreviewRow> {
    const variant = await findExact(sku);
    return {
      id: variant.id,
      sku: variant.sku,
      productId: variant.product.id,
      title: `${variant.product.title} / ${variant.title}`,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      ...calculate(variant.price, variant.compareAtPrice, discount, basis, digits),
    };
  }

  async function apply(row: PreviewRow, discount: number, basis: string, digits: number) {
    if (row.operation && row.operation !== 'discount') throw new Error('نوع العملية اتغير؛ أعد المعاينة');
    // Re-check identity, uniqueness, and current prices immediately before writing.
    const variant = await findExact(row.sku);
    if (variant.id !== row.id || variant.product.id !== row.productId) {
      throw new Error('بيانات المنتج اتغيرت؛ أعد المعاينة');
    }
    const proposed = calculate(row.price, row.compareAtPrice, discount, basis, digits);
    if (proposed.newPrice !== row.newPrice || proposed.base !== row.base) {
      throw new Error('إعدادات الخصم اتغيرت؛ أعد المعاينة');
    }
    if (Number(variant.price) === Number(proposed.newPrice) && Number(variant.compareAtPrice) === Number(proposed.base)) {
      return 'مطبّق بالفعل';
    }
    if (variant.price !== row.price || variant.compareAtPrice !== row.compareAtPrice) {
      throw new Error('السعر اتغير بعد المعاينة؛ لم يُعدّل');
    }
    return writePrices(variant, proposed.newPrice, proposed.base);
  }

  async function previewRestore(sku: string): Promise<PreviewRow> {
    const variant = await findExact(sku);
    const eligible = variant.compareAtPrice !== null
      && Number.isFinite(Number(variant.compareAtPrice))
      && Number(variant.compareAtPrice) > Number(variant.price);
    return {
      id: variant.id, sku: variant.sku, productId: variant.product.id,
      title: `${variant.product.title} / ${variant.title}`,
      price: variant.price, compareAtPrice: variant.compareAtPrice,
      base: variant.compareAtPrice ?? variant.price,
      newPrice: eligible ? variant.compareAtPrice! : variant.price,
      operation: 'restore',
      ...(eligible ? {} : { skipped: 'بدون خصم — سيبقى كما هو', skipReason: 'not_applicable' as const }),
    };
  }

  async function previewTarget(sku: string, settings: PriceSettings, digits: number): Promise<PreviewRow> {
    const variant = await findExact(sku);
    const target = calculateTarget(variant.price, settings, digits, variant.compareAtPrice);
    const unchanged = Number(variant.price) === Number(target.newPrice)
      && (target.newCompareAtPrice === null ? variant.compareAtPrice === null
        : variant.compareAtPrice !== null && Number(variant.compareAtPrice) === Number(target.newCompareAtPrice));
    return {
      id: variant.id, sku: variant.sku, productId: variant.product.id,
      title: `${variant.product.title} / ${variant.title}`,
      price: variant.price, compareAtPrice: variant.compareAtPrice,
      operation: settings.operation, base: target.newCompareAtPrice ?? target.newPrice,
      ...target, ...(unchanged ? { skipped: 'الأسعار مطابقة بالفعل — بدون تغيير', skipReason: 'already_done' as const } : {}),
    };
  }

  async function applyTarget(row: PreviewRow, settings: PriceSettings, digits: number) {
    if (row.operation !== settings.operation) throw new Error('نوع العملية اتغير؛ أعد المعاينة');
    const target = calculateTarget(row.price, settings, digits, row.compareAtPrice);
    if (row.newPrice !== target.newPrice || row.newCompareAtPrice !== target.newCompareAtPrice) {
      throw new Error('إعدادات الأسعار اتغيرت؛ أعد المعاينة');
    }
    const variant = await findExact(row.sku);
    if (variant.id !== row.id || variant.product.id !== row.productId) throw new Error('بيانات المنتج اتغيرت؛ أعد المعاينة');
    const compareMatches = target.newCompareAtPrice === null ? variant.compareAtPrice === null
      : variant.compareAtPrice !== null && Number(variant.compareAtPrice) === Number(target.newCompareAtPrice);
    if (Number(variant.price) === Number(target.newPrice) && compareMatches) return 'مطبّق بالفعل';
    if (variant.price !== row.price || variant.compareAtPrice !== row.compareAtPrice) {
      throw new Error('السعر اتغير بعد المعاينة؛ لم يُعدّل');
    }
    return writePrices(variant, target.newPrice, target.newCompareAtPrice);
  }

  async function applyRestore(row: PreviewRow) {
    if (row.operation !== 'restore' || row.skipped || row.compareAtPrice === null
      || !Number.isFinite(Number(row.compareAtPrice))
      || Number(row.compareAtPrice) <= Number(row.price)
      || row.newPrice !== row.compareAtPrice || row.base !== row.compareAtPrice) {
      throw new Error('لا يوجد خصم صالح للاسترجاع؛ أعد المعاينة');
    }
    const variant = await findExact(row.sku);
    if (variant.id !== row.id || variant.product.id !== row.productId) {
      throw new Error('بيانات المنتج اتغيرت؛ أعد المعاينة');
    }
    if (Number(variant.price) === Number(row.compareAtPrice) && variant.compareAtPrice === null) {
      return 'تم الاسترجاع بالفعل';
    }
    if (variant.price !== row.price || variant.compareAtPrice !== row.compareAtPrice) {
      throw new Error('السعر اتغير بعد المعاينة؛ لم يُعدّل');
    }
    await writePrices(variant, row.compareAtPrice, null);
    return 'تم استرجاع السعر الأصلي وإزالة سعر المقارنة';
  }

  async function writePrices(variant: Variant, price: string, compareAtPrice: string | null) {
    // Explicit null clears the comparison price; never include unrelated variants.
    const result = await query<{
      productVariantsBulkUpdate: {
        productVariants: { id: string; price: string; compareAtPrice: string | null }[];
        userErrors: { message: string }[];
      };
    }>(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
          productVariants { id price compareAtPrice }
          userErrors { message }
        }
      }`,
      { productId: variant.product.id, variants: [{ id: variant.id, price, compareAtPrice }] },
    );
    const update = result.productVariantsBulkUpdate;
    if (update.userErrors.length) throw new Error(update.userErrors.map(error => error.message).join(' / '));
    const saved = update.productVariants[0];
    const compareMatches = saved && (compareAtPrice === null
      ? saved.compareAtPrice === null
      : saved.compareAtPrice !== null && Number(saved.compareAtPrice) === Number(compareAtPrice));
    if (!saved || saved.id !== variant.id || Number(saved.price) !== Number(price) || !compareMatches) {
      throw new Error('تعذر تأكيد السعر المحفوظ؛ راجع Shopify قبل إعادة المحاولة');
    }
    return 'تم التطبيق';
  }

  async function previewTag(sku: string, input: string): Promise<PreviewRow> {
    const tag = validateTag(input);
    const variant = await findExact(sku);
    const currentTags = variant.product.tags ?? [];
    const exists = currentTags.includes(tag);
    return {
      id: variant.id, sku: variant.sku, productId: variant.product.id,
      title: `${variant.product.title} / ${variant.title}`,
      price: variant.price, compareAtPrice: variant.compareAtPrice,
      base: variant.price, newPrice: variant.price,
      operation: 'tag', tag, currentTags,
      ...(exists ? { skipped: 'التاج موجود بالفعل', skipReason: 'already_done' as const } : {}),
    };
  }

  async function applyTag(row: PreviewRow, input: string) {
    const tag = validateTag(input);
    if (row.operation !== 'tag' || row.tag !== tag) throw new Error('التاج أو نوع العملية اتغير؛ أعد المعاينة');
    const variant = await findExact(row.sku);
    if (variant.id !== row.id || variant.product.id !== row.productId) throw new Error('بيانات المنتج اتغيرت؛ أعد المعاينة');
    if (variant.product.tags?.includes(tag)) return 'التاج موجود بالفعل';
    // Append only. Never replace the product's tag collection or update its prices.
    const result = await query<{
      tagsAdd: { node: { id: string; tags: string[] } | null; userErrors: { message: string }[] };
    }>(`mutation($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id ... on Product { tags } }
        userErrors { message }
      }
    }`, { id: variant.product.id, tags: [tag] });
    if (result.tagsAdd.userErrors.length) throw new Error(result.tagsAdd.userErrors.map(error => error.message).join(' / '));
    if (result.tagsAdd.node?.id !== variant.product.id || !result.tagsAdd.node.tags.includes(tag)) {
      throw new Error('تعذر تأكيد إضافة التاج؛ راجع المنتج في Shopify قبل إعادة المحاولة');
    }
    return 'تمت إضافة التاج للمنتج';
  }
  return { info, preview, apply, previewRestore, applyRestore, previewTarget, applyTarget, previewTag, applyTag };
}

