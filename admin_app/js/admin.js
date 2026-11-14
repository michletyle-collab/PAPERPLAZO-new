import {
  getAuthInstance,
  getCurrentUser,
  listenAuthState,
  signInWithEmailAndPassword,
  signOut
} from '/shared/firebase.js';

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
const state = { token: '', user: parseStorageJson('paperplazo_admin_user', null), view: 'overview' };
const root = document.getElementById('admin-app');
const $ = (selector, node = document) => node.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const dateText = value => value ? new Date(value).toLocaleString('en-IN', {dateStyle:'medium', timeStyle:'short'}) : '';
const parseAdminDisplayName = user => user?.displayName?.trim() || user?.email?.split('@', 1)[0] || 'Administrator';
let toastTimer;

function toast(message, error = false) { const box = $('#admin-toast'); if (!box) return; box.textContent = message; box.style.background = error ? '#8d3026' : ''; box.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('show'), 4300); }

async function getFirebaseBearerToken() {
  const user = getCurrentUser();
  if (!user) throw new Error('No active Firebase admin session.');
  return user.getIdToken();
}

async function api(path, options = {}) {
  const headers = {...(options.headers || {})};
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  try {
    const token = await getFirebaseBearerToken();
    headers.Authorization = `Bearer ${token}`;
  } catch {
    delete headers.Authorization;
  }
  let response; try { response = await fetch(`${API}${path}`, {...options, headers}); } catch { throw new Error('Cannot reach the PAPERPLAZO API.'); }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await logout(false);
    }
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

async function logout(show = true) {
  state.token = '';
  state.user = null;
  localStorage.removeItem('paperplazo_admin_token');
  localStorage.removeItem('paperplazo_admin_user');

  const authInstance = getAuthInstance();
  if (authInstance?.currentUser) {
    try {
      await signOut(authInstance);
    } catch {
      // Firebase sign-out already failed or is not available; fail open to the UI reset.
    }
  }

  if (show) toast('Signed out.');
  renderLogin();
}

function persistSession(user) {
  state.token = '';
  state.user = { email: user.email, full_name: parseAdminDisplayName(user), role: 'admin' };
  localStorage.setItem('paperplazo_admin_user', JSON.stringify(state.user));
}
function statusClass(status = '') { return /received|pending|reviewing/i.test(status) ? 'pending' : /cancel|reject/i.test(status) ? 'cancelled' : ''; }
function drawer(content) { document.body.insertAdjacentHTML('beforeend', `<aside id="drawer" class="drawer"><div class="drawer-head"><div>${content.title ? `<h2>${content.title}</h2>` : ''}${content.subtitle ? `<p class="help">${content.subtitle}</p>` : ''}</div><button id="close-drawer" class="close-drawer" aria-label="Close">×</button></div>${content.body}</aside>`); requestAnimationFrame(() => $('#drawer').classList.add('open')); $('#close-drawer').onclick = closeDrawer; }
function closeDrawer() { const el = $('#drawer'); if (el) { el.classList.remove('open'); setTimeout(() => el.remove(), 250); } }
async function downloadInvoice(orderNumber) {
  try {
    const token = await getFirebaseBearerToken();
    const response = await fetch(`${API}/orders/${encodeURIComponent(orderNumber)}/invoice`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Invoice could not be generated.');
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${orderNumber}-invoice.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderLogin() {
  root.innerHTML = `<section class="login"><aside class="login-side"><div class="wordmark">PAPER<span>PLAZO</span><small>THOUGHTFUL PAPER PACKAGING</small></div><h1>Operational clarity for every <i>handover.</i></h1><p>This private workspace controls live catalog, inventory, customer orders, custom quotations and the activity behind PAPERPLAZO.</p></aside><div class="login-card-wrap"><form id="admin-login" class="login-card"><div class="wordmark" style="font-size:28px;color:var(--green)">PAPER<span>PLAZO</span><small>PRIVATE ADMINISTRATION</small></div><h2>Welcome back.</h2><p>Sign in with the administrator account configured on the server.</p><div class="field"><label>ADMIN EMAIL</label><input type="email" name="email" required autocomplete="username"></div><div class="field"><label>PASSWORD</label><input type="password" name="password" required autocomplete="current-password"></div><button class="btn">SIGN IN SECURELY</button><p class="help" style="margin-top:16px">Credentials are never stored in this application or exposed to customers.</p></form></div></section>`;
  $('#admin-login').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.email.value.trim();
    const password = form.password.value;
    try {
      const authInstance = getAuthInstance();
      if (!authInstance) {
        throw new Error('Firebase is not configured for the admin dashboard.');
      }
      const credential = await signInWithEmailAndPassword(authInstance, email, password);
      const tokenResult = await credential.user.getIdTokenResult(true);
      if (tokenResult.claims.admin !== true) {
        await signOut(authInstance);
        throw new Error('This account is not authorised for the admin dashboard.');
      }
      persistSession(credential.user);
      state.token = await credential.user.getIdToken();
      state.view = 'overview';
      renderShell();
    } catch (error) {
      toast(error.message || 'Admin sign-in failed.', true);
    }
  };
}
function shell() { return `<div class="admin-shell"><aside class="sidebar"><div class="wordmark">PAPER<span>PLAZO</span><small>PRIVATE ADMINISTRATION</small></div><nav class="sidebar-nav"><button data-view="overview">Overview</button><button data-view="orders">Orders</button><button data-view="products">Products & categories</button><button data-view="quotes">Custom quotations</button><button data-view="customers">Customers</button><button data-view="inventory">Inventory</button><button data-view="analytics">Analytics</button><button data-view="messages">Contact messages</button></nav><div class="side-bottom">Signed in as<br><b>${escapeHtml(state.user.full_name)}</b><br><button id="logout-sidebar">Sign out</button></div></aside><main class="main-area"><header class="topbar"><div id="topbar-title" class="topbar-title">PAPERPLAZO operations</div><div class="topbar-user"><span id="notification-count"></span><span>${escapeHtml(state.user.email)}</span><div class="avatar">${escapeHtml(state.user.full_name.slice(0,1).toUpperCase())}</div><button id="logout" class="btn secondary small">LOG OUT</button></div></header><div id="admin-content" class="admin-content"></div></main></div>`; }
async function updateNotifications() { try { const data = await api('/admin/notifications'); const unread = data.notifications.filter(item => !item.read).length; $('#notification-count').textContent = unread ? `${unread} new notification${unread === 1 ? '' : 's'}` : ''; } catch { /* current view still works */ } }
function screenHead(title, description, action = '') { return `<div class="screen-head"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
function loading() { $('#admin-content').innerHTML = '<p class="loading">Loading…</p>'; }
async function renderOverview() { loading(); try { const data = await api('/admin/dashboard'); const m = data.metrics; $('#topbar-title').textContent = 'Overview'; $('#admin-content').innerHTML = `${screenHead('Good morning.', 'A live view of PAPERPLAZO operations.') }<section class="metric-grid"><article class="metric"><span>TOTAL ORDERS</span><b>${m.total_orders}</b><em>${m.new_orders} newly received</em></article><article class="metric"><span>ACTIVE ORDER PIPELINE</span><b>${m.pending_orders}</b><em>Payment pending</em></article><article class="metric"><span>MONTHLY REVENUE</span><b>${money(m.monthly_revenue)}</b><em>Excludes cancelled orders</em></article><article class="metric"><span>LOW STOCK PRODUCTS</span><b>${m.low_stock_products}</b><em>Threshold controlled in environment</em></article></section><section class="two-panel"><div class="panel"><h2>Order status</h2><div class="status-list">${Object.entries(data.orders_by_status).map(([status,count]) => `<div class="status-row"><span>${escapeHtml(status)}</span><b>${count}</b></div>`).join('')}</div></div><div class="panel"><h2>Catalog watch</h2>${data.best_sellers.length ? data.best_sellers.map(item => `<div class="notice"><b>${escapeHtml(item.name)}</b><br><span class="help">${escapeHtml(item.product_code)} · ${item.stock} in stock</span></div>`).join('') : '<p class="empty">No published products yet.</p>'}</div></section><section class="panel"><h2>Recent notifications</h2><div id="notice-list"><p class="loading">Loading activity…</p></div></section>`; const notices = await api('/admin/notifications'); $('#notice-list').innerHTML = notices.notifications.length ? notices.notifications.slice(0,8).map(n => `<div class="notice"><b>${escapeHtml(n.message)}</b><time>${dateText(n.created_at)}${n.read ? '' : ' · unread'}</time></div>`).join('') : '<p class="empty">No notifications yet.</p>'; } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; } }
async function renderOrders() { loading(); try { const data = await api('/admin/orders'); $('#topbar-title').textContent = 'Order management'; $('#admin-content').innerHTML = `${screenHead('Orders', 'Review purchases, update fulfilment, and download customer invoices.')}<div class="panel"><div class="toolbar"><input id="order-search" placeholder="Search order, customer or email"><select id="order-status"><option value="">All statuses</option>${['Order Received','Payment Pending','Confirmed','Processing','Production','Ready for Dispatch','Shipped','Delivered','Cancelled'].map(s=>`<option>${s}</option>`).join('')}</select><button class="btn secondary" id="filter-orders">FILTER</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th></th></tr></thead><tbody id="orders-rows"></tbody></table></div></div>`; const rows = $('#orders-rows'); const draw = orders => rows.innerHTML = orders.length ? orders.map(order => `<tr><td><strong>${escapeHtml(order.order_number)}</strong><br><span class="help">${dateText(order.created_at)}</span></td><td>${escapeHtml(order.customer.full_name)}<br><span class="help">${escapeHtml(order.customer.email)}</span></td><td>${order.items.map(item=>`${escapeHtml(item.product_name)} × ${item.quantity}`).join('<br>')}</td><td>${money(order.total)}<br><span class="help">${escapeHtml(order.payment_status)}</span></td><td><span class="badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span></td><td><div class="actions"><button class="btn secondary small" data-edit-order="${escapeHtml(order.order_number)}">UPDATE</button><button class="btn secondary small" data-invoice="${escapeHtml(order.order_number)}">INVOICE</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No orders match this filter.</td></tr>'; draw(data.orders); const filter = async () => { try { const q = $('#order-search').value.trim(), status = $('#order-status').value; const results = await api(`/admin/orders?${new URLSearchParams({q,status})}`); draw(results.orders); bindOrderActions(results.orders); } catch (error) { toast(error.message, true); } }; $('#filter-orders').onclick = filter; $('#order-search').onkeydown = e => { if(e.key==='Enter') filter(); }; const bindOrderActions = orders => { root.querySelectorAll('[data-invoice]').forEach(button => button.onclick = () => downloadInvoice(button.dataset.invoice)); root.querySelectorAll('[data-edit-order]').forEach(button => button.onclick = () => editOrder(orders.find(order => order.order_number === button.dataset.editOrder))); }; bindOrderActions(data.orders); } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; } }
function editOrder(order) { if (!order) return; const statuses = ['Order Received','Payment Pending','Confirmed','Processing','Production','Ready for Dispatch','Shipped','Delivered','Cancelled']; drawer({title:order.order_number, subtitle:`${order.customer.full_name} · ${money(order.total)}`, body:`<p class="help">Products: ${order.items.map(item => `${escapeHtml(item.product_name)} × ${item.quantity}`).join(', ')}</p><form id="order-form"><div class="field"><label>ORDER STATUS</label><select name="status">${statuses.map(status => `<option ${status===order.status?'selected':''}>${status}</option>`).join('')}</select></div><p class="help">Confirming an order deducts stock only after a server-side availability check. Cancelling a stock-deducted order restores inventory.</p><button class="btn">SAVE ORDER STATUS</button></form>`}); $('#order-form').onsubmit = async event => { event.preventDefault(); try { await api(`/admin/orders/${encodeURIComponent(order.order_number)}`, {method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); toast('Order status saved.'); closeDrawer(); renderOrders(); updateNotifications(); } catch (error) { toast(error.message, true); } }; }
async function productForm(product = null) {
  let categories = []; try { categories = (await api('/categories')).categories; } catch (error) { toast(error.message, true); }
  const p = product || {product_code:'',name:'',description:'',price:'',discount_price:'',stock:0,category:null,paper_gsm:'',dimensions:'',handle_type:'',customization_available:false,status:'draft',is_featured:false,is_best_seller:false};
  drawer({title: product ? `Edit ${escapeHtml(p.name)}` : 'Add product', subtitle:'All catalog changes publish through the shared API.', body:`<form id="product-form"><div class="form-grid"><div class="field"><label>PRODUCT ID / CODE</label><input name="product_code" required maxlength="50" value="${escapeHtml(p.product_code)}"></div><div class="field"><label>STATUS</label><select name="status">${['draft','active','inactive'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}</select></div><div class="field full"><label>PRODUCT NAME</label><input name="name" required maxlength="180" value="${escapeHtml(p.name)}"></div><div class="field full"><label>DESCRIPTION</label><textarea name="description" required maxlength="10000">${escapeHtml(p.description)}</textarea></div><div class="field"><label>PRICE (INR)</label><input name="price" type="number" min="0.01" step="0.01" required value="${escapeHtml(p.price)}"></div><div class="field"><label>DISCOUNT PRICE (OPTIONAL)</label><input name="discount_price" type="number" min="0.01" step="0.01" value="${p.discount_price ?? ''}"></div><div class="field"><label>STOCK</label><input name="stock" type="number" min="0" step="1" required value="${escapeHtml(p.stock)}"></div><div class="field"><label>CATEGORY</label><select name="category_id"><option value="">No category</option>${categories.map(c=>`<option value="${c.id}" ${p.category?.id===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select></div><div class="field"><label>PAPER GSM</label><input name="paper_gsm" maxlength="50" value="${escapeHtml(p.paper_gsm || '')}"></div><div class="field"><label>DIMENSIONS</label><input name="dimensions" maxlength="100" value="${escapeHtml(p.dimensions || '')}"></div><div class="field full"><label>HANDLE TYPE</label><input name="handle_type" maxlength="100" value="${escapeHtml(p.handle_type || '')}"></div></div><label class="help"><input name="customization_available" type="checkbox" ${p.customization_available?'checked':''}> Customisation available</label><br><label class="help"><input name="is_featured" type="checkbox" ${p.is_featured?'checked':''}> Feature on customer homepage</label><br><label class="help"><input name="is_best_seller" type="checkbox" ${p.is_best_seller?'checked':''}> Mark as best seller</label><div class="form-actions"><button class="btn">${product ? 'SAVE PRODUCT' : 'CREATE PRODUCT'}</button>${product ? '<button type="button" id="deactivate-product" class="btn danger">DEACTIVATE</button>' : ''}</div></form>${product ? `<hr style="border:0;border-top:1px solid var(--line);margin:25px 0"><h3 style="font:normal 21px Georgia,serif">Product images</h3><div class="toolbar">${p.images.map(image=>`<img class="products-preview" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt_text || p.name)}">`).join('') || '<span class="help">No image uploaded yet.</span>'}</div><form id="image-form"><div class="field"><label>UPLOAD IMAGE</label><input name="image" type="file" accept=".jpg,.jpeg,.png,.webp" required></div><div class="field"><label>ALT TEXT</label><input name="alt_text" maxlength="180"></div><button class="btn secondary">UPLOAD IMAGE</button></form>` : ''}`});
  $('#product-form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); ['customization_available','is_featured','is_best_seller'].forEach(name => data[name] = form[name].checked); try { await api(product ? `/admin/products/${product.id}` : '/admin/products', {method:product?'PATCH':'POST',body:JSON.stringify(data)}); toast(product ? 'Product updated.' : 'Product created. Upload an image from its edit panel.'); closeDrawer(); renderProducts(); } catch (error) { toast(error.message, true); } };
  if (product) { $('#deactivate-product').onclick = async () => { if (!confirm(`Deactivate ${product.name}? It will disappear from the customer shop.`)) return; try { await api(`/admin/products/${product.id}`, {method:'DELETE'}); toast('Product deactivated.'); closeDrawer(); renderProducts(); } catch (error) { toast(error.message, true); } }; $('#image-form').onsubmit = async event => { event.preventDefault(); try { await api(`/admin/products/${product.id}/images`, {method:'POST',body:new FormData(event.currentTarget)}); toast('Image uploaded.'); closeDrawer(); renderProducts(); } catch (error) { toast(error.message, true); } }; }
}
async function categoryForm() { drawer({title:'Add category', subtitle:'Categories appear as live customer-shop filters.', body:`<form id="category-form"><div class="field"><label>NAME</label><input name="name" maxlength="100" required></div><div class="field"><label>SLUG (OPTIONAL)</label><input name="slug" maxlength="120" placeholder="Created automatically if blank"></div><div class="field"><label>DESCRIPTION</label><textarea name="description" maxlength="1000"></textarea></div><button class="btn">CREATE CATEGORY</button></form>`}); $('#category-form').onsubmit = async event => { event.preventDefault(); try { await api('/admin/categories', {method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); toast('Category created.'); closeDrawer(); renderProducts(); } catch (error) { toast(error.message, true); } }; }
async function renderProducts() {
  loading();
  try {
    const [productData, categoryData] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
    const products = productData.products, categories = categoryData.categories;
    $('#topbar-title').textContent = 'Product management';
    $('#admin-content').innerHTML = `${screenHead('Products', 'Live catalog changes are immediately reflected in the customer store.', '<div class="actions"><button id="new-category" class="btn secondary">ADD CATEGORY</button><button id="new-product" class="btn">ADD PRODUCT</button></div>')}<section class="panel"><div class="toolbar"><input id="product-search" placeholder="Search name or product ID"><button id="find-products" class="btn secondary">SEARCH</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th><th></th></tr></thead><tbody id="product-rows"></tbody></table></div></section><section class="panel"><h2>Categories</h2><div id="category-list" class="status-list"></div></section>`;
    const drawProducts = items => { $('#product-rows').innerHTML = items.length ? items.map(product => `<tr><td><strong>${escapeHtml(product.name)}</strong><br><span class="help">${escapeHtml(product.product_code)}</span></td><td>${escapeHtml(product.category?.name || '—')}</td><td>${product.discount_price ? `<span style="text-decoration:line-through;color:var(--muted)">${money(product.price)}</span> ` : ''}${money(product.selling_price)}</td><td class="${product.stock<=10?'stock-low':''}">${product.stock}</td><td><span class="badge ${product.status==='inactive'?'cancelled':''}">${escapeHtml(product.status)}</span></td><td><button class="btn secondary small" data-edit-product="${product.id}">EDIT</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No products created yet.</td></tr>'; bindProductButtons(items); };
    const bindProductButtons = items => root.querySelectorAll('[data-edit-product]').forEach(button => button.onclick = () => productForm(items.find(item => item.id === Number(button.dataset.editProduct))));
    $('#category-list').innerHTML = categories.length ? categories.map(category => `<div class="status-row"><span>${escapeHtml(category.name)}<br><small>${escapeHtml(category.slug)}</small></span><span><span class="badge ${category.active?'':'cancelled'}">${category.active?'ACTIVE':'INACTIVE'}</span> <button class="btn secondary small" data-edit-category="${category.id}">EDIT</button></span></div>`).join('') : '<p class="empty">No categories created.</p>';
    root.querySelectorAll('[data-edit-category]').forEach(button => button.onclick = () => editCategory(categories.find(category => category.id === Number(button.dataset.editCategory))));
    drawProducts(products);
    $('#new-product').onclick = () => productForm();
    $('#new-category').onclick = categoryForm;
    $('#find-products').onclick = async () => { try { const data = await api(`/admin/products?${new URLSearchParams({q:$('#product-search').value.trim()})}`); drawProducts(data.products); } catch (error) { toast(error.message,true); } };
  } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
async function renderAnalytics() {
  loading();
  try {
    const result = await api('/admin/analytics');
    $('#topbar-title').textContent = 'Analytics';
    const maxDaily = Math.max(...result.daily_sales.map(item => item.sales), 1);
    $('#admin-content').innerHTML = `${screenHead('Analytics', 'Sales, customer growth and inventory reporting from the shared order database.')}<section class="metric-grid"><article class="metric"><span>ANNUAL REVENUE</span><b>${money(result.annual_revenue)}</b><em>Cancelled orders excluded</em></article><article class="metric"><span>NEW CUSTOMERS (12 MONTHS)</span><b>${result.monthly_sales.reduce((sum,item)=>sum+item.new_customers,0)}</b><em>Registered customer accounts</em></article><article class="metric"><span>BEST SELLER</span><b style="font-size:19px">${escapeHtml(result.best_sellers[0]?.name || '—')}</b><em>${result.best_sellers[0] ? `${result.best_sellers[0].quantity} units sold` : 'No completed order data yet'}</em></article><article class="metric"><span>REPORT WINDOW</span><b>12 mo</b><em>Daily sales shown below</em></article></section><section class="panel"><h2>Daily sales — last 7 days</h2><div class="chart">${result.daily_sales.map(item=>`<div class="bar" style="height:${Math.max((item.sales/maxDaily)*100,2)}%"><b>${money(item.sales)}</b><span>${item.date.slice(5)}</span></div>`).join('')}</div></section><section class="two-panel"><div class="panel"><h2>Best-selling products</h2>${result.best_sellers.length ? result.best_sellers.map(item=>`<div class="notice"><b>${escapeHtml(item.name)}</b><br><span class="help">${item.quantity} confirmed units sold</span></div>`).join('') : '<p class="empty">No confirmed sales yet.</p>'}</div><div class="panel"><h2>Category inventory</h2>${result.category_inventory.length ? result.category_inventory.map(item=>`<div class="notice"><b>${escapeHtml(item.category)}</b><br><span class="help">${item.products} product record(s)</span></div>`).join('') : '<p class="empty">No categories created yet.</p>'}</div></section><p class="help">${escapeHtml(result.note)}</p>`;
  } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
async function renderQuotes() {
  loading();
  try {
    const result = await api('/admin/quotes');
    $('#topbar-title').textContent = 'Custom quotations';
    $('#admin-content').innerHTML = `${screenHead('Custom quotations', 'Review requirements, send an itemised quote, and track customer responses.')}<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>REFERENCE</th><th>CUSTOMER</th><th>STATUS</th><th>QUOTE</th></tr></thead><tbody>${(result.quotes || []).map(quote => `<tr><td>${escapeHtml(quote.reference)}</td><td>${escapeHtml(quote.customer?.full_name || 'Customer')}</td><td><span class="badge ${statusClass(quote.status)}">${escapeHtml(quote.status || 'Requested')}</span></td><td>${quote.total_price !== null && quote.total_price !== undefined ? money(quote.total_price) : 'Not priced'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No quotation requests yet.</td></tr>'}</tbody></table></div></section>`;
  } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
async function renderCustomers() {
  loading();
  try {
    const result = await api('/admin/customers');
    $('#topbar-title').textContent = 'Customer management';
    $('#admin-content').innerHTML = `${screenHead('Customers', 'Review registered customer contact information and purchase history.')}<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>CUSTOMER</th><th>EMAIL</th><th>PHONE</th><th>ORDERS</th></tr></thead><tbody>${(result.customers || []).map(customer => `<tr><td>${escapeHtml(customer.full_name)}</td><td>${escapeHtml(customer.email)}</td><td>${escapeHtml(customer.phone || '—')}</td><td>${customer.order_count || 0}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No registered customers found.</td></tr>'}</tbody></table></div></section>`;
  } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
async function renderInventory() {
  loading();
  try {
    const [productsResult, historyResult] = await Promise.all([api('/admin/products'), api('/admin/inventory/history')]);
    $('#topbar-title').textContent = 'Inventory management';
    $('#admin-content').innerHTML = `${screenHead('Inventory', 'Adjust on-hand inventory with an auditable history.')}<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUCT</th><th>STOCK</th><th>STATUS</th></tr></thead><tbody>${(productsResult.products || []).map(product => `<tr><td>${escapeHtml(product.name)}</td><td class="${product.stock <= 10 ? 'stock-low' : ''}">${product.stock}</td><td><span class="badge ${product.status === 'active' ? '' : 'pending'}">${escapeHtml(product.status || 'draft')}</span></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No products available.</td></tr>'}</tbody></table></div></section><section class="panel"><h2>Stock history</h2><div class="status-list">${(historyResult.history || []).slice(0, 8).map(row => `<div class="notice"><b>${escapeHtml(row.product_name || 'Product')}</b><br><span class="help">${escapeHtml(row.reason || 'Inventory update')} · ${dateText(row.created_at)}</span></div>`).join('') || '<p class="empty">No inventory adjustments yet.</p>'}</div></section>`;
  } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
async function renderMessages() {
  loading();
  try {
    const result = await api('/admin/contact-messages');
    $('#topbar-title').textContent = 'Contact messages';
    $('#admin-content').innerHTML = `${screenHead('Contact messages', 'Messages submitted from the customer site.')}<section class="panel"><div id="message-list">${(result.messages || []).map(message => `<article class="notice"><div class="actions" style="justify-content:space-between"><div><b>${escapeHtml(message.subject)}</b> ${message.resolved ? '<span class="badge">RESOLVED</span>' : '<span class="badge pending">OPEN</span>'}<br><span class="help">${escapeHtml(message.name)} · ${escapeHtml(message.email)} · ${dateText(message.created_at)}</span></div></div><p>${escapeHtml(message.message)}</p></article>`).join('') || '<p class="empty">No contact messages yet.</p>'}</div></section>`;
  } catch (error) { $('#admin-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
const renderers = {overview:renderOverview, orders:renderOrders, products:renderProducts, quotes:renderQuotes, customers:renderCustomers, inventory:renderInventory, analytics:renderAnalytics, messages:renderMessages};
function renderShell() { root.innerHTML = shell(); root.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view; root.querySelectorAll('[data-view]').forEach(item=>item.classList.toggle('active', item===button)); renderers[state.view]();}); $('#logout').onclick=()=>logout(); $('#logout-sidebar').onclick=()=>logout(); root.querySelector(`[data-view="${state.view}"]`)?.classList.add('active'); renderers[state.view](); updateNotifications(); }
const ensureAdminSession = async () => {
  const authInstance = getAuthInstance();
  if (!authInstance) {
    renderLogin();
    return;
  }

  listenAuthState(async user => {
    if (!user) {
      state.token = '';
      state.user = null;
      localStorage.removeItem('paperplazo_admin_user');
      renderLogin();
      return;
    }

    try {
      const tokenResult = await user.getIdTokenResult(true);
      if (tokenResult.claims.admin !== true) {
        await signOut(authInstance);
        state.token = '';
        state.user = null;
        localStorage.removeItem('paperplazo_admin_user');
        toast('Administrator access is required.', true);
        renderLogin();
        return;
      }

      state.token = await user.getIdToken();
      state.user = { email: user.email, full_name: parseAdminDisplayName(user), role: 'admin' };
      localStorage.setItem('paperplazo_admin_user', JSON.stringify(state.user));
      renderShell();
    } catch (error) {
      await signOut(authInstance).catch(() => {});
      state.token = '';
      state.user = null;
      localStorage.removeItem('paperplazo_admin_user');
      toast(error.message || 'Administrator access is required.', true);
      renderLogin();
    }
  });
};

ensureAdminSession();
