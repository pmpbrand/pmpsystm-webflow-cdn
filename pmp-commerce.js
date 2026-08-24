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
              product { id title handle }
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

  function cartLines(cart) {
    return cart && cart.lines && Array.isArray(cart.lines.nodes) ? cart.lines.nodes : [];
  }

  function eventTargetWindow(element) {
    return element && element.ownerDocument && element.ownerDocument.defaultView;
  }

  function dispatch(element, name, detail) {
    const view = eventTargetWindow(element);
    const EventConstructor = (view && view.CustomEvent) || global.CustomEvent;
    if (typeof EventConstructor !== 'function') return;
    element.dispatchEvent(new EventConstructor(name, { bubbles: true, detail }));
  }

  function checkoutUrlIsSafe(value, allowedHosts) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:'
        && !url.username
        && !url.password
        && allowedHosts instanceof Set
        && allowedHosts.has(url.hostname.toLowerCase());
    } catch (_) {
      return false;
    }
  }

  class StorefrontClient {
    constructor({ domain, token, apiVersion, fetchImpl } = {}) {
      if (!domain) throw new Error('Missing Shopify domain.');
      if (!token) throw new Error('Missing public Shopify Storefront token.');
      this.domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(this.domain)) {
        throw new Error('Invalid Shopify domain. Expected a *.myshopify.com hostname.');
      }
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
      let payload;
      try { payload = await response.json(); }
      catch (_) {
        throw new Error(response.ok ? 'Shopify returned an invalid response.' : `Shopify request failed (${response.status}).`);
      }
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
      this.checkoutHosts = new Set([
        root.dataset.shopifyDomain,
        root.dataset.shopifyCheckoutDomain
      ].filter(Boolean).map((host) => host.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()));
      this.products = new Map();
      this.productCache = new Map();
      this.selections = new WeakMap();
      this.cart = null;
      this.busy = false;
      this.actionQueue = Promise.resolve();
      this.pendingAddButtons = new WeakSet();
      this.navigate = options.navigate || ((url) => {
        const view = eventTargetWindow(this.root) || global;
        view.location.assign(url);
      });
    }

    async init() {
      this.bindCartControls();
      this.root.dataset.pmpState = 'loading';
      this.root.dataset.pmpCartState = 'loading';
      const productRoots = [...this.root.querySelectorAll('[data-pmp-product]')];
      const productJobs = productRoots.map((productRoot) => this.loadProduct(productRoot));
      const [productResults] = await Promise.all([
        Promise.allSettled(productJobs),
        this.restoreCart()
      ]);
      const failed = productResults.filter((result) => result.status === 'rejected');
      this.root.dataset.pmpState = productRoots.length && failed.length === productRoots.length ? 'error' : 'ready';
      dispatch(this.root, 'pmp:commerce-ready', { failed: failed.length });
      return this;
    }

    async loadProduct(productRoot) {
      const handle = productRoot.dataset.pmpProductHandle || productRoot.dataset.shopifyHandle;
      productRoot.dataset.pmpState = 'loading';
      this.clearProductError(productRoot);
      try {
        if (!handle) throw new Error('Missing Shopify product handle.');
        const product = await this.getProduct(handle);
        if (!product) throw new Error(`Product not found: ${handle}`);
        this.products.set(productRoot, product);
        if (!this.selections.has(productRoot)) this.selections.set(productRoot, {});
        this.renderProduct(productRoot, product);
        this.bindProduct(productRoot);
        productRoot.dataset.pmpState = product.availableForSale === false ? 'sold-out' : 'ready';
        dispatch(productRoot, 'pmp:product-ready', { product });
        this.analytics(productRoot, 'view_item', { items: [this.productItem(product)] });
      } catch (error) {
        productRoot.dataset.pmpState = 'error';
        productRoot.querySelectorAll('[data-pmp-add], [data-pmp-add-to-cart]').forEach((button) => {
          button.dataset.pmpState = 'error';
          button.disabled = true;
        });
        this.showProductError(productRoot, error.message);
        throw error;
      }
    }

    getProduct(handle, { force = false } = {}) {
      if (!force && this.productCache.has(handle)) return this.productCache.get(handle);
      const request = Promise.resolve().then(() => this.client.productByHandle(handle));
      this.productCache.set(handle, request);
      request.catch(() => {
        if (this.productCache.get(handle) === request) this.productCache.delete(handle);
      });
      return request;
    }

    renderProduct(productRoot, product) {
      const title = productRoot.querySelector('[data-pmp-title]');
      if (title && !title.hasAttribute('data-pmp-editorial-override')) title.textContent = product.title;
      setText(productRoot, '[data-pmp-price]', formatMoney(variants(product)[0] && variants(product)[0].price, this.locale));
      setImage(productRoot, '[data-pmp-image]', product.featuredImage);
      productRoot.dataset.pmpAvailable = String(Boolean(product.availableForSale));
      const soldOut = product.availableForSale === false;
      productRoot.querySelectorAll('[data-pmp-add], [data-pmp-add-to-cart]').forEach((button) => {
        if (this.pendingAddButtons.has(button)) return;
        button.dataset.pmpState = soldOut ? 'sold-out' : 'ready';
        button.disabled = soldOut;
      });
      const realOptions = (product.options || []).filter((option) => option.name !== 'Title');
      if (!realOptions.length && variants(product).length === 1) {
        const only = variants(product)[0];
        const selected = {};
        (only.selectedOptions || []).forEach((option) => { selected[option.name] = option.value; });
        this.selections.set(productRoot, selected);
        productRoot.dataset.pmpVariantId = only.id;
      }
      const optionsRoot = productRoot.querySelector('[data-pmp-options]');
      if (!optionsRoot) {
        this.refreshOptions(productRoot, product);
        return;
      }
      optionsRoot.replaceChildren();
      const document = productRoot.ownerDocument;
      realOptions.forEach((option) => {
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
      this.refreshOptions(productRoot, product);
    }

    bindProduct(productRoot) {
      if (productRoot.dataset.pmpBound === 'true') return;
      productRoot.dataset.pmpBound = 'true';
      productRoot.addEventListener('click', (event) => {
        const option = event.target.closest('[data-pmp-option-value]');
        if (option && !option.disabled) {
          event.preventDefault();
          const selected = { ...(this.selections.get(productRoot) || {}) };
          selected[option.dataset.pmpOptionName] = option.dataset.pmpOptionValue;
          this.selections.set(productRoot, selected);
          this.clearProductError(productRoot);
          productRoot.dataset.pmpState = 'ready';
          productRoot.querySelectorAll('[data-pmp-add], [data-pmp-add-to-cart]').forEach((button) => {
            if (!this.pendingAddButtons.has(button)) button.dataset.pmpState = 'ready';
          });
          const product = this.products.get(productRoot);
          this.refreshOptions(productRoot, product);
          const resolved = resolveVariant(product, selected);
          if (resolved) this.analytics(productRoot, 'select_item', { items: [this.variantItem(product, resolved, 1)] });
          return;
        }
        const add = event.target.closest('[data-pmp-add-to-cart], [data-pmp-add]');
        if (add) {
          event.preventDefault();
          this.addProduct(productRoot, this.products.get(productRoot), add);
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
        button.dataset.pmpState = selected[name] === value ? 'selected' : (availableExists ? 'ready' : 'unavailable');
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

    addProduct(productRoot, product, button) {
      if (!product || this.pendingAddButtons.has(button)) return this.actionQueue;
      const selection = this.selections.get(productRoot) || {};
      const expected = (product.options || []).filter((option) => option.name !== 'Title').length;
      if (Object.keys(selection).filter((name) => name !== 'Title').length < expected) {
        this.showProductError(productRoot, 'Please select all product options.');
        productRoot.dataset.pmpState = 'error';
        button.dataset.pmpState = 'error';
        return this.actionQueue;
      }
      const variant = resolveVariant(product, selection);
      if (!variant) {
        this.showProductError(productRoot, 'This option combination is unavailable.');
        productRoot.dataset.pmpState = 'error';
        button.dataset.pmpState = 'error';
        return this.actionQueue;
      }
      if (!variant.availableForSale) {
        this.showProductError(productRoot, 'This variant is sold out.');
        productRoot.dataset.pmpState = 'error';
        button.dataset.pmpState = 'error';
        return this.actionQueue;
      }
      const handle = product.handle || productRoot.dataset.pmpProductHandle || productRoot.dataset.shopifyHandle;
      this.pendingAddButtons.add(button);
      button.dataset.pmpAdding = 'true';
      button.dataset.pmpState = 'adding';
      productRoot.dataset.pmpState = 'adding';
      button.classList.add('pmp-is-adding');
      button.disabled = true;
      this.clearProductError(productRoot);
      return this.enqueue(async () => {
        try {
          const lines = [{ merchandiseId: variant.id, quantity: 1 }];
          this.cart = this.cart && this.cart.id
            ? await this.client.cartLinesAdd(this.cart.id, lines)
            : await this.client.cartCreate(lines);
          this.persistCart(this.cart);
          this.renderCart();
          this.openCart();
          productRoot.dataset.pmpState = 'added';
          button.dataset.pmpState = 'added';
          dispatch(productRoot, 'pmp:cart-add', { cart: this.cart, variant });
          this.analytics(productRoot, 'add_to_cart', { items: [this.variantItem(product, variant, 1)] });
        } catch (error) {
          await this.refreshHandleAfterAddFailure(handle);
          productRoot.dataset.pmpState = 'error';
          button.dataset.pmpState = 'error';
          this.showProductError(productRoot, error.message);
        } finally {
          this.pendingAddButtons.delete(button);
          button.dataset.pmpAdding = 'false';
          button.classList.remove('pmp-is-adding');
          button.disabled = false;
        }
      });
    }

    async refreshHandleAfterAddFailure(handle) {
      if (!handle) return;
      try {
        const fresh = await this.getProduct(handle, { force: true });
        this.products.forEach((current, root) => {
          if (current && current.handle === handle) {
            this.products.set(root, fresh);
            this.renderProduct(root, fresh);
          }
        });
      } catch (_) {
        // The mutation error remains the actionable message; refresh is best-effort.
      }
    }

    enqueue(operation) {
      const run = async () => {
        this.busy = true;
        try { return await operation(); }
        finally { this.busy = false; }
      };
      const result = this.actionQueue.then(run, run);
      this.actionQueue = result.catch(() => {});
      return result;
    }

    whenIdle() { return this.actionQueue; }

    bindCartControls() {
      this.root.addEventListener('click', (event) => {
        if (event.target.closest('[data-pmp-cart-open-button], [data-pmp-cart-trigger]')) { event.preventDefault(); this.openCart(); }
        if (event.target.closest('[data-pmp-cart-close]')) { event.preventDefault(); this.closeCart(); }
        if (event.target.closest('[data-pmp-checkout]')) { event.preventDefault(); this.checkout(); }
        const line = event.target.closest('[data-pmp-cart-line]');
        if (!line || !line.dataset.pmpLineId) return;
        if (event.target.closest('[data-pmp-line-increase]')) { event.preventDefault(); this.changeLine(line.dataset.pmpLineId, 1); }
        if (event.target.closest('[data-pmp-line-decrease]')) { event.preventDefault(); this.changeLine(line.dataset.pmpLineId, -1); }
        if (event.target.closest('[data-pmp-line-remove]')) { event.preventDefault(); this.removeLine(line.dataset.pmpLineId); }
      });
    }

    async restoreCart() {
      const id = this.storageValue(CART_KEY);
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

    updateLine(lineId, quantity) {
      return this.mutateCart(async () => {
        if (quantity <= 0) {
          const removed = cartLines(this.cart).find((line) => line.id === lineId);
          return { cart: await this.removeLineNow(lineId), removed };
        }
        return this.client.cartLinesUpdate(this.cart.id, [{ id: lineId, quantity }]);
      });
    }

    changeLine(lineId, delta) {
      return this.mutateCart(async () => {
        const line = cartLines(this.cart).find((item) => item.id === lineId);
        if (!line) throw new Error('This cart line is no longer available.');
        const quantity = Number(line.quantity) + delta;
        if (quantity <= 0) return { cart: await this.removeLineNow(lineId), removed: line };
        return this.client.cartLinesUpdate(this.cart.id, [{ id: lineId, quantity }]);
      });
    }

    removeLine(lineId) {
      return this.mutateCart(() => this.removeLineNow(lineId), { removeLineId: lineId });
    }

    removeLineNow(lineId) {
      return this.client.cartLinesRemove(this.cart.id, [lineId]);
    }

    mutateCart(operation, { removeLineId } = {}) {
      return this.enqueue(async () => {
        if (!this.cart || !this.cart.id) return;
        this.root.dataset.pmpCartState = 'updating';
        this.showCartError('');
        let removed = removeLineId && cartLines(this.cart).find((line) => line.id === removeLineId);
        try {
          const result = await operation();
          if (result && result.cart && Object.prototype.hasOwnProperty.call(result, 'removed')) {
            this.cart = result.cart;
            removed = result.removed;
          } else {
            this.cart = result;
          }
          this.persistCart(this.cart);
          this.renderCart();
          if (removed) this.analytics(this.root, 'remove_from_cart', { items: [this.lineItem(removed)] });
        } catch (error) {
          this.root.dataset.pmpCartState = 'error';
          this.showCartError(error.message);
        }
      });
    }

    renderCart() {
      const lines = cartLines(this.cart);
      this.root.dataset.pmpCartState = lines.length ? 'ready' : 'empty';
      this.root.classList.toggle('pmp-is-cart-empty', !lines.length);
      setText(this.root, '[data-pmp-cart-count]', this.cart ? this.cart.totalQuantity : 0);
      const subtotal = this.cart && this.cart.cost && this.cart.cost.subtotalAmount;
      setText(this.root, '[data-pmp-cart-total]', formatMoney(subtotal || { amount: '0', currencyCode: 'EUR' }, this.locale));
      const linesRoot = this.root.querySelector('[data-pmp-cart-lines], [data-pmp-cart-items]');
      if (!linesRoot) return;
      linesRoot.replaceChildren();
      const template = this.root.querySelector('template[data-pmp-cart-line-template]');
      const document = this.root.ownerDocument;
      lines.forEach((line) => {
        const element = template && template.content
          ? template.content.firstElementChild.cloneNode(true)
          : document.createElement('article');
        element.dataset.pmpCartLine = '';
        element.dataset.pmpLineId = line.id;
        element.dataset.pmpQuantity = String(line.quantity);
        const merchandise = line.merchandise || {};
        setText(element, '[data-pmp-line-title]', merchandise.product && merchandise.product.title);
        const variantText = (merchandise.selectedOptions || []).filter((option) => option.name !== 'Title').map((option) => option.value).join(' / ');
        setText(element, '[data-pmp-line-variant]', variantText);
        setText(element, '[data-pmp-line-price]', formatMoney(line.cost.totalAmount, this.locale));
        setText(element, '[data-pmp-line-quantity]', line.quantity);
        setImage(element, '[data-pmp-line-image]', merchandise.image);
        linesRoot.appendChild(element);
      });
      const checkout = this.root.querySelector('[data-pmp-checkout]');
      if (checkout) {
        checkout.disabled = !lines.length;
        checkout.dataset.pmpState = lines.length ? 'ready' : 'checkout-unavailable';
        checkout.setAttribute('aria-disabled', String(!lines.length));
      }
      const empty = this.root.querySelector('[data-pmp-cart-empty]');
      if (empty) {
        empty.dataset.pmpState = lines.length ? 'hidden' : 'empty';
        empty.setAttribute('aria-hidden', String(Boolean(lines.length)));
      }
    }

    openCart() {
      this.root.dataset.pmpCartOpen = 'true';
      this.root.classList.add('pmp-is-cart-open');
      const cart = this.root.querySelector('[data-pmp-cart]');
      if (cart) {
        cart.setAttribute('aria-hidden', 'false');
        cart.dataset.pmpOpen = 'true';
        cart.classList.add('pmp-cart-drawer-open');
      }
      const backdrop = this.root.querySelector('[data-pmp-cart-backdrop]');
      if (backdrop) backdrop.dataset.pmpOpen = 'true';
      this.analytics(this.root, 'view_cart', { items: cartLines(this.cart).map((line) => this.lineItem(line)) });
    }

    closeCart() {
      this.root.dataset.pmpCartOpen = 'false';
      this.root.classList.remove('pmp-is-cart-open');
      const cart = this.root.querySelector('[data-pmp-cart]');
      if (cart) {
        cart.setAttribute('aria-hidden', 'true');
        cart.dataset.pmpOpen = 'false';
        cart.classList.remove('pmp-cart-drawer-open');
      }
      const backdrop = this.root.querySelector('[data-pmp-cart-backdrop]');
      if (backdrop) backdrop.dataset.pmpOpen = 'false';
    }

    checkout() {
      return this.enqueue(async () => {
        const checkout = this.root.querySelector('[data-pmp-checkout]');
        this.showCartError('');
        if (!this.cart || !this.cart.id) {
          this.checkoutUnavailable('Your bag is empty.', checkout);
          return;
        }
        this.root.dataset.pmpCartState = 'updating';
        if (checkout) checkout.dataset.pmpState = 'updating';
        try {
          const refreshed = await this.client.cart(this.cart.id);
          if (!refreshed) {
            this.cart = null;
            this.clearPersistedCart();
            this.renderCart();
            this.checkoutUnavailable('Your bag is no longer available.', checkout);
            return;
          }
          const lines = cartLines(refreshed);
          this.cart = refreshed;
          this.persistCart(refreshed);
          this.renderCart();
          const invalidLine = lines.some((line) => !line || Number(line.quantity) <= 0 || !line.merchandise || !line.merchandise.id || line.merchandise.availableForSale === false);
          if (!refreshed.id || !lines.length || Number(refreshed.totalQuantity) <= 0 || invalidLine) {
            this.checkoutUnavailable('Your bag is empty or contains an unavailable item.', checkout);
            return;
          }
          if (!checkoutUrlIsSafe(refreshed.checkoutUrl, this.checkoutHosts)) {
            this.checkoutUnavailable('Checkout is unavailable.', checkout);
            return;
          }
          this.analytics(this.root, 'begin_checkout', { items: lines.map((line) => this.lineItem(line)) });
          this.navigate(refreshed.checkoutUrl);
        } catch (error) {
          this.checkoutUnavailable(error.message || 'Checkout is unavailable.', checkout);
        }
      });
    }

    checkoutUnavailable(message, button) {
      this.root.dataset.pmpCartState = 'checkout-unavailable';
      if (button) button.dataset.pmpState = 'checkout-unavailable';
      this.showCartError(message);
    }

    persistCart(cart) {
      if (!this.storage || !cart || !cart.id) return;
      try {
        this.storage.setItem(CART_KEY, cart.id);
        this.storage.setItem(CART_UPDATED_KEY, new Date().toISOString());
      } catch (_) {
        // Storage can be unavailable in privacy modes; the in-memory cart remains valid.
      }
    }

    clearPersistedCart() {
      if (!this.storage) return;
      try {
        this.storage.removeItem(CART_KEY);
        this.storage.removeItem(CART_UPDATED_KEY);
      } catch (_) {
        // A blocked storage API must not block commerce initialization.
      }
    }

    storageValue(key) {
      try { return this.storage && this.storage.getItem(key); }
      catch (_) { return null; }
    }

    productItem(product) {
      const first = variants(product)[0];
      return {
        item_id: product.id,
        item_name: product.title,
        item_handle: product.handle,
        currency: first && first.price && first.price.currencyCode,
        price: first && first.price && Number(first.price.amount)
      };
    }

    variantItem(product, variant, quantity) {
      return {
        item_id: variant.id,
        item_name: product.title,
        item_handle: product.handle,
        item_variant: variant.title,
        currency: variant.price && variant.price.currencyCode,
        price: variant.price && Number(variant.price.amount),
        quantity
      };
    }

    lineItem(line) {
      const merchandise = line.merchandise || {};
      const product = merchandise.product || {};
      const total = line.cost && line.cost.totalAmount;
      return {
        item_id: merchandise.id,
        item_name: product.title,
        item_handle: product.handle,
        item_variant: merchandise.title,
        currency: total && total.currencyCode,
        value: total && Number(total.amount),
        quantity: Number(line.quantity) || 0
      };
    }

    analytics(target, event, metadata) {
      const items = (metadata && metadata.items) || [];
      const currency = items.find((item) => item.currency);
      const value = items.reduce((sum, item) => {
        const itemValue = item.value == null ? Number(item.price || 0) * Number(item.quantity || 1) : Number(item.value);
        return sum + itemValue;
      }, 0);
      dispatch(target, 'pmp:analytics', {
        event,
        currency: currency && currency.currency,
        value,
        items
      });
    }

    clearProductError(root) { this.showProductError(root, ''); }
    showProductError(root, message) {
      setText(root, '[data-pmp-product-error]', message);
      root.dataset.pmpError = message ? 'true' : 'false';
    }
    showCartError(message) { setText(this.root, '[data-pmp-cart-error]', message); }
  }

  function adaptCMSHandles(root) {
    if (!root || !root.querySelectorAll) return;
    [...root.querySelectorAll('[data-pmp-product]')].forEach((productRoot) => {
      const explicit = (productRoot.dataset.pmpProductHandle || productRoot.dataset.shopifyHandle || '').trim();
      const source = productRoot.querySelector('[data-pmp-cms-handle]');
      const handle = explicit || (source ? source.textContent.trim() : '');
      if (handle) {
        productRoot.dataset.pmpProductHandle = handle;
        productRoot.dataset.shopifyHandle = handle;
        productRoot.dataset.pmpMappingState = 'mapped';
      } else {
        productRoot.dataset.pmpMappingState = 'missing';
      }
    });
  }

  function autoInit() {
    if (!global.document) return;
    [...global.document.querySelectorAll('[data-pmp-commerce]')].forEach((root) => {
      if (root.dataset.pmpInitialized === 'true') return;
      adaptCMSHandles(root);
      root.dataset.pmpInitialized = 'true';
      const app = new PMPCommerce(root);
      root.pmpCommerce = app;
      app.init();
    });
  }

  const api = { StorefrontClient, PMPCommerce, formatMoney, resolveVariant, adaptCMSHandles, autoInit };
  const isCommonJS = typeof module !== 'undefined' && module.exports;
  if (isCommonJS) module.exports = api;
  global.PMPCommerceRuntime = api;
  if (global.document && !isCommonJS) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', autoInit, { once: true });
    else autoInit();
  }
})(typeof window !== 'undefined' ? window : globalThis);
