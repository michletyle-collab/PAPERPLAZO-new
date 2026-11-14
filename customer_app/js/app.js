import { productsApi } from '/shared/products.js';

const API = '/api';
const readStorage = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
};
const parseStorageJson = (key, fallback) => {
  const raw = readStorage(key, '');
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};
const state = {
  token: readStorage('paperplazo_customer_token', ''),
  user: parseStorageJson('paperplazo_customer_user', null),
  guestCart: parseStorageJson('paperplazo_guest_cart', []),
  cart: null,
  products: [],
  firestoreProducts: [],
  productListener: null
};
const app = document.getElementById('app');
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const dateText = value => value ? new Date(value).toLocaleDateString('en-IN', {year:'numeric', month:'short', day:'numeric'}) : '';
let toastTimer;

function toast(message, isError = false) {
  const box = $('#toast'); box.textContent = message; box.style.background = isError ? '#8d3026' : '';
  box.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('show'), 4200);
}
function triggerCartFly(sourceEl, thumbnail = '') {
  const target = document.querySelector('.bag-button');
  if (!sourceEl || !target) return;
  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const fly = document.createElement('div');
  const url = thumbnail && /^https?:|^\//.test(thumbnail) ? thumbnail : '';
  fly.className = 'cart-fly-item';
  if (url) fly.style.backgroundImage = `url("${url}")`;
  fly.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
  fly.style.top = `${sourceRect.top + sourceRect.height / 2}px`;
  document.body.appendChild(fly);
  requestAnimationFrame(() => {
    const dx = targetRect.left + targetRect.width / 2 - sourceRect.left - sourceRect.width / 2;
    const dy = targetRect.top + targetRect.height / 2 - sourceRect.top - sourceRect.height / 2;
    fly.style.setProperty('--tx', `${dx}px`);
    fly.style.setProperty('--ty', `${dy}px`);
    fly.classList.add('active');
  });
  setTimeout(() => fly.remove(), 920);
}
function initScrollAnimations(root = document) {
  const revealItems = root.querySelectorAll('.product-card, .step, .feature, .manifesto, .faq details, .form-card, .auth-wrap, .cart-line');
  if (!revealItems.length) return;
  if (!('IntersectionObserver' in window)) {
    revealItems.forEach(item => item.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, {threshold: 0.12, rootMargin: '0px 0px -30px 0px'});
  revealItems.forEach(item => observer.observe(item));
}
async function request(path, options = {}) {
  const headers = {...(options.headers || {})};
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try { response = await fetch(`${API}${path}`, {...options, headers}); }
  catch { throw new Error('Unable to reach PAPERPLAZO. Please check your connection and try again.'); }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) logout(false);
    throw new Error(payload.error || 'Something went wrong. Please try again.');
  }
  return payload;
}
function persistUser(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('paperplazo_customer_token', token); localStorage.setItem('paperplazo_customer_user', JSON.stringify(user));
  $('#account-link').textContent = 'ACCOUNT';
}
function logout(show = true) {
  state.token = ''; state.user = null; state.cart = null;
  localStorage.removeItem('paperplazo_customer_token'); localStorage.removeItem('paperplazo_customer_user');
  $('#account-link').textContent = 'ACCOUNT'; if (show) { toast('You have been signed out.'); location.hash = '#home'; }
}
function saveGuestCart() { localStorage.setItem('paperplazo_guest_cart', JSON.stringify(state.guestCart)); }
function route() { return location.hash.replace(/^#/, '') || 'home'; }
function go(path) { location.hash = `#${path}`; }
function bagArt() { return `<svg class="bag-art" viewBox="0 0 150 180" aria-hidden="true"><defs><linearGradient id="bag-gradient" x1="0" x2="1"><stop stop-color="#c89b63"/><stop offset=".65" stop-color="#dfb982"/><stop offset="1" stop-color="#947044"/></linearGradient></defs><path d="M49 43 C43 1 107 1 101 43" fill="none" stroke="#93643b" stroke-width="6"/><path d="M31 40 L119 40 L128 155 L22 155 Z" fill="url(#bag-gradient)"/><path d="M31 40 L22 155 L39 143 L45 49 Z" fill="#8f653c" opacity=".5"/><path d="M119 40 L128 155 L111 143 L105 49 Z" fill="#805c38" opacity=".4"/><path d="M31 40 L119 40 L105 49 L45 49 Z" fill="#f0d5a9"/><path d="M68 112 C48 97 54 73 61 62 C78 78 82 94 77 104 C91 83 107 78 119 83 C116 104 96 119 77 121 L75 139" fill="#173c2b"/><text x="75" y="143" text-anchor="middle" font-family="Georgia" font-size="6" letter-spacing=".5" fill="#422718">PAPERPLAZO</text></svg>`; }
function premiumHeroArt() {
  return `
    <svg class="premium-scene" viewBox="0 0 620 460" role="img" aria-label="Woman walking happily with two PAPERPLAZO bags on a moving background">
      <defs>
        <linearGradient id="premiumBg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#f3efe8"/>
          <stop offset="1" stop-color="#e6ddd0"/>
        </linearGradient>
        <radialGradient id="premiumGlow" cx="50%" cy="35%" r="60%">
          <stop offset="0" stop-color="#f9f4ed" stop-opacity="1"/>
          <stop offset="1" stop-color="#f9f4ed" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="bagTone" x1="0" x2="1">
          <stop offset="0" stop-color="#d4b06d"/>
          <stop offset="0.55" stop-color="#ddbf86"/>
          <stop offset="1" stop-color="#ba8b52"/>
        </linearGradient>
      </defs>

      <g class="scene-sky">
        <rect width="620" height="460" fill="url(#premiumBg)"/>
        <circle cx="305" cy="130" r="118" fill="url(#premiumGlow)"/>
        <g opacity="0.25">
          <path d="M60 112 C120 92, 168 94, 230 118 C280 138, 328 140, 392 112 C468 80, 520 86, 573 116 L573 70 L60 70 Z" fill="#efe8df"/>
          <path d="M42 150 C125 116, 174 128, 239 155 C298 180, 344 182, 402 156 C468 128, 521 130, 575 150 L575 102 L42 102 Z" fill="#f2ebdf"/>
        </g>
      </g>

      <g class="scene-ring">
        <circle cx="312" cy="190" r="165" fill="none" stroke="#c7b8a3" stroke-width="1.5" opacity="0.7"/>
        <circle cx="312" cy="190" r="220" fill="none" stroke="#d5c8b2" stroke-width="1.2" opacity="0.8"/>
      </g>

      <g class="scene-road">
        <path d="M52 292 C125 276, 202 254, 288 256 C397 260, 480 292, 564 295 L568 332 C479 348, 408 358, 300 356 C200 354, 127 332, 52 320 Z" fill="#d3c1a1" opacity="0.7"/>
        <path d="M96 318 C173 301, 247 294, 314 296 C393 299, 466 311, 521 322" fill="none" stroke="#efe4d0" stroke-width="3" stroke-dasharray="10 12" opacity="0.9"/>
        <path d="M104 337 C188 325, 244 319, 314 321 C390 324, 454 336, 514 347" fill="none" stroke="#baa27f" stroke-width="4" opacity="0.85"/>
      </g>

      <g class="scene-figure">
        <g class="woman-wrap">
          <g class="arm-left">
            <path d="M300 170 L272 215" stroke="#3c2d2b" stroke-width="9" stroke-linecap="round" fill="none"/>
          </g>
          <g class="arm-right">
            <path d="M347 168 L395 213" stroke="#3c2d2b" stroke-width="9" stroke-linecap="round" fill="none"/>
          </g>
          <g class="leg-left">
            <path d="M297 245 L285 302" stroke="#3c2d2b" stroke-width="11" stroke-linecap="round" fill="none"/>
            <path d="M285 302 L302 321" stroke="#3c2d2b" stroke-width="10" stroke-linecap="round" fill="none"/>
          </g>
          <g class="leg-right">
            <path d="M334 246 L356 302" stroke="#3c2d2b" stroke-width="11" stroke-linecap="round" fill="none"/>
            <path d="M356 302 L340 323" stroke="#3c2d2b" stroke-width="10" stroke-linecap="round" fill="none"/>
          </g>
          <ellipse cx="320" cy="148" rx="28" ry="30" fill="#f8d7ba"/>
          <path d="M294 145 C298 115, 325 110, 348 118 C372 127, 380 153, 377 178 C365 166, 347 160, 332 160 C318 160, 305 164, 294 145 Z" fill="#2a1d1b"/>
          <path d="M294 148 C302 138, 313 134, 328 134 C353 134, 371 148, 379 170 L377 188 L299 188 Z" fill="#f5f0ea"/>
          <path d="M304 170 C313 197, 319 210, 327 222 C341 237, 360 240, 380 223 L388 256 L297 256 L278 219 L284 190 Z" fill="#f3efe9" stroke="#2b221d" stroke-width="2.5"/>
          <path d="M313 176 C325 190, 343 194, 355 214" fill="none" stroke="#2b221d" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M323 219 L381 219" stroke="#2b221d" stroke-width="2.5"/>
          <path d="M319 221 L314 294" stroke="#2b221d" stroke-width="3"/>
          <path d="M340 220 L351 292" stroke="#2b221d" stroke-width="3"/>
          <circle cx="321" cy="139" r="2.7" fill="#27211f"/>
          <circle cx="344" cy="138" r="2.6" fill="#27211f"/>
          <path d="M321 149 C330 155, 338 156, 347 149" fill="none" stroke="#af6d5a" stroke-width="2" stroke-linecap="round"/>
          <path d="M293 201 C282 224, 281 258, 300 282" fill="none" stroke="#2b221d" stroke-width="2.5"/>
          <path d="M346 166 L395 209" stroke="#2b221d" stroke-width="3" stroke-linecap="round"/>
        </g>
      </g>

      <g class="bag-group" transform="translate(0 0)">
        <g transform="translate(84 146) rotate(7)">
          <path d="M40 68 C40 30, 68 18, 86 18 C103 18, 132 29, 132 68" fill="none" stroke="#7e5732" stroke-width="8" stroke-linecap="round"/>
          <path d="M18 72 L148 72 L160 180 L8 180 Z" fill="url(#bagTone)" stroke="#8f6440" stroke-width="2"/>
          <path d="M19 72 L8 180 L26 171 L35 78 Z" fill="#8d673d" opacity="0.38"/>
          <path d="M148 72 L160 180 L144 171 L136 78 Z" fill="#8d673d" opacity="0.25"/>
          <path d="M47 96 C60 86, 79 82, 97 90 C114 97, 123 114, 122 132 C105 149, 62 150, 47 134 Z" fill="#163f2d"/>
          <path d="M68 117 C84 101, 104 100, 107 120 C95 132, 73 133, 68 117 Z" fill="#efeadf" opacity="0.7"/>
          <text x="84" y="154" text-anchor="middle" font-family="Georgia, serif" font-size="17" fill="#2f261f" letter-spacing="1">PAPERPLAZO</text>
        </g>

        <g transform="translate(344 134) rotate(-9)">
          <path d="M40 68 C40 30, 68 18, 86 18 C103 18, 132 29, 132 68" fill="none" stroke="#7e5732" stroke-width="8" stroke-linecap="round"/>
          <path d="M18 72 L148 72 L160 180 L8 180 Z" fill="url(#bagTone)" stroke="#8f6440" stroke-width="2"/>
          <path d="M19 72 L8 180 L26 171 L35 78 Z" fill="#8d673d" opacity="0.38"/>
          <path d="M148 72 L160 180 L144 171 L136 78 Z" fill="#8d673d" opacity="0.25"/>
          <path d="M47 96 C60 86, 79 82, 97 90 C114 97, 123 114, 122 132 C105 149, 62 150, 47 134 Z" fill="#163f2d"/>
          <path d="M68 117 C84 101, 104 100, 107 120 C95 132, 73 133, 68 117 Z" fill="#efeadf" opacity="0.7"/>
          <text x="84" y="154" text-anchor="middle" font-family="Georgia, serif" font-size="17" fill="#2f261f" letter-spacing="1">PAPERPLAZO</text>
        </g>
      </g>
    </svg>
  `;
}
function productVisual(product, className = '') { const image = product.images && product.images[0]; return image ? `<img class="${className}" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt_text || product.name)}">` : bagArt(); }
function bindProductImageFallback(root = document) {
  root.querySelectorAll('.product-card img, .detail-visual img').forEach(image => image.onerror = () => image.replaceWith(document.createRange().createContextualFragment(bagArt())));
}
function productCard(product) {
  const label = product.is_best_seller ? 'BEST SELLER' : product.is_featured ? 'FEATURED' : product.customization_available ? 'CUSTOMISE' : product.in_stock ? 'PAPERPLAZO' : 'OUT OF STOCK';
  const price = product.discount_price ? `<span class="old-price">${money(product.price)}</span>${money(product.selling_price)}` : money(product.selling_price);
  return `<article class="product-card"><a href="#product/${encodeURIComponent(product.slug)}" class="product-image"><span class="product-tag">${label}</span>${productVisual(product)}</a><div class="product-info"><div class="product-title-row"><h3><a href="#product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h3><span class="price">${price}</span></div><p>${escapeHtml(product.description)}</p><button class="add" data-add="${product.id}" ${product.in_stock ? '' : 'disabled'}>${product.in_stock ? 'ADD TO BAG +' : 'OUT OF STOCK'}</button></div></article>`;
}
function bindAddButtons(root = document) {
  bindProductImageFallback(root);
  root.querySelectorAll('[data-add]').forEach(button => button.onclick = event => {
    const card = button.closest('.product-card');
    const thumb = card?.querySelector('img')?.src || '';
    triggerCartFly(button, thumb);
    event.preventDefault();
    addToCart(Number(button.dataset.add), 1);
  });
}
function mapFirestoreProduct(product) {
  const id = Number(product.id ?? product.sku);
  const stock = Number(product.stock || 0);
  return {
    ...product,
    id,
    product_code: product.product_code || product.sku || '',
    slug: product.slug || String(product.sku || id),
    selling_price: Number(product.selling_price ?? product.discount_price ?? product.price ?? 0),
    in_stock: stock > 0,
    status: product.isActive ? 'active' : 'inactive',
    category: product.categoryId ? {id: product.categoryId, name: product.category || '', slug: product.categorySlug || ''} : null,
    images: product.imageUrl ? [{url: product.imageUrl, alt_text: product.name}] : (product.images || [])
  };
}
function renderLiveProductSections() {
  const products = state.firestoreProducts;
  const featuredContainer = $('#featured-products');
  if (featuredContainer) {
    const featured = products.filter(product => product.is_featured);
    const selected = (featured.length ? featured : products).slice(0, 3);
    state.products = selected;
    featuredContainer.innerHTML = selected.length ? selected.map(productCard).join('') : `<div class="empty-state full"><h2>The collection is being prepared.</h2><p>Our catalog will appear here as soon as products are published.</p></div>`;
    bindAddButtons(featuredContainer);
  }

  const shopContainer = $('#shop-products');
  if (shopContainer) {
    const search = ($('#shop-search [name="q"]')?.value || '').trim().toLowerCase();
    const category = $('#category-filters [data-category].active')?.dataset.category || '';
    const sort = $('#shop-search [name="sort"]')?.value || 'newest';
    const visible = products.filter(product => {
      const matchesSearch = !search || `${product.name} ${product.product_code} ${product.description}`.toLowerCase().includes(search);
      const matchesCategory = !category || product.category?.slug === category;
      return matchesSearch && matchesCategory;
    });
    visible.sort((first, second) => {
      if (sort === 'price_asc') return first.selling_price - second.selling_price;
      if (sort === 'price_desc') return second.selling_price - first.selling_price;
      if (sort === 'name') return first.name.localeCompare(second.name);
      return (second.createdAt?.toMillis?.() || 0) - (first.createdAt?.toMillis?.() || 0);
    });
    state.products = visible;
    shopContainer.innerHTML = visible.length ? visible.map(productCard).join('') : `<div class="empty-state full"><h2>No products found.</h2><p>Try a different search or browse the full collection.</p></div>`;
    bindAddButtons(shopContainer);
  }
}
function connectLiveProducts() {
  state.productListener?.();
  state.productListener = null;
  const routeName = route().split('?')[0].split('/')[0];
  if (!['home', 'shop'].includes(routeName) || !window.PAPERPLAZO_FIREBASE?.configured) return;
  state.productListener = productsApi.listenToActiveProducts(snapshot => {
    state.firestoreProducts = snapshot.map(mapFirestoreProduct);
    renderLiveProductSections();
  }, error => {
    const message = `<p class="error">${escapeHtml(error.message || 'The product catalog could not be loaded.')}</p>`;
    const featured = $('#featured-products');
    const shop = $('#shop-products');
    if (featured) featured.innerHTML = message;
    if (shop) shop.innerHTML = message;
  });
}
async function refreshCart() {
  if (state.token) state.cart = await request('/cart');
  else {
    const ids = state.guestCart.map(item => item.product_id).join(',');
    if (!ids) state.cart = {items: [], subtotal: 0, count: 0};
    else {
      const data = await request('/products?per_page=100');
      const lookup = new Map(data.products.map(product => [product.id, product]));
      const items = state.guestCart.filter(item => lookup.has(item.product_id)).map(item => ({id: item.product_id, product: lookup.get(item.product_id), quantity: item.quantity, line_total: lookup.get(item.product_id).selling_price * item.quantity}));
      state.guestCart = items.map(item => ({product_id:item.product.id, quantity:item.quantity})); saveGuestCart();
      state.cart = {items, subtotal: items.reduce((sum,item) => sum + item.line_total, 0), count: items.reduce((sum,item) => sum + item.quantity, 0)};
    }
  }
  $('#cart-count').textContent = state.cart.count;
  return state.cart;
}
async function mergeGuestCart() {
  if (!state.token || !state.guestCart.length) return;
  const lines = [...state.guestCart]; state.guestCart = []; saveGuestCart();
  for (const line of lines) { try { await request('/cart/items', {method:'POST', body:JSON.stringify(line)}); } catch (error) { toast(error.message, true); } }
}
async function addToCart(productId, quantity) {
  try {
    if (state.token) await request('/cart/items', {method:'POST', body:JSON.stringify({product_id:productId, quantity})});
    else {
      const product = state.products.find(item => item.id === productId) || (await request(`/products?per_page=100`)).products.find(item => item.id === productId);
      const line = state.guestCart.find(item => item.product_id === productId); const next = (line?.quantity || 0) + quantity;
      if (!product || !product.in_stock || next > product.stock) throw new Error(`Only ${product?.stock || 0} unit(s) are available.`);
      if (line) line.quantity = next; else state.guestCart.push({product_id: productId, quantity}); saveGuestCart();
    }
    await refreshCart(); go('cart');
  } catch (error) { toast(error.message, true); }
}
async function setCartQuantity(item, quantity) {
  try {
    if (quantity < 1) return removeCartItem(item);
    if (state.token) await request(`/cart/items/${item.id}`, {method:'PATCH', body:JSON.stringify({quantity})});
    else { const line = state.guestCart.find(line => line.product_id === item.product.id); if (line) line.quantity = quantity; saveGuestCart(); }
    await refreshCart(); render();
  } catch (error) { toast(error.message, true); }
}
async function removeCartItem(item) {
  try {
    if (state.token) await request(`/cart/items/${item.id}`, {method:'DELETE'});
    else { state.guestCart = state.guestCart.filter(line => line.product_id !== item.product.id); saveGuestCart(); }
    await refreshCart(); render();
  } catch (error) { toast(error.message, true); }
}
function statusClass(status) { return /pending|received|reviewing/i.test(status) ? 'pending' : /cancel|reject/i.test(status) ? 'cancelled' : ''; }
async function downloadInvoice(orderNumber) {
  try {
    const response = await fetch(`${API}/orders/${encodeURIComponent(orderNumber)}/invoice`, {headers:{Authorization:`Bearer ${state.token}`}});
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Invoice could not be downloaded.'); }
    const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${orderNumber}-invoice.html`; anchor.click(); URL.revokeObjectURL(url);
  } catch (error) { toast(error.message, true); }
}
async function renderHome() {
  app.innerHTML = `<section class="hero"><div class="hero-copy"><div class="eyebrow">✳ THE PAPERPLAZO EDIT · VOL. 01</div><h1>Carry your brand with <i>intention.</i></h1><p class="lead">Good packaging is part of the experience. Discover thoughtfully styled paper bags for retail, gifting and the everyday moments when presentation matters.</p><div class="actions"><a class="primary" href="#shop">EXPLORE THE COLLECTION ↗</a><a class="secondary" href="#about">OUR APPROACH</a></div><div class="hero-meta"><div><b>01</b><span>Thoughtful design</span></div><div><b>∞</b><span>Ways to make it yours</span></div><div><b>100%</b><span>Your choice</span></div></div></div><div class="hero-visual"><span class="hero-leaf leaf-one"></span><span class="hero-leaf leaf-two"></span><span class="hero-leaf leaf-three"></span><span class="hero-leaf leaf-four"></span><span class="floating-label label-one">A better kind of carry.</span><img class="hero-figure" src="/customer/assets/shopping-walk-cycle.gif" alt="Woman walking with PAPERPLAZO shopping bags"><span class="floating-label label-two">MATERIAL · FORM · FINISH</span></div></section><div class="trustbar"><div class="trustitem"><b>✳</b>Paper-first thinking</div><div class="trustitem"><b>◇</b>Clean, considered forms</div><div class="trustitem"><b>↗</b>Made for your brand</div><div class="trustitem"><b>○</b>Small business spirit</div></div><section class="section"><div class="section-head"><div><div class="eyebrow">THE CURRENT EDIT</div><h2 class="section-title">Meet the <i>collection.</i></h2></div><p class="section-desc">Product availability, dimensions, and prices are shown live from our catalogue.</p></div><div id="featured-products" class="product-grid"><p class="loading">Loading the collection…</p></div><p class="note">Final bespoke pricing depends on dimensions, paper GSM, handles, printing, quantity and finishing.</p></section><section class="manifesto"><div><div class="eyebrow">OUR POINT OF VIEW</div><h2>It’s not just a bag.<br>It’s the <i>hand-over.</i></h2><p>The few seconds between a purchase and a customer walking away can still feel special. We’re building PAPERPLAZO around practical packaging, thoughtful presentation and the little details people remember.</p></div><div class="manifesto-points"><div class="point"><div class="num">01</div><h3>Form with purpose</h3><p>Useful shapes, considered proportions and a clean silhouette.</p></div><div class="point"><div class="num">02</div><h3>Quiet confidence</h3><p>Natural tones and an understated look that lets your product shine.</p></div><div class="point"><div class="num">03</div><h3>Your brand, visible</h3><p>A simple canvas for your logo, message and customer experience.</p></div><div class="point"><div class="num">04</div><h3>Start small, grow well</h3><p>Build a packaging style that can evolve alongside your business.</p></div></div></section><section class="section split"><div class="editorial-art"><img src="/customer/assets/bag-in-motion.gif" alt="PAPERPLAZO bag in motion" style="width:auto;height:340px;max-width:100%;object-fit:contain;display:block;margin:0 auto;filter:drop-shadow(0 18px 14px rgba(48,33,22,.18));"></div><div><div class="eyebrow">THE DETAILS MATTER</div><h2 class="copy-title">Simple in appearance.<br><i>Thoughtful by design.</i></h2><p class="copy-text">A bag has a job to do. It should carry comfortably, present neatly and give a business a consistent way to send its products out into the world.</p><div class="feature"><div class="feature-icon">✳</div><div><strong>A clean finish</strong><p>Neat folds and a considered look are the foundation of a good bag.</p></div></div><div class="feature"><div class="feature-icon">◇</div><div><strong>A fit for the purpose</strong><p>Size, paper weight and handle choice should suit what goes inside.</p></div></div><div class="feature"><div class="feature-icon">↗</div><div><strong>Room for your identity</strong><p>Keep it minimal or build toward branded printing and custom details.</p></div></div></div></section><section class="section tint"><div class="section-head"><div><div class="eyebrow">FROM IDEA TO BAG</div><h2 class="section-title">Made clearer, <i>step by step.</i></h2></div><p class="section-desc">A straightforward way to tell us what you need.</p></div><div class="steps"><article class="step"><div class="num">01</div><h3>Choose a direction</h3><p>Pick a catalog style or share the kind of bag your shop, products or gifts need.</p></article><article class="step"><div class="num">02</div><h3>Share the details</h3><p>Tell us dimensions, quantity, handle preference and whether you want branding.</p></article><article class="step"><div class="num">03</div><h3>Receive a quote</h3><p>Review a production estimate and accept it only when it is right for you.</p></article></div></section>${faqMarkup()}<div class="cta-band"><div><div class="eyebrow">YOUR NEXT GREAT HANDOVER STARTS HERE</div><h2>Packaging with a little more <i style="color:var(--sage)">thought.</i></h2><p>Tell us what you are making and we’ll start with a considered quote.</p></div><a class="primary" href="#custom">REQUEST A QUOTE ↗</a></div>`;
  try {
    if (window.PAPERPLAZO_FIREBASE?.configured) return;
    const data = await request('/products?featured=true&per_page=3');
    const featured = data.products.length ? data.products : (await request('/products?per_page=3')).products;
    state.products = featured;
    $('#featured-products').innerHTML = featured.length ? featured.map(productCard).join('') : `<div class="empty-state full"><h2>The collection is being prepared.</h2><p>Our catalog will appear here as soon as products are published.</p></div>`;
    bindAddButtons();
  } catch (error) { $('#featured-products').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
function faqMarkup() { return `<section class="section"><div class="section-head"><div><div class="eyebrow">GOOD TO KNOW</div><h2 class="section-title">Questions, <i>answered.</i></h2></div><p class="section-desc">A few useful things to know before requesting a custom order.</p></div><div class="faq"><details><summary>Are catalog prices final?</summary><p>Catalog prices apply to the listed product specification. Custom sizes, handles, printing and volume may need a separate quotation.</p></details><details><summary>Can I ask for a custom size?</summary><p>Yes. Submit your dimensions and requirements in the custom-packaging form, and a PAPERPLAZO administrator can send a quotation.</p></details><details><summary>Can bags include my logo?</summary><p>Use the custom-order form to upload a logo and describe printing needs. Print method, setup costs and production feasibility are confirmed in the quotation.</p></details><details><summary>How is payment handled?</summary><p>Cash on delivery may be available depending on current store settings. Online payments remain unavailable until a verified provider integration is configured.</p></details></div></section>`; }
async function renderShop() {
  app.innerHTML = `<section class="page"><div class="eyebrow">THE PAPERPLAZO COLLECTION</div><h1 class="page-title">Find the right <i>carry.</i></h1><p class="page-intro">Browse live availability across our published packaging range.</p><form id="shop-search" class="shop-tools"><input name="q" placeholder="Search by name or product ID"><select name="sort"><option value="newest">Newest first</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name</option></select><button class="primary">SEARCH</button></form><div id="category-filters" class="filters"></div><div id="shop-products" class="product-grid" style="margin-top:28px"><p class="loading">Loading products…</p></div></section>`;
  let currentCategory = ''; const box = $('#shop-products');
  const load = async () => { if (window.PAPERPLAZO_FIREBASE?.configured) { renderLiveProductSections(); return; } box.innerHTML = '<p class="loading">Loading products…</p>'; const form = new FormData($('#shop-search')); const params = new URLSearchParams({q:form.get('q'),sort:form.get('sort'),per_page:'100'}); if (currentCategory) params.set('category',currentCategory); try { const data = await request(`/products?${params}`); state.products = data.products; box.innerHTML = data.products.length ? data.products.map(productCard).join('') : `<div class="empty-state full"><h2>No products found.</h2><p>Try a different search or browse the full collection.</p></div>`; bindAddButtons(box); } catch (error) { box.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; } };
  $('#shop-search').onsubmit = event => { event.preventDefault(); load(); };
  try { const data = await request('/categories'); $('#category-filters').innerHTML = `<button class="filter-pill active" data-category="">All products</button>${data.categories.map(category => `<button class="filter-pill" data-category="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</button>`).join('')}`; $('#category-filters').onclick = event => { const button = event.target.closest('[data-category]'); if (!button) return; currentCategory = button.dataset.category; $('#category-filters').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); load(); }; } catch (error) { toast(error.message, true); }
  load();
}
async function renderProduct(slug) {
  app.innerHTML = '<section class="page"><p class="loading">Loading product…</p></section>';
  try { const {product, related} = await request(`/products/${encodeURIComponent(slug)}`); state.products = [product, ...related]; let quantity = 1;
    app.innerHTML = `<section class="page"><a class="eyebrow" href="#shop">← BACK TO SHOP</a><div class="detail-layout" style="margin-top:20px"><div class="detail-visual">${productVisual(product)}</div><div class="detail-info"><div class="eyebrow">${escapeHtml(product.product_code)}</div><h1>${escapeHtml(product.name)}</h1><div class="detail-price">${product.discount_price ? `<span class="old-price">${money(product.price)}</span>` : ''}${money(product.selling_price)}</div><p class="copy-text">${escapeHtml(product.description)}</p><div class="specs"><div class="spec"><span>Paper GSM</span><b>${escapeHtml(product.paper_gsm || 'Confirmed with product')}</b></div><div class="spec"><span>Dimensions</span><b>${escapeHtml(product.dimensions || 'See product details')}</b></div><div class="spec"><span>Handle</span><b>${escapeHtml(product.handle_type || 'See product details')}</b></div><div class="spec"><span>Availability</span><b>${product.in_stock ? `${product.stock} available` : 'Out of stock'}</b></div></div><div class="quantity"><span>Quantity</span><button id="qty-minus">−</button><b id="quantity-value">1</b><button id="qty-plus">+</button></div><button id="detail-add" class="primary" ${product.in_stock ? '' : 'disabled'}>${product.in_stock ? 'ADD TO BAG +' : 'OUT OF STOCK'}</button>${product.customization_available ? ` <a class="secondary" href="#custom">CUSTOMISE THIS STYLE</a>` : ''}</div></div>${related.length ? `<section style="margin-top:75px"><div class="eyebrow">MORE TO CONSIDER</div><h2 class="section-title">Related <i>products.</i></h2><div class="product-grid" style="margin-top:28px">${related.map(productCard).join('')}</div></section>` : ''}</section>`;
    $('#qty-minus').onclick = () => { quantity = Math.max(1, quantity - 1); $('#quantity-value').textContent = quantity; };
    $('#qty-plus').onclick = () => { quantity = Math.min(product.stock, quantity + 1); $('#quantity-value').textContent = quantity; };
    $('#detail-add').onclick = () => {
      const thumb = document.querySelector('.detail-visual img')?.src || '';
      triggerCartFly($('#detail-add'), thumb);
      addToCart(product.id, quantity);
    };
    bindAddButtons();
  } catch (error) { app.innerHTML = `<section class="page"><div class="empty-state"><h2>Product unavailable</h2><p>${escapeHtml(error.message)}</p><a class="primary" href="#shop">VIEW COLLECTION</a></div></section>`; }
}
async function renderCart() {
  app.innerHTML = '<section class="page"><p class="loading">Loading your bag…</p></section>';
  try { const cart = await refreshCart(); if (!cart.items.length) { app.innerHTML = `<section class="page"><div class="empty-state"><h2>Your bag is waiting.</h2><p>You haven’t added any products yet.</p><a class="primary" href="#shop">EXPLORE THE COLLECTION</a></div></section>`; return; }
    app.innerHTML = `<section class="page"><div class="eyebrow">YOUR SELECTION · ${cart.count} ITEM(S)</div><h1 class="page-title">Your shopping <i>bag.</i></h1><p class="page-intro">Review quantities before continuing to checkout.</p><div class="cart-layout"><div>${cart.items.map(item => `<article class="cart-line"><div class="cart-thumb">${productVisual(item.product)}</div><div><h3>${escapeHtml(item.product.name)}</h3><p class="note">${escapeHtml(item.product.product_code)} · ${money(item.product.selling_price)} each</p><div class="quantity"><button data-minus="${item.id}">−</button><b>${item.quantity}</b><button data-plus="${item.id}">+</button><button class="remove" data-remove="${item.id}">Remove</button></div></div><b class="line-price">${money(item.line_total)}</b></article>`).join('')}<a class="secondary" style="margin-top:22px" href="#shop">← CONTINUE SHOPPING</a></div><aside class="cart-summary"><div class="summary-row"><span>Subtotal</span><b>${money(cart.subtotal)}</b></div><div class="summary-row"><span>Shipping</span><span>Calculated at checkout</span></div><div class="summary-row total"><span>Estimated total</span><b>${money(cart.subtotal)}</b></div><button class="primary" id="go-checkout">PROCEED TO CHECKOUT ↗</button><p class="note">Taxes, shipping, and payment availability are confirmed at checkout.</p></aside></div></section>`;
    app.querySelectorAll('[data-minus]').forEach(button => button.onclick = () => setCartQuantity(cart.items.find(item => String(item.id) === button.dataset.minus), cart.items.find(item => String(item.id) === button.dataset.minus).quantity - 1));
    app.querySelectorAll('[data-plus]').forEach(button => button.onclick = () => setCartQuantity(cart.items.find(item => String(item.id) === button.dataset.plus), cart.items.find(item => String(item.id) === button.dataset.plus).quantity + 1));
    app.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => removeCartItem(cart.items.find(item => String(item.id) === button.dataset.remove)));
    $('#go-checkout').onclick = () => state.token ? go('checkout') : go('login?next=checkout');
  } catch (error) { app.innerHTML = `<section class="page"><p class="error">${escapeHtml(error.message)}</p></section>`; }
}
async function renderCheckout() {
  if (!state.token) { go('login?next=checkout'); return; }
  try { const [cart, me] = await Promise.all([refreshCart(), request('/auth/me')]); if (!cart.items.length) { go('cart'); return; }
    const defaults = me.addresses.find(address => address.is_default) || me.addresses[0];
    app.innerHTML = `<section class="page"><div class="eyebrow">SECURE CHECKOUT</div><h1 class="page-title">Almost <i>there.</i></h1><div class="cart-layout"><form id="checkout-form" class="form-card"><h2 style="font:normal 28px Georgia,serif;margin-top:0">Delivery details</h2><div class="form-grid"><div class="field"><label>RECIPIENT</label><input name="recipient" required value="${escapeHtml(defaults?.recipient || me.user.full_name)}"></div><div class="field"><label>PHONE</label><input name="phone" required value="${escapeHtml(defaults?.phone || me.user.phone || '')}"></div><div class="field full"><label>ADDRESS LINE 1</label><input name="line1" required value="${escapeHtml(defaults?.line1 || '')}"></div><div class="field full"><label>ADDRESS LINE 2</label><input name="line2" value="${escapeHtml(defaults?.line2 || '')}"></div><div class="field"><label>CITY</label><input name="city" required value="${escapeHtml(defaults?.city || '')}"></div><div class="field"><label>STATE</label><input name="state" required value="${escapeHtml(defaults?.state || '')}"></div><div class="field"><label>POSTAL CODE</label><input name="postal_code" required value="${escapeHtml(defaults?.postal_code || '')}"></div><div class="field"><label>PAYMENT METHOD</label><select name="payment_method"><option value="cod">Cash on delivery (if available)</option></select></div></div><button class="primary" style="width:100%">PLACE ORDER</button><p class="note">Online payment is intentionally disabled until a verified payment provider is configured.</p></form><aside class="cart-summary"><h2 style="font:normal 25px Georgia,serif;margin-top:0">Order summary</h2>${cart.items.map(item => `<div class="summary-row"><span>${escapeHtml(item.product.name)} × ${item.quantity}</span><b>${money(item.line_total)}</b></div>`).join('')}<div class="summary-row total"><span>Subtotal</span><b>${money(cart.subtotal)}</b></div><p class="note">Shipping follows the store’s current server-side rule and is confirmed on your order.</p></aside></div></section>`;
    $('#checkout-form').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const shipping_address = Object.fromEntries(form.entries()); delete shipping_address.payment_method; try { const result = await request('/orders', {method:'POST', body:JSON.stringify({payment_method:form.get('payment_method'), shipping_address})}); toast(result.message); await refreshCart(); go(`account?tab=orders`); } catch (error) { toast(error.message, true); } };
  } catch (error) { app.innerHTML = `<section class="page"><p class="error">${escapeHtml(error.message)}</p></section>`; }
}
function authForm(mode) {
  const isRegister = mode === 'register';
  app.innerHTML = `<section class="page"><div class="auth-wrap"><div class="eyebrow">${isRegister ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK'}</div><h1 class="page-title">${isRegister ? 'Make it <i>official.</i>' : 'Sign in to <i>continue.</i>'}</h1><form id="auth-form" class="form-card">${isRegister ? `<div class="field"><label>FULL NAME</label><input name="full_name" required maxlength="120" autocomplete="name"></div><div class="field"><label>PHONE</label><input name="phone" maxlength="30" autocomplete="tel"></div>` : ''}<div class="field"><label>EMAIL</label><input name="email" type="email" required maxlength="255" autocomplete="email"></div><div class="field"><label>PASSWORD</label><input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${isRegister ? 'new-password' : 'current-password'}"></div><button class="primary" style="width:100%">${isRegister ? 'CREATE ACCOUNT' : 'SIGN IN'}</button></form>${isRegister ? `<p class="auth-switch">Already have an account? <a href="#login">Sign in</a></p>` : `<p class="auth-switch">New to PAPERPLAZO? <a href="#register">Create an account</a><br><a id="forgot-link" href="#contact">Need help with your account?</a></p>`}</div></section>`;
  $('#auth-form').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { const result = await request(`/auth/${isRegister ? 'register' : 'login'}`, {method:'POST', body:JSON.stringify(data)}); persistUser(result.token, result.user); await mergeGuestCart(); await refreshCart(); toast(isRegister ? 'Your account is ready.' : 'Welcome back.'); const next = new URLSearchParams(route().split('?')[1] || '').get('next'); go(next || 'account'); } catch (error) { toast(error.message, true); } };
}
async function renderCustom() {
  if (!state.token) { app.innerHTML = `<section class="page"><div class="empty-state"><h2>Let’s begin with your account.</h2><p>Sign in or create an account to submit, track, and respond to your custom packaging quotation.</p><a class="primary" href="#login?next=custom">SIGN IN TO REQUEST A QUOTE</a></div></section>`; return; }
  app.innerHTML = `<section class="page"><div class="eyebrow">CUSTOM PACKAGING</div><h1 class="page-title">Let’s make it <i>yours.</i></h1><p class="page-intro">Share the dimensions, materials and printing requirements. A PAPERPLAZO administrator will review the request and send you a quotation in your account.</p><form id="quote-form" class="form-card"><div class="form-grid"><div class="field"><label>BAG WIDTH (MM)</label><input type="number" min="1" step="0.01" name="width" required></div><div class="field"><label>BAG HEIGHT (MM)</label><input type="number" min="1" step="0.01" name="height" required></div><div class="field"><label>BAG DEPTH (MM)</label><input type="number" min="1" step="0.01" name="depth" required></div><div class="field"><label>REQUIRED QUANTITY</label><input type="number" min="1" step="1" name="quantity" required></div><div class="field"><label>PAPER GSM</label><input name="paper_gsm" maxlength="50" placeholder="e.g. 120 GSM" required></div><div class="field"><label>PAPER COLOUR</label><input name="paper_colour" maxlength="100" placeholder="e.g. Natural kraft" required></div><div class="field"><label>HANDLE TYPE</label><select name="handle_type" required><option value="">Select handle type</option><option>Twisted paper handle</option><option>Flat paper handle</option><option>Cotton rope handle</option><option>Ribbon handle</option><option>Die-cut handle</option><option>No handle</option></select></div><div class="field"><label>LOGO FILE (OPTIONAL)</label><input type="file" name="logo" accept=".jpg,.jpeg,.png,.webp,.pdf"></div><div class="field full"><label>PRINTING REQUIREMENTS</label><textarea name="printing_requirements" maxlength="4000" placeholder="Logo positions, colours, print method preferences, inside/outside print…"></textarea></div><div class="field full"><label>SPECIAL INSTRUCTIONS</label><textarea name="special_instructions" maxlength="4000" placeholder="Tell us anything else that will help us quote accurately."></textarea></div></div><button class="primary" style="width:100%">SUBMIT QUOTATION REQUEST ↗</button><p class="note">Allowed uploads: JPG, PNG, WEBP, or PDF up to 8 MB. Your request will be stored securely in your account.</p></form></section>`;
  $('#quote-form').onsubmit = async event => { event.preventDefault(); try { const result = await request('/custom-orders', {method:'POST', body:new FormData(event.currentTarget)}); toast(`Quotation request ${result.quote.reference} sent.`); go('account?tab=quotes'); } catch (error) { toast(error.message, true); } };
}
async function renderAccount() {
  if (!state.token) { go('login?next=account'); return; }
  app.innerHTML = '<section class="page"><p class="loading">Loading your account…</p></section>';
  try {
    const me = await request('/auth/me'); state.user = me.user; localStorage.setItem('paperplazo_customer_user', JSON.stringify(me.user));
    const chosen = new URLSearchParams(route().split('?')[1] || '').get('tab') || 'profile';
    app.innerHTML = `<section class="page"><div class="eyebrow">YOUR PAPERPLAZO</div><h1 class="page-title">Your <i>account.</i></h1><div class="account-grid"><aside class="account-menu"><button data-tab="profile">Profile</button><button data-tab="addresses">Saved addresses</button><button data-tab="orders">Order history</button><button data-tab="quotes">Custom quotations</button><button id="sign-out">Sign out</button></aside><div id="account-panel" class="account-panel"></div></div></section>`;
    const renderPanel = async tab => {
      app.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab)); const panel = $('#account-panel');
      if (tab === 'profile') { panel.innerHTML = `<h2>Your profile</h2><form id="profile-form" class="form-card"><div class="field"><label>FULL NAME</label><input name="full_name" required maxlength="120" value="${escapeHtml(me.user.full_name)}"></div><div class="field"><label>EMAIL</label><input disabled value="${escapeHtml(me.user.email)}"></div><div class="field"><label>PHONE</label><input name="phone" maxlength="30" value="${escapeHtml(me.user.phone || '')}"></div><button class="primary">SAVE PROFILE</button></form>`; $('#profile-form').onsubmit = async event => { event.preventDefault(); try { const result = await request('/auth/me', {method:'PATCH', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); state.user = result.user; localStorage.setItem('paperplazo_customer_user', JSON.stringify(result.user)); toast('Profile saved.'); } catch (error) { toast(error.message, true); } }; }
      if (tab === 'addresses') { panel.innerHTML = `<h2>Saved addresses</h2><div id="addresses-list">${me.addresses.length ? me.addresses.map(address => `<div class="quote-card"><div class="card-top"><b>${escapeHtml(address.label)}</b>${address.is_default ? '<span class="status">DEFAULT</span>' : ''}</div><p class="note">${escapeHtml(address.recipient)} · ${escapeHtml(address.phone)}<br>${escapeHtml(address.line1)}${address.line2 ? `, ${escapeHtml(address.line2)}` : ''}<br>${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postal_code)}</p><button class="remove" data-address-delete="${address.id}">Remove</button></div>`).join('') : '<p class="note">No saved addresses yet.</p>'}</div><h3 style="font:normal 22px Georgia,serif;margin-top:30px">Add an address</h3><form id="address-form" class="form-card"><div class="form-grid"><div class="field"><label>LABEL</label><input name="label" value="Home" maxlength="50"></div><div class="field"><label>RECIPIENT</label><input name="recipient" required></div><div class="field"><label>PHONE</label><input name="phone" required></div><div class="field full"><label>ADDRESS LINE 1</label><input name="line1" required></div><div class="field full"><label>ADDRESS LINE 2</label><input name="line2"></div><div class="field"><label>CITY</label><input name="city" required></div><div class="field"><label>STATE</label><input name="state" required></div><div class="field"><label>POSTAL CODE</label><input name="postal_code" required></div></div><label class="note"><input type="checkbox" name="is_default"> Set as default</label><br><br><button class="primary">SAVE ADDRESS</button></form>`; app.querySelectorAll('[data-address-delete]').forEach(button => button.onclick = async () => { try { await request(`/auth/addresses/${button.dataset.addressDelete}`, {method:'DELETE'}); toast('Address removed.'); renderAccount(); } catch (error) { toast(error.message, true); } }); $('#address-form').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); data.is_default = Boolean(event.currentTarget.is_default.checked); try { await request('/auth/addresses', {method:'POST', body:JSON.stringify(data)}); toast('Address saved.'); renderAccount(); } catch (error) { toast(error.message, true); } }; }
      if (tab === 'orders') { panel.innerHTML = '<h2>Your order history</h2><p class="loading">Loading orders…</p>'; try { const result = await request('/orders'); panel.innerHTML = `<h2>Your order history</h2>${result.orders.length ? result.orders.map(order => `<article class="order-card"><div class="card-top"><b>${escapeHtml(order.order_number)}</b><span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></div><p class="note">${dateText(order.created_at)} · ${order.items.map(item => `${escapeHtml(item.product_name)} × ${item.quantity}`).join(', ')}</p><div class="card-top"><strong>${money(order.total)}</strong><span><button class="remove" data-invoice="${escapeHtml(order.order_number)}">Invoice</button><button class="secondary" style="padding:7px 9px;margin-left:8px" data-reorder="${escapeHtml(order.order_number)}">REORDER</button></span></div></article>`).join('') : `<div class="empty-state"><h2>No orders yet.</h2><a class="primary" href="#shop">SHOP COLLECTION</a></div>`}`; panel.querySelectorAll('[data-invoice]').forEach(button => button.onclick = () => downloadInvoice(button.dataset.invoice)); panel.querySelectorAll('[data-reorder]').forEach(button => button.onclick = async () => { try { await request(`/orders/${button.dataset.reorder}/reorder`, {method:'POST'}); await refreshCart(); toast('Items added to your bag.'); go('cart'); } catch (error) { toast(error.message, true); } }); } catch (error) { panel.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; } }
      if (tab === 'quotes') { panel.innerHTML = '<h2>Your custom quotations</h2><p class="loading">Loading quotations…</p>'; try { const result = await request('/custom-orders'); panel.innerHTML = `<h2>Your custom quotations</h2>${result.quotes.length ? result.quotes.map(quote => `<article class="quote-card"><div class="card-top"><b>${escapeHtml(quote.reference)}</b><span class="status ${statusClass(quote.status)}">${escapeHtml(quote.status)}</span></div><p class="note">${quote.width} × ${quote.height} × ${quote.depth} mm · ${quote.quantity} units<br>${escapeHtml(quote.paper_gsm)}, ${escapeHtml(quote.paper_colour)}, ${escapeHtml(quote.handle_type)}</p>${quote.status === 'Quoted' ? `<p><b>${money(quote.total_price)}</b> · ${quote.production_days} production day(s)</p>${quote.admin_note ? `<p class="note">${escapeHtml(quote.admin_note)}</p>` : ''}<button class="primary" data-quote-decision="accept" data-quote-id="${quote.id}">ACCEPT QUOTE</button> <button class="secondary" data-quote-decision="reject" data-quote-id="${quote.id}">REJECT</button>` : ''}${quote.quotation_url ? ` <a class="secondary" href="${escapeHtml(quote.quotation_url)}" target="_blank">VIEW DOCUMENT</a>` : ''}</article>`).join('') : `<div class="empty-state"><h2>No quotations yet.</h2><a class="primary" href="#custom">REQUEST A QUOTE</a></div>`}`; panel.querySelectorAll('[data-quote-decision]').forEach(button => button.onclick = async () => { try { await request(`/custom-orders/${button.dataset.quoteId}/decision`, {method:'POST',body:JSON.stringify({decision:button.dataset.quoteDecision})}); toast('Your quotation response was sent.'); renderPanel('quotes'); } catch (error) { toast(error.message, true); } }); } catch (error) { panel.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; } }
    };
    app.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { go(`account?tab=${button.dataset.tab}`); renderPanel(button.dataset.tab); }); $('#sign-out').onclick = () => logout(); renderPanel(chosen);
  } catch (error) { app.innerHTML = `<section class="page"><p class="error">${escapeHtml(error.message)}</p></section>`; }
}
function renderAbout() { app.innerHTML = `<section class="page"><div class="eyebrow">OUR APPROACH</div><h1 class="page-title">Packaging, <i>considered.</i></h1><div class="split"><div class="editorial-art">${bagArt()}</div><div><p class="copy-text">PAPERPLAZO is built around a simple belief: packaging is part of the product experience. Shape, material, handle and finish should make sense together—and feel right in the hand.</p><h2 class="copy-title">A practical canvas for your <i>identity.</i></h2><div class="feature"><div class="feature-icon">01</div><div><strong>Thoughtful proportions</strong><p>We start with what needs to go inside, then work outward.</p></div></div><div class="feature"><div class="feature-icon">02</div><div><strong>Material with purpose</strong><p>Paper weight and finish are selected for the right balance of presence and utility.</p></div></div><div class="feature"><div class="feature-icon">03</div><div><strong>Built to grow with you</strong><p>Custom details let your presentation evolve alongside your business.</p></div></div><a class="primary" style="margin-top:25px" href="#custom">START A CUSTOM REQUEST</a></div></div></section>${faqMarkup()}`; }
function renderTrack() { app.innerHTML = `<section class="page"><div class="eyebrow">ORDER TRACKING</div><h1 class="page-title">Follow your <i>handover.</i></h1><p class="page-intro">Order tracking is kept private in your PAPERPLAZO account, where you can also see full order details and reorder available products.</p>${state.token ? `<a class="primary" href="#account?tab=orders">VIEW MY ORDERS</a>` : `<a class="primary" href="#login?next=account">SIGN IN TO TRACK AN ORDER</a>`}</section>`; }
function renderContact() { app.innerHTML = `<section class="page"><div class="eyebrow">LET’S TALK PACKAGING</div><h1 class="page-title">Start a <i>conversation.</i></h1><div class="split"><div><p class="copy-text">For general questions, use this form. For a bag quotation, use the complete custom-packaging request so our team has every detail needed to quote accurately.</p><a class="secondary" href="#custom">REQUEST A CUSTOM QUOTE</a></div><form id="contact-form" class="form-card"><div class="field"><label>YOUR NAME</label><input name="name" maxlength="120" required></div><div class="field"><label>EMAIL</label><input name="email" type="email" maxlength="255" required></div><div class="field"><label>SUBJECT</label><input name="subject" maxlength="180" required></div><div class="field"><label>MESSAGE</label><textarea name="message" maxlength="4000" required></textarea></div><button class="primary" style="width:100%">SEND MESSAGE</button></form></div></section>`; $('#contact-form').onsubmit = async event => { event.preventDefault(); try { const result = await request('/contact', {method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); event.currentTarget.reset(); toast(result.message); } catch (error) { toast(error.message, true); } }; }
async function saveFavourite(productId) {
  if (!state.token) { go('login?next=shop'); return; }
  try { await request(`/wishlist/${productId}`, {method:'POST'}); toast('Saved to your favourites.'); }
  catch (error) { toast(error.message, true); }
}
function productCard(product) {
  const label = product.is_best_seller ? 'BEST SELLER' : product.is_featured ? 'FEATURED' : product.customization_available ? 'CUSTOMISE' : product.in_stock ? 'PAPERPLAZO' : 'OUT OF STOCK';
  const price = product.discount_price ? `<span class="old-price">${money(product.price)}</span>${money(product.selling_price)}` : money(product.selling_price);
  return `<article class="product-card"><button data-favourite="${product.id}" aria-label="Save ${escapeHtml(product.name)} to favourites" title="Save to favourites" style="position:absolute;right:13px;top:13px;z-index:3;width:30px;height:30px;border:1px solid #d3cdbf;background:#f8f6ef;color:#173c2b;font-size:16px">♡</button><a href="#product/${encodeURIComponent(product.slug)}" class="product-image"><span class="product-tag">${label}</span>${productVisual(product)}</a><div class="product-info"><div class="product-title-row"><h3><a href="#product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h3><span class="price">${price}</span></div><p>${escapeHtml(product.description)}</p><button class="add" data-add="${product.id}" ${product.in_stock ? '' : 'disabled'}>${product.in_stock ? 'ADD TO BAG +' : 'OUT OF STOCK'}</button></div></article>`;
}
function bindAddButtons(root = document) {
  root.querySelectorAll('[data-add]').forEach(button => button.onclick = () => addToCart(Number(button.dataset.add), 1));
  root.querySelectorAll('[data-favourite]').forEach(button => button.onclick = () => saveFavourite(Number(button.dataset.favourite)));
}
async function enhanceHome() {
  try {
    const [categoryData, bestSellerData] = await Promise.all([request('/categories'), request('/products?best_sellers=true&per_page=3')]);
    const categorySection = `<section class="section tint"><div class="section-head"><div><div class="eyebrow">FIND YOUR FORMAT</div><h2 class="section-title">Shop by <i>category.</i></h2></div><p class="section-desc">Published categories are kept in sync with the live catalog.</p></div><div class="steps">${categoryData.categories.length ? categoryData.categories.slice(0,3).map((category,index)=>`<a class="step" href="#shop"><div class="num">0${index+1}</div><h3>${escapeHtml(category.name)}</h3><p>${escapeHtml(category.description || 'Browse available designs and live product details in this category.')}</p></a>`).join('') : '<div class="empty-state full"><h2>Categories are being curated.</h2><p>Check back as the first PAPERPLAZO formats are published.</p></div>'}</div></section>`;
    const bestSection = `<section class="section"><div class="section-head"><div><div class="eyebrow">CUSTOMER FAVOURITES</div><h2 class="section-title">Best <i>sellers.</i></h2></div><p class="section-desc">Only products marked as current best sellers are shown here.</p></div><div class="product-grid">${bestSellerData.products.length ? bestSellerData.products.map(productCard).join('') : '<div class="empty-state full"><h2>Best sellers will appear here.</h2><p>We’ll share customer favourites once live catalog performance is available.</p></div>'}</div></section><section class="section tint"><div class="section-head"><div><div class="eyebrow">CUSTOMER STORIES</div><h2 class="section-title">Good words, <i>earned.</i></h2></div><p class="section-desc">We do not publish invented testimonials. Verified customer stories will appear here as they are collected.</p></div></section>`;
    app.insertAdjacentHTML('beforeend', categorySection + bestSection); bindAddButtons(app);
  } catch (error) { console.warn('Home catalog enhancements could not be loaded:', error.message); }
}
async function render() {
  const current = route(); const [path] = current.split('?'); const [name, value] = path.split('/');
  window.scrollTo({top:0, behavior:'auto'}); $('#site-nav').classList.remove('open'); $('#mobile-toggle').setAttribute('aria-expanded','false');
  app.classList.remove('page-ready');
  if (name === 'home') { await renderHome(); await enhanceHome(); } else if (name === 'shop') await renderShop(); else if (name === 'product' && value) await renderProduct(decodeURIComponent(value)); else if (name === 'cart') await renderCart(); else if (name === 'checkout') await renderCheckout(); else if (name === 'login') authForm('login'); else if (name === 'register') authForm('register'); else if (name === 'account') await renderAccount(); else if (name === 'custom') await renderCustom(); else if (name === 'about') renderAbout(); else if (name === 'track') renderTrack(); else if (name === 'contact') renderContact(); else { go('home'); }
  connectLiveProducts();
  bindProductImageFallback(app);
  requestAnimationFrame(() => app.classList.add('page-ready'));
  initScrollAnimations();
}
document.getElementById('mobile-toggle').onclick = () => { const nav = $('#site-nav'); nav.classList.toggle('open'); $('#mobile-toggle').setAttribute('aria-expanded', String(nav.classList.contains('open'))); };
window.addEventListener('hashchange', render);
(async () => { try { if (state.token) { const result = await request('/auth/me'); state.user = result.user; localStorage.setItem('paperplazo_customer_user', JSON.stringify(result.user)); await mergeGuestCart(); } await refreshCart(); } catch (error) { console.warn(error.message); } render(); })();
