/**
 * BillSoft - Billing Software Frontend Application
 * SPA with Google Auth, CRUD operations, and Invoice management
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    API_URL: 'https://billsoft-nine.vercel.app',   // Vercel backend
    GOOGLE_CLIENT_ID: '264450160625-0o92ftsc5leue8ar9apa08r9n59k15mh.apps.googleusercontent.com', // Replace with your Google Client ID
    SUPABASE_URL: 'https://aquatkkvswinvhqskfcs.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdWF0a2t2c3dpbnZocXNrZmNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjU5NDcsImV4cCI6MjA4Nzg0MTk0N30.LeaXN7sMZuMzPbOTJ_-t63vANBA2-8TcJeX7i7W4EZA',  // Replace with your Supabase anon key
};

// ============================================
// State Management
// ============================================
const state = {
    user: null,
    token: null,
    currentPage: 'dashboard',
    customers: [],
    products: [],
    invoices: [],
    dashboard: null,
    isOffline: !navigator.onLine,
};

// ============================================
// Local Storage Persistence (demo/offline)
// ============================================
function saveLocalData(key, data) {
    try {
        localStorage.setItem('billsoft_' + key, JSON.stringify(data));
    } catch (e) { /* quota exceeded or private mode */ }
}

function loadLocalData(key) {
    try {
        const raw = localStorage.getItem('billsoft_' + key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function initLocalState() {
    state.customers = loadLocalData('customers') || [];
    state.products = loadLocalData('products') || [];
    state.invoices = loadLocalData('invoices') || [];
}

// ============================================
// Google Authentication
// ============================================
function initGoogleAuth() {
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.initialize({
            client_id: CONFIG.GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse,
        });
    }
}

function handleGoogleLogin() {
    // On localhost, always use demo mode (Google OAuth won't work without proper origin setup)
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
        showDemoLogin();
        return;
    }

    // Check if real Google Client ID is configured
    const isRealClientId = CONFIG.GOOGLE_CLIENT_ID &&
        !CONFIG.GOOGLE_CLIENT_ID.includes('YOUR_') &&
        CONFIG.GOOGLE_CLIENT_ID.length > 30;

    if (!isRealClientId) {
        showDemoLogin();
        return;
    }

    // If Google library hasn't loaded yet, wait and retry
    if (typeof google === 'undefined' || !google.accounts) {
        showToast('Loading Google Sign-In, please wait...', 'info');
        let retries = 0;
        const waitForGoogle = setInterval(() => {
            retries++;
            if (typeof google !== 'undefined' && google.accounts) {
                clearInterval(waitForGoogle);
                startGoogleOAuth();
            } else if (retries > 10) {
                clearInterval(waitForGoogle);
                showToast('Google Sign-In failed to load. Using demo mode.', 'error');
                showDemoLogin();
            }
        }, 500);
        return;
    }

    startGoogleOAuth();
}

function startGoogleOAuth() {
    // Use OAuth popup flow directly (more reliable than One Tap)
    try {
        google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.GOOGLE_CLIENT_ID,
            scope: 'email profile',
            callback: (response) => {
                if (response.access_token) {
                    handleTokenLogin(response.access_token);
                } else {
                    showToast('Google Sign-In was cancelled', 'info');
                }
            },
            error_callback: (error) => {
                console.error('Google OAuth error:', error);
                showToast('Google Sign-In failed: ' + (error.message || 'Unknown error'), 'error');
            },
        }).requestAccessToken();
    } catch (error) {
        console.error('Google OAuth error:', error);
        showToast('Google Sign-In failed. Please try again.', 'error');
    }
}

function handleGoogleCredentialResponse(response) {
    if (response.credential) {
        authenticateWithBackend(response.credential);
    }
}

async function handleTokenLogin(accessToken) {
    try {
        const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userInfo = await res.json();

        // Store and show app
        state.user = {
            name: userInfo.name,
            email: userInfo.email,
            avatar_url: userInfo.picture
        };
        state.token = accessToken;

        localStorage.setItem('billsoft_user', JSON.stringify(state.user));
        localStorage.setItem('billsoft_token', state.token);

        showApp();
    } catch (error) {
        showToast('Authentication failed', 'error');
    }
}

async function authenticateWithBackend(idToken) {
    try {
        const response = await api('/api/auth/google', 'POST', { token: idToken });
        state.user = response.user;
        state.token = idToken;

        localStorage.setItem('billsoft_user', JSON.stringify(state.user));
        localStorage.setItem('billsoft_token', state.token);

        showApp();
        showToast('Welcome back, ' + state.user.name + '!', 'success');
    } catch (error) {
        showToast('Login failed: ' + error.message, 'error');
    }
}

function showDemoLogin() {
    // Demo mode for development without Google credentials
    state.user = {
        name: 'Demo User',
        email: 'demo@billsoft.app',
        avatar_url: ''
    };
    state.token = 'demo-token';

    localStorage.setItem('billsoft_user', JSON.stringify(state.user));
    localStorage.setItem('billsoft_token', state.token);

    showApp();
    showToast('Running in demo mode — connect Google Auth for production', 'info');
}

function handleLogout() {
    state.user = null;
    state.token = null;
    state.customers = [];
    state.products = [];
    state.invoices = [];
    state.dashboard = null;

    localStorage.removeItem('billsoft_user');
    localStorage.removeItem('billsoft_token');

    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app-layout').classList.add('hidden');
}

// ============================================
// API Helper
// ============================================
async function api(endpoint, method = 'GET', body = null) {
    // Re-check browser online status (more reliable than cached flag)
    if (!navigator.onLine) {
        state.isOffline = true;
        throw new Error('No internet connection');
    }

    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    if (state.token) {
        options.headers['Authorization'] = `Bearer ${state.token}`;
    }

    if (body) {
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(CONFIG.API_URL + endpoint, options);
    } catch (fetchError) {
        // fetch itself failed (network error, CORS, DNS, etc.)
        if (!navigator.onLine) {
            state.isOffline = true;
        }
        throw new Error('Server unreachable');
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));

        // Token expired or missing — force re-login
        if (response.status === 401) {
            showToast('Session expired — please sign in again', 'error');
            handleLogout();
            throw new Error('Session expired');
        }

        throw new Error(error.detail || 'Request failed');
    }

    return response.json();
}

// ============================================
// SPA Router
// ============================================
function navigateTo(page) {
    state.currentPage = page;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Render page
    renderPage(page);
}

function renderPage(page) {
    const main = document.getElementById('main-content');

    switch (page) {
        case 'dashboard':
            renderDashboard(main);
            break;
        case 'customers':
            renderCustomers(main);
            break;
        case 'products':
            renderProducts(main);
            break;
        case 'invoices':
            renderInvoices(main);
            break;
        case 'invoice-detail':
            renderInvoiceDetail(main, state._invoiceDetailId);
            break;
        default:
            renderDashboard(main);
    }
}

// ============================================
// App Initialization
// ============================================
function showApp() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');

    // Update user info in sidebar
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');

    nameEl.textContent = state.user.name || 'User';
    emailEl.textContent = state.user.email || '';

    if (state.user.avatar_url) {
        avatarEl.src = state.user.avatar_url;
    } else {
        avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(state.user.name || 'U')}&background=6366f1&color=fff&size=72`;
    }

    navigateTo('dashboard');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// Check for saved session
function checkSession() {
    const savedUser = localStorage.getItem('billsoft_user');
    const savedToken = localStorage.getItem('billsoft_token');

    if (savedUser && savedToken) {
        state.user = JSON.parse(savedUser);
        state.token = savedToken;
        showApp();
    }
}

// ============================================
// Dashboard Page
// ============================================
function renderDashboard(container) {
    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Dashboard</h1>
                <p class="page-subtitle">Welcome back, ${state.user?.name || 'User'}! Here's your business overview.</p>
            </div>
        </div>
        <div class="page-body animate-in">
            <div class="stats-grid" id="stats-grid">
                <div class="card stat-card revenue">
                    <div class="stat-icon">💰</div>
                    <div class="stat-value" id="stat-revenue">₹0.00</div>
                    <div class="stat-label">Total Revenue</div>
                </div>
                <div class="card stat-card pending">
                    <div class="stat-icon">⏳</div>
                    <div class="stat-value" id="stat-pending">₹0.00</div>
                    <div class="stat-label">Pending Amount</div>
                </div>
                <div class="card stat-card overdue">
                    <div class="stat-icon">⚠️</div>
                    <div class="stat-value" id="stat-overdue">₹0.00</div>
                    <div class="stat-label">Overdue Amount</div>
                </div>
                <div class="card stat-card customers">
                    <div class="stat-icon">👥</div>
                    <div class="stat-value" id="stat-customers">0</div>
                    <div class="stat-label">Total Customers</div>
                </div>
            </div>
            
            <div class="card" style="margin-bottom: var(--space-xl);">
                <div class="card-header">
                    <h3 class="card-title">Quick Stats</h3>
                </div>
                <div class="stats-grid" style="margin-bottom: 0;">
                    <div style="text-align: center; padding: var(--space-lg);">
                        <div style="font-size: var(--font-3xl); font-weight: 800; color: var(--accent-primary-hover);" id="stat-total-invoices">0</div>
                        <div class="text-sm text-muted">Total Invoices</div>
                    </div>
                    <div style="text-align: center; padding: var(--space-lg);">
                        <div style="font-size: var(--font-3xl); font-weight: 800; color: var(--success);" id="stat-paid-count">0</div>
                        <div class="text-sm text-muted">Paid</div>
                    </div>
                    <div style="text-align: center; padding: var(--space-lg);">
                        <div style="font-size: var(--font-3xl); font-weight: 800; color: var(--warning);" id="stat-pending-count">0</div>
                        <div class="text-sm text-muted">Pending</div>
                    </div>
                    <div style="text-align: center; padding: var(--space-lg);">
                        <div style="font-size: var(--font-3xl); font-weight: 800; color: var(--info);" id="stat-products">0</div>
                        <div class="text-sm text-muted">Products</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Recent Invoices</h3>
                    <button class="btn btn-primary btn-sm" onclick="navigateTo('invoices')">View All</button>
                </div>
                <div id="recent-invoices-table">
                    <div class="page-loading"><div class="spinner"></div> Loading...</div>
                </div>
            </div>
        </div>
    `;

    loadDashboardData();
}

async function loadDashboardData() {
    try {
        // Try API, fallback to local state
        let data;
        try {
            const result = await api('/api/dashboard');
            data = result.data;
        } catch (e) {
            console.warn('Dashboard API unavailable, using local data:', e.message);
            data = calculateLocalDashboard();
        }

        // Guard against DOM elements being removed (e.g. user navigated away)
        const el = (id) => document.getElementById(id);
        if (!el('stat-revenue')) return; // Dashboard no longer visible

        el('stat-revenue').textContent = formatCurrency(data.total_revenue || 0);
        el('stat-pending').textContent = formatCurrency(data.pending_amount || 0);
        el('stat-overdue').textContent = formatCurrency(data.overdue_amount || 0);
        el('stat-customers').textContent = data.customer_count || 0;
        el('stat-total-invoices').textContent = data.total_invoices || 0;
        el('stat-paid-count').textContent = data.paid_count || 0;
        el('stat-pending-count').textContent = data.pending_count || 0;
        el('stat-products').textContent = data.product_count || 0;

        const recentContainer = el('recent-invoices-table');
        const recentInvoices = data.recent_invoices || [];

        if (recentInvoices.length === 0) {
            recentContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🧾</div>
                    <div class="empty-state-title">No invoices yet</div>
                    <div class="empty-state-text">Create your first invoice to get started</div>
                    <button class="btn btn-primary" onclick="navigateTo('invoices')">Create Invoice</button>
                </div>
            `;
        } else {
            recentContainer.innerHTML = `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Invoice #</th>
                                <th>Customer</th>
                                <th>Date</th>
                                <th>Total</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentInvoices.map(inv => `
                                <tr style="cursor:pointer" onclick="viewInvoice('${inv.id}')">
                                    <td class="name-cell">${inv.invoice_number}</td>
                                    <td>${inv.customers?.name || '—'}</td>
                                    <td>${formatDate(inv.date)}</td>
                                    <td class="font-bold">${formatCurrency(inv.total)}</td>
                                    <td><span class="badge badge-${inv.status}">${inv.status}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    } catch (error) {
        console.error('Dashboard load error:', error);
    }
}

function calculateLocalDashboard() {
    const invoices = state.invoices || [];
    return {
        total_revenue: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total || 0), 0),
        pending_amount: invoices.filter(i => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + parseFloat(i.total || 0), 0),
        overdue_amount: invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.total || 0), 0),
        total_invoices: invoices.length,
        paid_count: invoices.filter(i => i.status === 'paid').length,
        pending_count: invoices.filter(i => ['sent', 'draft'].includes(i.status)).length,
        overdue_count: invoices.filter(i => i.status === 'overdue').length,
        customer_count: state.customers.length,
        product_count: state.products.length,
        recent_invoices: invoices.slice(0, 5)
    };
}

// ============================================
// Customers Page
// ============================================
function renderCustomers(container) {
    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Customers</h1>
                <p class="page-subtitle">Manage your customer directory</p>
            </div>
            <button class="btn btn-primary" id="add-customer-btn" onclick="openCustomerModal()">
                <span>+</span> Add Customer
            </button>
        </div>
        <div class="page-body animate-in">
            <div class="card">
                <div id="customers-list">
                    <div class="page-loading"><div class="spinner"></div> Loading customers...</div>
                </div>
            </div>
        </div>
    `;

    loadCustomers();
}

async function loadCustomers() {
    try {
        try {
            const result = await api('/api/customers');
            state.customers = result.data || [];
            saveLocalData('customers', state.customers);
        } catch (e) {
            console.warn('Customers API unavailable, using local data:', e.message);
            if (state.customers.length === 0) {
                state.customers = loadLocalData('customers') || [];
            }
        }
        renderCustomersList();
    } catch (error) {
        showToast('Failed to load customers', 'error');
    }
}

function renderCustomersList() {
    const container = document.getElementById('customers-list');
    if (!container) return;

    if (state.customers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-title">No customers yet</div>
                <div class="empty-state-text">Add your first customer to start creating invoices</div>
                <button class="btn btn-primary" onclick="openCustomerModal()">Add Customer</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>City</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.customers.map(c => `
                        <tr>
                            <td class="name-cell">${escapeHtml(c.name)}</td>
                            <td>${escapeHtml(c.email || '—')}</td>
                            <td>${escapeHtml(c.phone || '—')}</td>
                            <td>${escapeHtml(c.city || '—')}</td>
                            <td>
                                <div class="flex gap-sm">
                                    <button class="btn btn-secondary btn-sm" onclick="openCustomerModal('${c.id}')">Edit</button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openCustomerModal(customerId = null) {
    const customer = customerId ? state.customers.find(c => c.id === customerId) : null;
    const title = customer ? 'Edit Customer' : 'Add Customer';

    const html = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3 class="modal-title">${title}</h3>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="customer-form" onsubmit="saveCustomer(event, '${customerId || ''}')">
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Name *</label>
                                <input type="text" class="form-input" id="cust-name" value="${escapeHtml(customer?.name || '')}" required placeholder="Customer name">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Email</label>
                                <input type="email" class="form-input" id="cust-email" value="${escapeHtml(customer?.email || '')}" placeholder="email@example.com">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Phone</label>
                                <input type="text" class="form-input" id="cust-phone" value="${escapeHtml(customer?.phone || '')}" placeholder="+91 98765 43210">
                            </div>
                            <div class="form-group">
                                <label class="form-label">City</label>
                                <input type="text" class="form-input" id="cust-city" value="${escapeHtml(customer?.city || '')}" placeholder="City">
                            </div>
                            <div class="form-group">
                                <label class="form-label">State</label>
                                <input type="text" class="form-input" id="cust-state" value="${escapeHtml(customer?.state || '')}" placeholder="State">
                            </div>
                            <div class="form-group">
                                <label class="form-label">ZIP Code</label>
                                <input type="text" class="form-input" id="cust-zip" value="${escapeHtml(customer?.zip_code || '')}" placeholder="ZIP Code">
                            </div>
                            <div class="form-group full-width">
                                <label class="form-label">Address</label>
                                <textarea class="form-textarea" id="cust-address" placeholder="Full address">${escapeHtml(customer?.address || '')}</textarea>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                            <button type="submit" class="btn btn-primary">${customer ? 'Update' : 'Add'} Customer</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-container').innerHTML = html;
}

async function saveCustomer(event, customerId) {
    event.preventDefault();

    const data = {
        name: document.getElementById('cust-name').value,
        email: document.getElementById('cust-email').value || null,
        phone: document.getElementById('cust-phone').value || null,
        address: document.getElementById('cust-address').value || null,
        city: document.getElementById('cust-city').value || null,
        state: document.getElementById('cust-state').value || null,
        zip_code: document.getElementById('cust-zip').value || null,
    };

    try {
        if (customerId) {
            try {
                await api(`/api/customers/${customerId}`, 'PUT', data);
            } catch (e) {
                console.warn('API save failed, updating locally:', e.message);
                const idx = state.customers.findIndex(c => c.id === customerId);
                if (idx !== -1) state.customers[idx] = { ...state.customers[idx], ...data };
            }
            showToast('Customer updated!', 'success');
        } else {
            try {
                const result = await api('/api/customers', 'POST', data);
                state.customers.unshift(result.data);
            } catch (e) {
                console.warn('API save failed, saving locally:', e.message);
                data.id = generateId();
                data.created_at = new Date().toISOString();
                state.customers.unshift(data);
            }
            showToast('Customer added!', 'success');
        }

        saveLocalData('customers', state.customers);
        closeModal();
        renderCustomersList();
    } catch (error) {
        showToast('Failed to save customer', 'error');
    }
}

async function deleteCustomer(customerId) {
    if (!confirm('Are you sure you want to delete this customer?')) return;

    try {
        try {
            await api(`/api/customers/${customerId}`, 'DELETE');
        } catch (e) {
            console.warn('API delete failed, deleting locally:', e.message);
        }
        state.customers = state.customers.filter(c => c.id !== customerId);
        saveLocalData('customers', state.customers);
        renderCustomersList();
        showToast('Customer deleted', 'success');
    } catch (error) {
        showToast('Failed to delete customer', 'error');
    }
}

// ============================================
// Products Page
// ============================================
function renderProducts(container) {
    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Products & Services</h1>
                <p class="page-subtitle">Manage your product catalog</p>
            </div>
            <button class="btn btn-primary" id="add-product-btn" onclick="openProductModal()">
                <span>+</span> Add Product
            </button>
        </div>
        <div class="page-body animate-in">
            <div class="card">
                <div id="products-list">
                    <div class="page-loading"><div class="spinner"></div> Loading products...</div>
                </div>
            </div>
        </div>
    `;

    loadProducts();
}

async function loadProducts() {
    try {
        try {
            const result = await api('/api/products');
            state.products = result.data || [];
            saveLocalData('products', state.products);
        } catch (e) {
            console.warn('Products API unavailable, using local data:', e.message);
            if (state.products.length === 0) {
                state.products = loadLocalData('products') || [];
            }
        }
        renderProductsList();
    } catch (error) {
        showToast('Failed to load products', 'error');
    }
}

function renderProductsList() {
    const container = document.getElementById('products-list');
    if (!container) return;

    if (state.products.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-title">No products yet</div>
                <div class="empty-state-text">Add products or services to include them in invoices</div>
                <button class="btn btn-primary" onclick="openProductModal()">Add Product</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Price</th>
                        <th>Unit</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.products.map(p => `
                        <tr>
                            <td class="name-cell">${escapeHtml(p.name)}</td>
                            <td>${escapeHtml(p.description || '—')}</td>
                            <td class="font-bold">${formatCurrency(p.price)}</td>
                            <td>${escapeHtml(p.unit || 'piece')}</td>
                            <td>
                                <div class="flex gap-sm">
                                    <button class="btn btn-secondary btn-sm" onclick="openProductModal('${p.id}')">Edit</button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openProductModal(productId = null) {
    const product = productId ? state.products.find(p => p.id === productId) : null;
    const title = product ? 'Edit Product' : 'Add Product';

    const html = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3 class="modal-title">${title}</h3>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="product-form" onsubmit="saveProduct(event, '${productId || ''}')">
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Name *</label>
                                <input type="text" class="form-input" id="prod-name" value="${escapeHtml(product?.name || '')}" required placeholder="Product name">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Price *</label>
                                <input type="number" class="form-input" id="prod-price" value="${product?.price || ''}" required step="0.01" min="0" placeholder="0.00">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Unit</label>
                                <select class="form-select" id="prod-unit">
                                    <option value="piece" ${product?.unit === 'piece' ? 'selected' : ''}>Piece</option>
                                    <option value="hour" ${product?.unit === 'hour' ? 'selected' : ''}>Hour</option>
                                    <option value="kg" ${product?.unit === 'kg' ? 'selected' : ''}>Kilogram</option>
                                    <option value="meter" ${product?.unit === 'meter' ? 'selected' : ''}>Meter</option>
                                    <option value="liter" ${product?.unit === 'liter' ? 'selected' : ''}>Liter</option>
                                    <option value="service" ${product?.unit === 'service' ? 'selected' : ''}>Service</option>
                                    <option value="project" ${product?.unit === 'project' ? 'selected' : ''}>Project</option>
                                </select>
                            </div>
                            <div class="form-group full-width">
                                <label class="form-label">Description</label>
                                <textarea class="form-textarea" id="prod-description" placeholder="Product description">${escapeHtml(product?.description || '')}</textarea>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                            <button type="submit" class="btn btn-primary">${product ? 'Update' : 'Add'} Product</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-container').innerHTML = html;
}

async function saveProduct(event, productId) {
    event.preventDefault();

    const data = {
        name: document.getElementById('prod-name').value,
        description: document.getElementById('prod-description').value || null,
        price: parseFloat(document.getElementById('prod-price').value),
        unit: document.getElementById('prod-unit').value,
    };

    try {
        if (productId) {
            try {
                await api(`/api/products/${productId}`, 'PUT', data);
            } catch (e) {
                console.warn('API save failed, updating locally:', e.message);
                const idx = state.products.findIndex(p => p.id === productId);
                if (idx !== -1) state.products[idx] = { ...state.products[idx], ...data };
            }
            showToast('Product updated!', 'success');
        } else {
            try {
                const result = await api('/api/products', 'POST', data);
                state.products.unshift(result.data);
            } catch (e) {
                console.warn('API save failed, saving locally:', e.message);
                data.id = generateId();
                data.created_at = new Date().toISOString();
                state.products.unshift(data);
            }
            showToast('Product added!', 'success');
        }

        saveLocalData('products', state.products);
        closeModal();
        renderProductsList();
    } catch (error) {
        showToast('Failed to save product', 'error');
    }
}

async function deleteProduct(productId) {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
        try {
            await api(`/api/products/${productId}`, 'DELETE');
        } catch (e) {
            console.warn('API delete failed, deleting locally:', e.message);
        }
        state.products = state.products.filter(p => p.id !== productId);
        saveLocalData('products', state.products);
        renderProductsList();
        showToast('Product deleted', 'success');
    } catch (error) {
        showToast('Failed to delete product', 'error');
    }
}

// ============================================
// Invoices Page
// ============================================
function renderInvoices(container) {
    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Invoices</h1>
                <p class="page-subtitle">Create and manage your invoices</p>
            </div>
            <button class="btn btn-primary" id="create-invoice-btn" onclick="openInvoiceModal()">
                <span>+</span> Create Invoice
            </button>
        </div>
        <div class="page-body animate-in">
            <div class="card">
                <div id="invoices-list">
                    <div class="page-loading"><div class="spinner"></div> Loading invoices...</div>
                </div>
            </div>
        </div>
    `;

    loadInvoices();
}

async function loadInvoices() {
    try {
        try {
            const result = await api('/api/invoices');
            state.invoices = result.data || [];
            saveLocalData('invoices', state.invoices);
        } catch (e) {
            console.warn('Invoices API unavailable, using local data:', e.message);
            if (state.invoices.length === 0) {
                state.invoices = loadLocalData('invoices') || [];
            }
        }
        renderInvoicesList();
    } catch (error) {
        showToast('Failed to load invoices', 'error');
    }
}

function renderInvoicesList() {
    const container = document.getElementById('invoices-list');
    if (!container) return;

    if (state.invoices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🧾</div>
                <div class="empty-state-title">No invoices yet</div>
                <div class="empty-state-text">Create your first invoice to start billing</div>
                <button class="btn btn-primary" onclick="openInvoiceModal()">Create Invoice</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Invoice #</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th>Due Date</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.invoices.map(inv => `
                        <tr>
                            <td class="name-cell" style="cursor:pointer" onclick="viewInvoice('${inv.id}')">${escapeHtml(inv.invoice_number)}</td>
                            <td>${escapeHtml(inv.customers?.name || inv._customer_name || '—')}</td>
                            <td>${formatDate(inv.date)}</td>
                            <td>${inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                            <td class="font-bold">${formatCurrency(inv.total)}</td>
                            <td><span class="badge badge-${inv.status}">${inv.status}</span></td>
                            <td>
                                <div class="flex gap-sm">
                                    <button class="btn btn-secondary btn-sm" onclick="viewInvoice('${inv.id}')">View</button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteInvoice('${inv.id}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openInvoiceModal() {
    invoiceItemCount = 0;  // Reset counter on modal open
    const today = new Date().toISOString().split('T')[0];
    const invoiceNumber = 'INV-' + Date.now().toString(36).toUpperCase();

    const customerOptions = state.customers.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join('');

    const productOptions = state.products.map(p =>
        `<option value="${p.id}" data-price="${p.price}">${escapeHtml(p.name)} (${formatCurrency(p.price)})</option>`
    ).join('');

    const html = `
        <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal modal-lg" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3 class="modal-title">Create Invoice</h3>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="invoice-form" onsubmit="saveInvoice(event)">
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Invoice Number *</label>
                                <input type="text" class="form-input" id="inv-number" value="${invoiceNumber}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Customer</label>
                                <select class="form-select" id="inv-customer">
                                    <option value="">Select customer</option>
                                    ${customerOptions}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Date *</label>
                                <input type="date" class="form-input" id="inv-date" value="${today}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Due Date</label>
                                <input type="date" class="form-input" id="inv-due-date">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Status</label>
                                <select class="form-select" id="inv-status">
                                    <option value="draft">Draft</option>
                                    <option value="sent">Sent</option>
                                    <option value="paid">Paid</option>
                                    <option value="overdue">Overdue</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Tax Rate (%)</label>
                                <input type="number" class="form-input" id="inv-tax" value="18" step="0.01" min="0" onchange="calculateInvoiceTotal()">
                            </div>
                        </div>

                        <div style="margin-top: var(--space-xl);">
                            <div class="invoice-items-header">
                                <h4 style="color: var(--text-primary); font-weight: 600;">Line Items</h4>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="addInvoiceItem()">+ Add Item</button>
                            </div>
                            
                            <div style="font-size: var(--font-xs); color: var(--text-muted); display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: var(--space-md); padding: var(--space-sm) 0;">
                                <span>Description</span>
                                <span>Qty</span>
                                <span>Price</span>
                                <span>Amount</span>
                                <span></span>
                            </div>
                            <div id="invoice-items-container"></div>

                            <div class="invoice-totals">
                                <div class="invoice-total-row">
                                    <span class="label">Subtotal</span>
                                    <span class="value" id="inv-subtotal">₹0.00</span>
                                </div>
                                <div class="invoice-total-row">
                                    <span class="label">Tax (<span id="inv-tax-label">18</span>%)</span>
                                    <span class="value" id="inv-tax-amount">₹0.00</span>
                                </div>
                                <div class="invoice-total-row">
                                    <span class="label">Discount</span>
                                    <span class="value">
                                        <input type="number" class="form-input" id="inv-discount" value="0" step="0.01" min="0" style="width: 100px; padding: 4px 8px; text-align: right;" onchange="calculateInvoiceTotal()">
                                    </span>
                                </div>
                                <div class="invoice-total-row grand-total">
                                    <span class="label">Total</span>
                                    <span class="value" id="inv-total">₹0.00</span>
                                </div>
                            </div>
                        </div>

                        <div class="form-group full-width" style="margin-top: var(--space-xl);">
                            <label class="form-label">Notes</label>
                            <textarea class="form-textarea" id="inv-notes" placeholder="Payment terms, thank you note, etc."></textarea>
                        </div>

                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                            <button type="submit" class="btn btn-primary">Create Invoice</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-container').innerHTML = html;

    // Add first item
    addInvoiceItem();
}

let invoiceItemCount = 0;

function addInvoiceItem() {
    const container = document.getElementById('invoice-items-container');
    const idx = invoiceItemCount++;

    const productOptions = state.products.map(p =>
        `<option value="${p.id}" data-price="${p.price}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`
    ).join('');

    const row = document.createElement('div');
    row.className = 'invoice-item-row';
    row.id = `item-row-${idx}`;
    row.innerHTML = `
        <div class="form-group">
            <select class="form-select" onchange="selectProduct(this, ${idx})" style="margin-bottom: 4px; padding: 6px 8px; font-size: 12px;">
                <option value="">Pick product...</option>
                ${productOptions}
            </select>
            <input type="text" class="form-input" id="item-desc-${idx}" placeholder="Item description" required>
        </div>
        <div class="form-group">
            <input type="number" class="form-input" id="item-qty-${idx}" value="1" min="0.01" step="0.01" onchange="calculateInvoiceTotal()">
        </div>
        <div class="form-group">
            <input type="number" class="form-input" id="item-price-${idx}" value="0" min="0" step="0.01" onchange="calculateInvoiceTotal()">
        </div>
        <div class="form-group">
            <input type="text" class="form-input" id="item-amount-${idx}" value="₹0.00" readonly style="background: transparent; border-color: transparent; font-weight: 600;">
        </div>
        <div>
            <button type="button" class="btn btn-danger btn-icon btn-sm" onclick="removeInvoiceItem(${idx})">✕</button>
        </div>
    `;

    container.appendChild(row);
}

function selectProduct(select, idx) {
    const option = select.options[select.selectedIndex];
    const price = option.dataset.price || 0;
    const name = option.dataset.name || '';

    document.getElementById(`item-desc-${idx}`).value = name;
    document.getElementById(`item-price-${idx}`).value = price;

    calculateInvoiceTotal();
}

function removeInvoiceItem(idx) {
    const row = document.getElementById(`item-row-${idx}`);
    if (row) {
        row.remove();
        calculateInvoiceTotal();
    }
}

function calculateInvoiceTotal() {
    const container = document.getElementById('invoice-items-container');
    if (!container) return;

    const rows = container.querySelectorAll('.invoice-item-row');
    let subtotal = 0;

    rows.forEach(row => {
        const idx = row.id.replace('item-row-', '');
        const qty = parseFloat(document.getElementById(`item-qty-${idx}`)?.value || 0);
        const price = parseFloat(document.getElementById(`item-price-${idx}`)?.value || 0);
        const amount = qty * price;

        const amountEl = document.getElementById(`item-amount-${idx}`);
        if (amountEl) amountEl.value = formatCurrency(amount);

        subtotal += amount;
    });

    const taxRate = parseFloat(document.getElementById('inv-tax')?.value || 0);
    const discount = parseFloat(document.getElementById('inv-discount')?.value || 0);
    const taxAmount = subtotal * taxRate / 100;
    const total = subtotal + taxAmount - discount;

    const subtotalEl = document.getElementById('inv-subtotal');
    const taxLabelEl = document.getElementById('inv-tax-label');
    const taxAmountEl = document.getElementById('inv-tax-amount');
    const totalEl = document.getElementById('inv-total');

    if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
    if (taxLabelEl) taxLabelEl.textContent = taxRate;
    if (taxAmountEl) taxAmountEl.textContent = formatCurrency(taxAmount);
    if (totalEl) totalEl.textContent = formatCurrency(total);
}

async function saveInvoice(event) {
    event.preventDefault();

    // Collect items
    const container = document.getElementById('invoice-items-container');
    const rows = container.querySelectorAll('.invoice-item-row');
    const items = [];

    rows.forEach(row => {
        const idx = row.id.replace('item-row-', '');
        const desc = document.getElementById(`item-desc-${idx}`)?.value;
        const qty = parseFloat(document.getElementById(`item-qty-${idx}`)?.value || 0);
        const price = parseFloat(document.getElementById(`item-price-${idx}`)?.value || 0);

        if (desc && qty > 0) {
            items.push({
                description: desc,
                quantity: qty,
                unit_price: price,
                product_id: null // Could map from select
            });
        }
    });

    const customerId = document.getElementById('inv-customer').value || null;
    const customerName = customerId ?
        document.getElementById('inv-customer').options[document.getElementById('inv-customer').selectedIndex].text : null;

    const data = {
        invoice_number: document.getElementById('inv-number').value,
        customer_id: customerId,
        date: document.getElementById('inv-date').value,
        due_date: document.getElementById('inv-due-date').value || null,
        status: document.getElementById('inv-status').value,
        tax_rate: parseFloat(document.getElementById('inv-tax').value || 0),
        discount: parseFloat(document.getElementById('inv-discount').value || 0),
        notes: document.getElementById('inv-notes').value || null,
        items: items,
    };

    try {
        let invoiceRecord;
        try {
            const result = await api('/api/invoices', 'POST', data);
            invoiceRecord = result.data;
        } catch (e) {
            console.warn('API save failed, creating locally:', e.message);
            // Fallback: create locally
            const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
            const taxAmount = subtotal * data.tax_rate / 100;
            const total = subtotal + taxAmount - data.discount;

            invoiceRecord = {
                id: generateId(),
                ...data,
                subtotal: subtotal,
                tax_amount: taxAmount,
                total: total,
                created_at: new Date().toISOString(),
                _items: items,
                _customer_name: customerName,
                customers: customerName ? { name: customerName } : null
            };
            showToast('Saved locally — will sync when online', 'info');
        }

        state.invoices.unshift(invoiceRecord);
        saveLocalData('invoices', state.invoices);
        closeModal();
        renderInvoicesList();
        showToast('Invoice created!', 'success');
    } catch (error) {
        showToast('Failed to create invoice', 'error');
    }
}

async function deleteInvoice(invoiceId) {
    if (!confirm('Are you sure you want to delete this invoice?')) return;

    try {
        try {
            await api(`/api/invoices/${invoiceId}`, 'DELETE');
        } catch (e) {
            console.warn('API delete failed, deleting locally:', e.message);
        }
        state.invoices = state.invoices.filter(i => i.id !== invoiceId);
        saveLocalData('invoices', state.invoices);
        renderInvoicesList();
        showToast('Invoice deleted', 'success');
    } catch (error) {
        showToast('Failed to delete invoice', 'error');
    }
}

// ============================================
// Invoice Detail / Preview
// ============================================
async function viewInvoice(invoiceId) {
    const main = document.getElementById('main-content');
    main.innerHTML = `<div class="page-loading" style="min-height: 400px;"><div class="spinner"></div> Loading invoice...</div>`;

    let invoice;
    try {
        const result = await api(`/api/invoices/${invoiceId}`);
        invoice = result.data;
    } catch (e) {
        // Fallback: find in local state
        invoice = state.invoices.find(i => i.id === invoiceId);
        if (invoice && !invoice.items) {
            invoice.items = invoice._items || [];
        }
    }

    if (!invoice) {
        main.innerHTML = `<div class="page-body"><div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-title">Invoice not found</div></div></div>`;
        return;
    }

    const customer = invoice.customers || {};
    const items = invoice.items || invoice._items || [];

    main.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Invoice ${escapeHtml(invoice.invoice_number)}</h1>
                <p class="page-subtitle">
                    <span class="badge badge-${invoice.status}">${invoice.status}</span>
                </p>
            </div>
            <div class="flex gap-md">
                <button class="btn btn-secondary" onclick="navigateTo('invoices')">← Back</button>
                <button class="btn btn-primary" onclick="printInvoice()">🖨️ Print</button>
            </div>
        </div>
        <div class="page-body animate-in">
            <div class="invoice-preview" id="invoice-print-area">
                <div class="inv-header">
                    <div>
                        <div class="inv-brand">BillSoft</div>
                        <div style="color: #6b7280; font-size: 0.875rem; margin-top: 4px;">${state.user?.name || ''}<br>${state.user?.email || ''}</div>
                    </div>
                    <div class="inv-info">
                        <div class="inv-number">${escapeHtml(invoice.invoice_number)}</div>
                        <div class="inv-date">Date: ${formatDate(invoice.date)}</div>
                        ${invoice.due_date ? `<div class="inv-date">Due: ${formatDate(invoice.due_date)}</div>` : ''}
                    </div>
                </div>

                <div class="inv-parties">
                    <div>
                        <div class="inv-party-label">From</div>
                        <div class="inv-party-name">${escapeHtml(state.user?.name || 'Your Business')}</div>
                        <div class="inv-party-detail">${escapeHtml(state.user?.email || '')}</div>
                    </div>
                    <div>
                        <div class="inv-party-label">Bill To</div>
                        <div class="inv-party-name">${escapeHtml(customer.name || '—')}</div>
                        <div class="inv-party-detail">${escapeHtml(customer.email || '')}</div>
                        ${customer.phone ? `<div class="inv-party-detail">${escapeHtml(customer.phone)}</div>` : ''}
                        ${customer.address ? `<div class="inv-party-detail">${escapeHtml(customer.address)}</div>` : ''}
                        ${customer.city ? `<div class="inv-party-detail">${escapeHtml(customer.city)}${customer.state ? ', ' + escapeHtml(customer.state) : ''} ${escapeHtml(customer.zip_code || '')}</div>` : ''}
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th style="text-align: left">Description</th>
                            <th style="text-align: right">Qty</th>
                            <th style="text-align: right">Price</th>
                            <th style="text-align: right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.length > 0 ? items.map(item => `
                            <tr>
                                <td>${escapeHtml(item.description)}</td>
                                <td style="text-align: right">${item.quantity}</td>
                                <td style="text-align: right">${formatCurrency(item.unit_price)}</td>
                                <td style="text-align: right">${formatCurrency(item.amount || item.quantity * item.unit_price)}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="4" style="text-align: center; color: #9ca3af;">No line items</td></tr>'}
                    </tbody>
                </table>

                <div class="inv-totals">
                    <div class="inv-totals-table">
                        <div class="row">
                            <span>Subtotal</span>
                            <span>${formatCurrency(invoice.subtotal)}</span>
                        </div>
                        <div class="row">
                            <span>Tax (${invoice.tax_rate}%)</span>
                            <span>${formatCurrency(invoice.tax_amount)}</span>
                        </div>
                        ${parseFloat(invoice.discount) > 0 ? `
                        <div class="row">
                            <span>Discount</span>
                            <span>-${formatCurrency(invoice.discount)}</span>
                        </div>` : ''}
                        <div class="row total">
                            <span>Total</span>
                            <span>${formatCurrency(invoice.total)}</span>
                        </div>
                    </div>
                </div>

                ${invoice.notes ? `
                <div class="inv-notes">
                    <strong>Notes:</strong><br>
                    ${escapeHtml(invoice.notes)}
                </div>` : ''}
            </div>
        </div>
    `;
}

function printInvoice() {
    const printArea = document.getElementById('invoice-print-area');
    if (!printArea) return;

    // Collect all stylesheets inline so print works on any URL
    let embeddedCSS = '';
    for (const sheet of document.styleSheets) {
        try {
            for (const rule of sheet.cssRules) {
                embeddedCSS += rule.cssText + '\n';
            }
        } catch (e) {
            // Cross-origin sheets can't be read; skip them
        }
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Invoice</title>
            <style>
                ${embeddedCSS}
                body { background: white; padding: 20px; }
                .invoice-preview { box-shadow: none; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>${printArea.outerHTML}</body>
        </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
}

// ============================================
// Modal Helpers
// ============================================
function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modal-container').innerHTML = '';
    invoiceItemCount = 0;
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');

    const icons = { success: '✓', error: '✕', info: 'ℹ' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ============================================
// Utility Functions
// ============================================
function formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function generateId() {
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

// ============================================
// Offline Detection
// ============================================
function initOfflineDetection() {
    const banner = document.getElementById('offline-banner');

    function setOffline() {
        state.isOffline = true;
        if (banner) banner.classList.remove('hidden');
    }

    function setOnline() {
        state.isOffline = false;
        if (banner) banner.classList.add('hidden');
        showToast('Back online — refreshing data', 'success');
        // Re-render current page to re-fetch from API
        if (state.user) renderPage(state.currentPage);
    }

    window.addEventListener('offline', setOffline);
    window.addEventListener('online', setOnline);

    // Set initial state
    if (!navigator.onLine) setOffline();
}

// ============================================
// Initialize App
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initLocalState();
    initOfflineDetection();
    initGoogleAuth();
    checkSession();
});

// Also try initializing when Google SDK loads
window.onload = () => {
    initGoogleAuth();
};
