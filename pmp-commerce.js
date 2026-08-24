(function (global) {
  'use strict';

  const CART_KEY = 'pmp_shopify_cart_id';
  const CART_UPDATED_KEY = 'pmp_shopify_cart_updated_at';
  const DEFAULT_API_VERSION = '2026-07';

  const PRODUCT_QUERY = `
    query ProductByHandle($handle: String!) {
      product: productByHandle(handle: $handle) {
        id handle title description availableForSale
        featuredImage { url altText width height }
        options { name optionValues { name } }
        variants(first: 100) {
          nodes {
            id title availableForSale
            selectedOptions { name value }
            price { amount currencyCode }
            compareAtPrice { amount currencyCode }
            image { url altText width height }
          }
        }
      }
    }`;

  const CART_FRAGMENT = `
    fragment PMPShopifyCart on Cart {
      id checkoutUrl totalQuantity
      cost { subtotalAmount { amount currencyCode } }
      lines(first: 100) {
        nodes {
          id quantity
          cost { totalAmount { amount currencyCode } }
          merchandise {
            ... on ProductVariant {
              id title availableForSale
              selectedOptions { name value }
              image { url altText width height }
              product { title handle }
            }
          }
        }
      }
    }`;

  const CART_QUERY = `
    query CartQuery($id: ID!) {
      cart(id: $id) { ...PMPShopifyCart }
    }
    ${CART_FRAGMENT}`;

  const CART_CREATE = `
    mutation cartCreate($lines: [CartLineInput!]) {
      cartCreate(input: { lines: $lines }) {
        cart { ...PMPShopifyCart }
        userErrors { field message }
      }
    }
    ${CART_FRAGMENT}`;

  const CART_LINES_ADD = `
    mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ...PMPShopifyCart }
        userErrors { field message }
      }
    }
    ${CART_FRAGMENT}`;

  const CART_LINES_UPDATE = `
    mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ...PMPShopifyCart }
        userErrors { field message }
      }
    }
    ${CART_FRAGMENT}`;

  const CART_LINES_REMOVE = `
    mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ...PMPShopifyCart }
        userErrors { field message }
      }
    }
    ${CART_FRAGMENT}`;

  function formatMoney(money, locale) {
    if (!money) return '';
    return new Intl.NumberFormat(locale || 'fr-FR', {
      style: 'currency',
      currency: money.currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(money.amount));
  }

  function variants(product) {
    return product && product.variants && Array.isArray(product.variants.nodes)
      ? product.variants.nodes
      : [];
  }

  function resolveVariant(product, selections) {
    const wanted = selections || {};
    return variants(product).find((variant) => {
      const selected = variant.selectedOptions || [];
      const names = Object.keys(wanted);
      return names.length === selected.length && selected.every((option) => wanted[option.name] === option.value);
    }) || null;
  }

  function variantMatchesPartial(variant, selections, ignoredName) {
    return Object.entries(selections || {}).every(([name, value]) => {
      if (name === ignoredName) return true;
      return (variant.selectedOptions || []).some((option) => option.name === name && option.value === value);
    });
  }

  function setText(root, selector, value) {
    const element = root.querySelector(selector);
    if (element) element.textContent = value == null ? '' : String(value);
  }

  function setImage(root, selector, image) {
    const element = root.querySelector(selector);
    if (!element || !image) return;
    element.src = image.url;
    element.alt = image.altText || '';
    if (image.width) element.width = image.width;
    if (image.height) element.height = image.height;
  }

  class StorefrontClient {
    constructor({ domain, token, apiVersion, fetchImpl } = {}) {
      if (!domain) throw new Error('Missing Shopify domain.');
      if (!token) throw new Error('Missing public Shopify Storefront token.');
      this.domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      this.token = token;
      this.apiVersion = apiVersion || DEFAULT_API_VERSION;
      if (fetchImpl) this.fetchImpl = fetchImpl;
      else if (global.fetch) this.fetchImpl = global.fetch.bind(global);
      else if (typeof globalThis !== 'undefined' && globalThis.fetch) this.fetchImpl = globalThis.fetch.bind(globalThis);
      else this.fetchImpl = null;
      if (!this.fetchImpl) throw new Error('Fetch is unavailable.');
    }

    async request(query, variables) {
      const response = await this.fetchImpl(`https://${this.domain}/api/${this.apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': this.token
        },
        body: JSON.stringify({ query, variables: variables || {} })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(`Shopify request failed (${response.status}).`);
      if (payload.errors && payload.errors.length) throw new Error(payload.errors.map((error) => error.message).join(' '));
      return payload.data;
    }

    unwrap(result) {
      const errors = (result && result.userErrors) || [];
      if (errors.length) throw new Error(errors.map((error) => error.message).join(' '));
      if (!result || !result.cart) throw new Error('Shopify did not return a cart.');
      return result.cart;
    }

    async productByHandle(handle) {
      const data = await this.request(PRODUCT_QUERY, { handle });
      if (!data.product) throw new Error(`Shopify product not found: ${handle}`);
      return data.product;
    }

    async cart(id) {
      const data = await this.request(CART_QUERY, { id });
      return data.cart || null;
    }

    async cartCreate(lines) {
      const data = await this.request(CART_CREATE, { lines: lines || [] });
      return this.unwrap(data.cartCreate);
    }

    async cartLinesAdd(cartId, lines) {
      const data = await this.request(CART_LINES_ADD, { cartId, lines });
      return this.unwrap(data.cartLinesAdd);
    }

    async cartLinesUpdate(cartId, lines) {
      const data = await this.request(CART_LINES_UPDATE, { cartId, lines });
      return this.unwrap(data.cartLinesUpdate);
    }

    async cartLinesRemove(cartId, lineIds) {
      const data = await this.request(CART_LINES_REMOVE, { cartId, lineIds });
      return this.unwrap(data.cartLinesRemove);
    }
  }

  class PMPCommerce {
    constructor(root, options = {}) {
      if (!root) throw new Error('PMP commerce root is required.');
      this.root = root;
      this.locale = root.dataset.pmpLocale || options.locale || 'fr-FR';
      this.storage = options.storage || (typeof globalThis !== 'undefined' && globalThis.localStorage) || global.localStorage;
      this.client = options.client || new StorefrontClient({
        domain: root.dataset.shopifyDomain,
        token: root.dataset.shopifyStorefrontToken,
        apiVersion: root.dataset.shopifyApiVersion || DEFAULT_API_VERSION
      });
      this.products = new Map();
      this.selections = new WeakMap();
      this.cart = null;
      this.busy = false;
    }

    async init() {
      this.bindCartControls();
      this.root.dataset.pmpState = 'loading';
      const productRoots = [...this.root.querySelectorAll('[data-pmp-product]')];
      const jobs = productRoots.map((productRoot) => this.loadProduct(productRoot));
      jobs.push(this.restoreCart());
      const results = await Promise.allSettled(jobs);
      const failed = results.filter((result) => result.status === 'rejected');
      this.root.dataset.pmpState = failed.length === results.length ? 'error' : 'ready';
      this.root.dispatchEvent(new global.CustomEvent('pmp:commerce-ready', { detail: { failed: failed.length } }));
      return this;
    }

    async loadProduct(productRoot) {
      const handle = productRoot.dataset.shopifyHandle;
      productRoot.dataset.pmpState = 'loading';
      this.clearProductError(productRoot);
      try {
        const product = await this.client.productByHandle(handle);
        this.products.set(productRoot, product);
        this.selections.set(productRoot, {});
        this.renderProduct(productRoot, product);
        this.bindProduct(productRoot, product);
        productRoot.dataset.pmpState = 'ready';
        productRoot.dispatchEvent(new global.CustomEvent('pmp:product-ready', { detail: { product } }));
      } catch (error) {
        productRoot.dataset.pmpState = 'error';
        this.showProductError(productRoot, error.message);
        throw error;
      }
    }

    renderProduct(productRoot, product) {
      const title = productRoot.querySelector('[data-pmp-title]');
      if (title && !title.hasAttribute('data-pmp-editorial-override')) title.textContent = product.title;
      setText(productRoot, '[data-pmp-price]', formatMoney(variants(product)[0] && variants(product)[0].price, this.locale));
      setImage(productRoot, '[data-pmp-image]', product.featuredImage);
      productRoot.dataset.pmpAvailable = String(Boolean(product.availableForSale));
      const optionsRoot = productRoot.querySelector('[data-pmp-options]');
      if (!optionsRoot) return;
      optionsRoot.replaceChildren();
      (product.options || []).filter((option) => option.name !== 'Title').forEach((option) => {
        const group = document.createElement('fieldset');
        group.className = 'pmp-option-group';
        group.dataset.pmpOption = option.name;
        const legend = document.createElement('legend');
        legend.className = 'pmp-option-legend';
        legend.textContent = option.name;
        legend.dataset.pmpOptionLabel = '';
        group.appendChild(legend);
        (option.optionValues || []).forEach(({ name: value }) => {
          const button = document.createElement('button');
          button.className = 'pmp-option-value';
          button.type = 'button';
          button.textContent = value;
          button.dataset.pmpOptionName = option.name;
          button.dataset.pmpOptionValue = value;
          button.dataset.pmpSelected = 'false';
          group.appendChild(button);
        });
        optionsRoot.appendChild(group);
      });
      const realOptions = (product.options || []).filter((option) => option.name !== 'Title');
      if (!realOptions.length && variants(product).length === 1) {
        const only = variants(product)[0];
        const selected = {};
        (only.selectedOptions || []).forEach((option) => { selected[option.name] = option.value; });
        this.selections.set(productRoot, selected);
        productRoot.dataset.pmpVariantId = only.id;
      }
      this.refreshOptions(productRoot, product);
    }

    bindProduct(productRoot, product) {
      productRoot.addEventListener('click', (event) => {
        const option = event.target.closest('[data-pmp-option-value]');
        if (option && !option.disabled) {
          event.preventDefault();
          const selected = { ...(this.selections.get(productRoot) || {}) };
          selected[option.dataset.pmpOptionName] = option.dataset.pmpOptionValue;
          this.selections.set(productRoot, selected);
          this.clearProductError(productRoot);
          this.refreshOptions(productRoot, product);
          return;
        }
        const add = event.target.closest('[data-pmp-add-to-cart]');
        if (add) {
          event.preventDefault();
          this.addProduct(productRoot, product, add);
        }
      });
    }

    refreshOptions(productRoot, product) {
      const selected = this.selections.get(productRoot) || {};
      productRoot.querySelectorAll('[data-pmp-option-value]').forEach((button) => {
        const name = button.dataset.pmpOptionName;
        const value = button.dataset.pmpOptionValue;
        const candidateExists = variants(product).some((variant) => {
          const hasValue = (variant.selectedOptions || []).some((option) => option.name === name && option.value === value);
          return hasValue && variantMatchesPartial(variant, selected, name);
        });
        const availableExists = variants(product).some((variant) => {
          const hasValue = (variant.selectedOptions || []).some((option) => option.name === name && option.value === value);
          return hasValue && variant.availableForSale && variantMatchesPartial(variant, selected, name);
        });
        button.dataset.pmpSelected = String(selected[name] === value);
        button.dataset.pmpAvailable = String(Boolean(availableExists));
        button.classList.toggle('pmp-is-selected', selected[name] === value);
        button.classList.toggle('pmp-is-unavailable', !candidateExists || !availableExists);
        button.disabled = !candidateExists || !availableExists;
        button.setAttribute('aria-pressed', String(selected[name] === value));
      });
      const resolved = resolveVariant(product, selected);
      if (resolved) {
        productRoot.dataset.pmpVariantId = resolved.id;
        productRoot.dataset.pmpAvailable = String(Boolean(resolved.availableForSale));
        setText(productRoot, '[data-pmp-price]', formatMoney(resolved.price, this.locale));
        setText(productRoot, '[data-pmp-compare-at-price]', formatMoney(resolved.compareAtPrice, this.locale));
        setImage(productRoot, '[data-pmp-image]', resolved.image || product.featuredImage);
      } else {
        delete productRoot.dataset.pmpVariantId;
      }
    }

    async addProduct(productRoot, product, button) {
      const selection = this.selections.get(productRoot) || {};
      const expected = (product.options || []).filter((option) => option.name !== 'Title').length;
      if (Object.keys(selection).filter((name) => name !== 'Title').length < expected) {
        this.showProductError(productRoot, 'Please select all product options.');
        return;
      }
      const variant = resolveVariant(product, selection);
      if (!variant) {
        this.showProductError(productRoot, 'This option combination is unavailable.');
        return;
      }
      if (!variant.availableForSale) {
        this.showProductError(productRoot, 'This variant is sold out.');
        return;
      }
      if (this.busy) return;
      this.busy = true;
      button.dataset.pmpAdding = 'true';
      button.classList.add('pmp-is-adding');
      button.disabled = true;
      this.clearProductError(productRoot);
      try {
        const cart = await this.ensureCart();
        this.cart = await this.client.cartLinesAdd(cart.id, [{ merchandiseId: variant.id, quantity: 1 }]);
        this.persistCart(this.cart);
        this.renderCart();
        this.openCart();
        productRoot.dispatchEvent(new global.CustomEvent('pmp:cart-add', { detail: { cart: this.cart, variant } }));
      } catch (error) {
        this.showProductError(productRoot, error.message);
      } finally {
        this.busy = false;
        button.dataset.pmpAdding = 'false';
        button.classList.remove('pmp-is-adding');
        button.disabled = false;
      }
    }

    bindCartControls() {
      this.root.addEventListener('click', (event) => {
        if (event.target.closest('[data-pmp-cart-open-button]')) { event.preventDefault(); this.openCart(); }
        if (event.target.closest('[data-pmp-cart-close]')) { event.preventDefault(); this.closeCart(); }
        if (event.target.closest('[data-pmp-checkout]')) { event.preventDefault(); this.checkout(); }
        const line = event.target.closest('[data-pmp-cart-line]');
        if (!line || !line.dataset.pmpLineId) return;
        if (event.target.closest('[data-pmp-line-increase]')) { event.preventDefault(); this.updateLine(line.dataset.pmpLineId, Number(line.dataset.pmpQuantity) + 1); }
        if (event.target.closest('[data-pmp-line-decrease]')) { event.preventDefault(); this.updateLine(line.dataset.pmpLineId, Number(line.dataset.pmpQuantity) - 1); }
        if (event.target.closest('[data-pmp-line-remove]')) { event.preventDefault(); this.removeLine(line.dataset.pmpLineId); }
      });
    }

    async restoreCart() {
      const id = this.storage && this.storage.getItem(CART_KEY);
      if (!id) {
        this.renderCart();
        return null;
      }
      try {
        this.cart = await this.client.cart(id);
        if (!this.cart) this.clearPersistedCart();
      } catch (_) {
        this.cart = null;
        this.clearPersistedCart();
      }
      this.renderCart();
      return this.cart;
    }

    async ensureCart() {
      if (this.cart && this.cart.id) return this.cart;
      this.cart = await this.client.cartCreate([]);
      this.persistCart(this.cart);
      return this.cart;
    }

    async updateLine(lineId, quantity) {
      if (quantity <= 0) return this.removeLine(lineId);
      return this.mutateCart(async () => this.client.cartLinesUpdate(this.cart.id, [{ id: lineId, quantity }]));
    }

    async removeLine(lineId) {
      return this.mutateCart(async () => this.client.cartLinesRemove(this.cart.id, [lineId]));
    }

    async mutateCart(operation) {
      if (!this.cart || this.busy) return;
      this.busy = true;
      this.root.dataset.pmpCartState = 'updating';
      this.showCartError('');
      try {
        this.cart = await operation();
        this.persistCart(this.cart);
        this.renderCart();
      } catch (error) {
        this.root.dataset.pmpCartState = 'error';
        this.showCartError(error.message);
      } finally {
        this.busy = false;
      }
    }

    renderCart() {
      const lines = this.cart && this.cart.lines && this.cart.lines.nodes ? this.cart.lines.nodes : [];
      this.root.dataset.pmpCartState = lines.length ? 'ready' : 'empty';
      this.root.classList.toggle('pmp-is-cart-empty', !lines.length);
      setText(this.root, '[data-pmp-cart-count]', this.cart ? this.cart.totalQuantity : 0);
      setText(this.root, '[data-pmp-cart-total]', this.cart ? formatMoney(this.cart.cost.subtotalAmount, this.locale) : formatMoney({ amount: '0', currencyCode: 'EUR' }, this.locale));
      const linesRoot = this.root.querySelector('[data-pmp-cart-lines]');
      if (!linesRoot) return;
      linesRoot.replaceChildren();
      const template = this.root.querySelector('template[data-pmp-cart-line-template]');
      lines.forEach((line) => {
        const element = template && template.content
          ? template.content.firstElementChild.cloneNode(true)
          : document.createElement('article');
        element.dataset.pmpCartLine = '';
        element.dataset.pmpLineId = line.id;
        element.dataset.pmpQuantity = String(line.quantity);
        const merchandise = line.merchandise;
        setText(element, '[data-pmp-line-title]', merchandise.product.title);
        const variantText = (merchandise.selectedOptions || []).filter((option) => option.name !== 'Title').map((option) => option.value).join(' / ');
        setText(element, '[data-pmp-line-variant]', variantText);
        setText(element, '[data-pmp-line-price]', formatMoney(line.cost.totalAmount, this.locale));
        setText(element, '[data-pmp-line-quantity]', line.quantity);
        setImage(element, '[data-pmp-line-image]', merchandise.image);
        linesRoot.appendChild(element);
      });
      const checkout = this.root.querySelector('[data-pmp-checkout]');
      if (checkout) checkout.disabled = !lines.length;
      const empty = this.root.querySelector('.pmp-cart-empty');
      if (empty) empty.classList.toggle('pmp-is-hidden', Boolean(lines.length));
    }

    openCart() {
      this.root.dataset.pmpCartOpen = 'true';
      this.root.classList.add('pmp-is-cart-open');
      const cart = this.root.querySelector('[data-pmp-cart]');
      if (cart) {
        cart.setAttribute('aria-hidden', 'false');
        cart.classList.add('pmp-cart-drawer-open');
      }
      const backdrop = this.root.querySelector('.pmp-cart-backdrop');
      if (backdrop) backdrop.classList.add('pmp-cart-backdrop-open');
    }

    closeCart() {
      this.root.dataset.pmpCartOpen = 'false';
      this.root.classList.remove('pmp-is-cart-open');
      const cart = this.root.querySelector('[data-pmp-cart]');
      if (cart) {
        cart.setAttribute('aria-hidden', 'true');
        cart.classList.remove('pmp-cart-drawer-open');
      }
      const backdrop = this.root.querySelector('.pmp-cart-backdrop');
      if (backdrop) backdrop.classList.remove('pmp-cart-backdrop-open');
    }

    checkout() {
      if (!this.cart || !this.cart.checkoutUrl) {
        this.showCartError('Your bag is empty.');
        return;
      }
      global.location.assign(this.cart.checkoutUrl);
    }

    persistCart(cart) {
      if (!this.storage || !cart || !cart.id) return;
      this.storage.setItem(CART_KEY, cart.id);
      this.storage.setItem(CART_UPDATED_KEY, new Date().toISOString());
    }

    clearPersistedCart() {
      if (!this.storage) return;
      this.storage.removeItem(CART_KEY);
      this.storage.removeItem(CART_UPDATED_KEY);
    }

    clearProductError(root) { this.showProductError(root, ''); }
    showProductError(root, message) {
      setText(root, '[data-pmp-product-error]', message);
      root.dataset.pmpError = message ? 'true' : 'false';
    }
    showCartError(message) { setText(this.root, '[data-pmp-cart-error]', message); }
  }

  function autoInit() {
    if (!global.document) return;
    [...global.document.querySelectorAll('[data-pmp-commerce]')].forEach((root) => {
      if (root.dataset.pmpInitialized === 'true') return;
      root.dataset.pmpInitialized = 'true';
      const app = new PMPCommerce(root);
      root.pmpCommerce = app;
      app.init();
    });
  }

  const api = { StorefrontClient, PMPCommerce, formatMoney, resolveVariant, autoInit };
  const isCommonJS = typeof module !== 'undefined' && module.exports;
  if (isCommonJS) module.exports = api;
  global.PMPCommerceRuntime = api;
  if (global.document && !isCommonJS) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', autoInit, { once: true });
    else autoInit();
  }
})(typeof window !== 'undefined' ? window : globalThis);
