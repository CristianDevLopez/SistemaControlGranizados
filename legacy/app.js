/**
 * Granizados Dexter - POS Prototype
 * Vanilla JS logic for UI interactions and mock data management.
 */

// --- MOCK DATA GENERATION & INIT ---
const INITIAL_DATA = {
    users: [
        { id: 1, name: "Carlos Rodríguez", role: "Vendedor", status: "Activo" },
        { id: 2, name: "Laura Gómez", role: "Vendedor", status: "Activo" },
        { id: 3, name: "Daniel Pérez", role: "Administrador", status: "Activo" }
    ],
    currentUser: 1,
    products: [
        { id: 1, name: "Fresa", basePrice: 8000, flavorId: "Fresa", active: true },
        { id: 2, name: "Mango", basePrice: 8000, flavorId: "Mango", active: true },
        { id: 3, name: "Maracuyá", basePrice: 8000, flavorId: "Maracuyá", active: true },
        { id: 4, name: "Mora", basePrice: 8000, flavorId: "Mora", active: true },
        { id: 5, name: "Limón", basePrice: 8000, flavorId: "Limón", active: true },
        { id: 6, name: "Cereza", basePrice: 8000, flavorId: "Cereza", active: true }
    ],
    options: {
        sizes: [
            { id: "size_p", name: "Pequeño", price: 0, inventoryKey: "vasos_p" },
            { id: "size_m", name: "Mediano", price: 2000, inventoryKey: "vasos_m" },
            { id: "size_g", name: "Grande", price: 4000, inventoryKey: "vasos_g" }
        ],
        toppings: [
            { id: "top_gomitas", name: "Gomitas", price: 1000, inventoryKey: "gomitas", qty: 30 },
            { id: "top_fruta", name: "Fruta", price: 1500, inventoryKey: "fruta", qty: 50 },
            { id: "top_chispas", name: "Chispas", price: 800, inventoryKey: "chispas", qty: 20 },
            { id: "top_leche", name: "Leche condensada", price: 1000, inventoryKey: "leche_condensada", qty: 30 },
            { id: "top_choco", name: "Salsa de chocolate", price: 1000, inventoryKey: "salsa_chocolate", qty: 30 },
            { id: "top_crema", name: "Crema", price: 1000, inventoryKey: "crema", qty: 40 }
        ]
    },
    inventory: [
        { id: "jarabe_Fresa", name: "Jarabe de Fresa", category: "Jarabes", stock: 2500, unit: "ml", min: 1000 },
        { id: "jarabe_Mango", name: "Jarabe de Mango", category: "Jarabes", stock: 1200, unit: "ml", min: 1000 },
        { id: "jarabe_Maracuyá", name: "Jarabe de Maracuyá", category: "Jarabes", stock: 800, unit: "ml", min: 1000 },
        { id: "jarabe_Mora", name: "Jarabe de Mora", category: "Jarabes", stock: 2000, unit: "ml", min: 1000 },
        { id: "jarabe_Limón", name: "Jarabe de Limón", category: "Jarabes", stock: 500, unit: "ml", min: 1000 },
        { id: "jarabe_Cereza", name: "Jarabe de Cereza", category: "Jarabes", stock: 1500, unit: "ml", min: 1000 },
        { id: "hielo", name: "Hielo", category: "Base", stock: 15000, unit: "g", min: 5000 },
        { id: "vasos_p", name: "Vasos Pequeños", category: "Empaque", stock: 150, unit: "un", min: 50 },
        { id: "vasos_m", name: "Vasos Medianos", category: "Empaque", stock: 100, unit: "un", min: 50 },
        { id: "vasos_g", name: "Vasos Grandes", category: "Empaque", stock: 10, unit: "un", min: 50 },
        { id: "gomitas", name: "Gomitas", category: "Toppings", stock: 2200, unit: "g", min: 3000 },
        { id: "fruta", name: "Fruta", category: "Toppings", stock: 1500, unit: "g", min: 1000 },
        { id: "chispas", name: "Chispas", category: "Toppings", stock: 500, unit: "g", min: 300 },
        { id: "leche_condensada", name: "Leche condensada", category: "Toppings", stock: 2000, unit: "ml", min: 1000 },
        { id: "salsa_chocolate", name: "Salsa de chocolate", category: "Toppings", stock: 1500, unit: "ml", min: 1000 },
        { id: "crema", name: "Crema", category: "Toppings", stock: 0, unit: "g", min: 500 }
    ],
    sales: []
};

// Generate Mock Sales Data
function generateMockSales() {
    const sales = [];
    let saleId = 1000;
    const now = new Date();
    
    // Generate 200 mock sales
    for (let i = 0; i < 200; i++) {
        let date;
        if (i < 45) {
            // Guarantee 45 sales for "Today" so the metrics look great by default
            date = new Date(now.getTime() - Math.random() * 12 * 60 * 60 * 1000); // last 12 hours
        } else if (i < 100) {
            // 55 sales in the last 7 days
            date = new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000);
        } else {
            // 100 sales in the rest of the 30 days
            date = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
        }

        const productsCount = Math.floor(Math.random() * 3) + 1; // 1 to 3 products per sale
        let total = 0;
        const items = [];
        
        for (let p = 0; p < productsCount; p++) {
            const baseProd = INITIAL_DATA.products[Math.floor(Math.random() * INITIAL_DATA.products.length)];
            const size = INITIAL_DATA.options.sizes[Math.floor(Math.random() * INITIAL_DATA.options.sizes.length)];
            
            let itemTotal = baseProd.basePrice + size.price;
            const itemToppings = [];
            
            // Random toppings
            if (Math.random() > 0.4) {
                const numTops = Math.floor(Math.random() * 3) + 1;
                for (let t = 0; t < numTops; t++) {
                    const top = INITIAL_DATA.options.toppings[Math.floor(Math.random() * INITIAL_DATA.options.toppings.length)];
                    if (!itemToppings.find(it => it.id === top.id)) {
                        itemToppings.push(top);
                        itemTotal += top.price;
                    }
                }
            }
            
            const qty = Math.floor(Math.random() * 2) + 1;
            total += (itemTotal * qty);
            
            items.push({
                product: baseProd,
                size: size,
                toppings: itemToppings,
                unitPrice: itemTotal,
                quantity: qty,
                total: itemTotal * qty
            });
        }
        
        sales.push({
            id: `0${saleId++}`,
            date: date.toISOString(),
            userId: Math.random() > 0.5 ? 1 : 2,
            items: items,
            total: total,
            status: "Completada"
        });
    }
    // Sort descending
    return sales.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// --- STATE MANAGEMENT ---
let appData = {};
let cart = [];
let currentProductConfig = null; // Holds data for modal

function initApp() {
    const saved = localStorage.getItem('dexter_data_v3'); // bumped version to clear old data
    if (saved) {
        appData = JSON.parse(saved);
    } else {
        appData = JSON.parse(JSON.stringify(INITIAL_DATA));
        appData.sales = generateMockSales();
        saveData();
    }
    
    setupEventListeners();
    updateUserUI();
    renderProductsPos();
    renderInventory();
    renderSales();
    renderProductsAdmin();
    renderUsers();
    updateAlerts();
}

function saveData() {
    localStorage.setItem('dexter_data_v3', JSON.stringify(appData));
}

function formatMoney(amount) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(isoString) {
    const d = new Date(isoString);
    const today = new Date();
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    
    const timeStr = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Hoy · ${timeStr}`;
    return `${d.toLocaleDateString('es-CO')} · ${timeStr}`;
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    
    const iconPath = type === 'success' 
        ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>'
        : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none">${iconPath}</svg>
        </div>
        <div class="toast-msg">${msg}</div>
    `;
    
    container.appendChild(toast);
    
    // Trigger reflow
    void toast.offsetWidth;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- EVENT LISTENERS SETUP ---
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.currentTarget.getAttribute('data-target');
            if(target) switchView(target, e.currentTarget);
        });
    });

    // Mobile Menu Toggle
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    if(mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
        
        // Close sidebar when clicking a nav item on mobile
        document.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', () => {
                if(window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                }
            });
        });
    }

    // Modals Close
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // Cart Actions
    document.getElementById('btn-clear-cart').addEventListener('click', () => {
        if(confirm('¿Vaciar pedido actual?')) {
            cart = [];
            renderCart();
        }
    });

    document.getElementById('btn-checkout').addEventListener('click', openCheckoutModal);
    document.getElementById('btn-confirm-sale').addEventListener('click', processSale);
    
    // Config Modal Add To Cart
    document.getElementById('btn-add-to-cart').addEventListener('click', addToCart);

    // User Switcher
    const roleSwitcher = document.getElementById('role-switcher');
    roleSwitcher.addEventListener('change', (e) => {
        appData.currentUser = parseInt(e.target.value);
        saveData();
        updateUserUI();
        // Reset to home if on admin view
        const currentView = document.querySelector('.view.active').id;
        if(appData.users.find(u => u.id === appData.currentUser).role !== 'Administrador' && 
           ['view-products', 'view-metrics', 'view-users'].includes(currentView)) {
            switchView('view-new-sale', document.querySelector('[data-target="view-new-sale"]'));
        }
    });

    // Filter/Search inputs
    document.getElementById('search-inventory').addEventListener('input', renderInventory);
    document.getElementById('filter-inventory-status').addEventListener('change', renderInventory);
    document.getElementById('search-sales').addEventListener('input', renderSales);
    document.getElementById('filter-sales-date').addEventListener('change', renderSales);
    document.getElementById('filter-metrics-date').addEventListener('change', renderMetrics);
    
    document.getElementById('header-alerts-btn').addEventListener('click', () => {
        switchView('view-alerts', document.querySelector('[data-target="view-alerts"]'));
    });
}

function switchView(viewId, navElement) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const targetView = document.getElementById(viewId);
    targetView.classList.remove('hidden');
    // small delay for animation
    setTimeout(() => targetView.classList.add('active'), 10);
    
    if (navElement) {
        navElement.classList.add('active');
        document.getElementById('current-view-title').textContent = navElement.textContent.trim();
    }
    
    // Refresh data on specific views
    if (viewId === 'view-metrics') renderMetrics();
    if (viewId === 'view-sales') renderSales();
    if (viewId === 'view-inventory') renderInventory();
}

function openModal(modalId) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.querySelectorAll('.modal-content').forEach(m => m.classList.add('hidden'));
    document.getElementById(modalId).classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

function updateUserUI() {
    const user = appData.users.find(u => u.id === appData.currentUser);
    document.getElementById('current-user-name').textContent = user.name;
    document.getElementById('current-user-role').textContent = user.role;
    document.getElementById('current-user-avatar').textContent = user.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    
    // Populate switcher
    const switcher = document.getElementById('role-switcher');
    switcher.innerHTML = appData.users.map(u => `<option value="${u.id}" ${u.id === user.id ? 'selected' : ''}>${u.name} (${u.role})</option>`).join('');
    
    // Admin links
    const adminLinks = document.querySelector('.admin-only');
    if (user.role === 'Administrador') {
        adminLinks.classList.remove('hidden');
    } else {
        adminLinks.classList.add('hidden');
    }
}

// --- POS (NEW SALE) LOGIC ---
function renderProductsPos() {
    const container = document.getElementById('pos-products-grid');
    container.innerHTML = appData.products.filter(p => p.active).map(p => `
        <div class="product-card" onclick="openProductConfig(${p.id})">
            <div class="product-icon">
                <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="2" fill="none"><path d="M5 2h14l-2 9H7L5 2z"></path><path d="M7 11v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9"></path><line x1="12" y1="2" x2="12" y2="22"></line><line x1="12" y1="2" x2="16" y2="-2"></line></svg>
            </div>
            <div class="product-info">
                <div class="product-name">${p.name}</div>
                <div class="product-price">Desde ${formatMoney(p.basePrice)}</div>
            </div>
        </div>
    `).join('');
}

window.openProductConfig = function(productId) {
    const product = appData.products.find(p => p.id === productId);
    
    // Initialize config state. Flavor is implicit from the product selected.
    currentProductConfig = {
        product: product,
        size: appData.options.sizes[0], // default size
        toppings: []
    };
    
    document.getElementById('config-product-name').textContent = `Granizado de ${product.name}`;
    
    renderConfigOptions();
    updateConfigPrice();
    openModal('modal-product-config');
}

function renderConfigOptions() {
    // Sizes (Single select)
    document.getElementById('config-sizes').innerHTML = appData.options.sizes.map(s => `
        <div class="pill ${currentProductConfig.size.id === s.id ? 'selected' : ''}" onclick="selectSize('${s.id}')">
            <span>${s.name}</span>
            <span class="pill-price">${s.price > 0 ? '+'+formatMoney(s.price) : 'Incluido'}</span>
        </div>
    `).join('');
    
    // Toppings (Multi select)
    document.getElementById('config-toppings').innerHTML = appData.options.toppings.map(t => {
        const isSelected = currentProductConfig.toppings.some(ct => ct.id === t.id);
        return `
        <div class="pill ${isSelected ? 'selected' : ''}" onclick="toggleTopping('${t.id}')">
            <span>${t.name}</span>
            <span class="pill-price">+${formatMoney(t.price)}</span>
        </div>
        `;
    }).join('');
}

window.selectSize = function(sizeId) {
    currentProductConfig.size = appData.options.sizes.find(s => s.id === sizeId);
    renderConfigOptions();
    updateConfigPrice();
}

window.toggleTopping = function(toppingId) {
    const topping = appData.options.toppings.find(t => t.id === toppingId);
    const index = currentProductConfig.toppings.findIndex(t => t.id === toppingId);
    
    if (index === -1) {
        currentProductConfig.toppings.push(topping);
    } else {
        currentProductConfig.toppings.splice(index, 1);
    }
    renderConfigOptions();
    updateConfigPrice();
}

function updateConfigPrice() {
    let total = currentProductConfig.product.basePrice + currentProductConfig.size.price;
    currentProductConfig.toppings.forEach(t => total += t.price);
    document.getElementById('config-total-price').textContent = formatMoney(total);
    
    const btn = document.getElementById('btn-add-to-cart');
    btn.disabled = false;
}

function addToCart() {
    let unitPrice = currentProductConfig.product.basePrice + currentProductConfig.size.price;
    currentProductConfig.toppings.forEach(t => unitPrice += t.price);
    
    // Generate unique ID for cart item
    const cartItemId = Date.now().toString();
    
    cart.push({
        cartId: cartItemId,
        product: currentProductConfig.product,
        size: currentProductConfig.size,
        toppings: [...currentProductConfig.toppings],
        unitPrice: unitPrice,
        quantity: 1,
        total: unitPrice
    });
    
    closeModal();
    renderCart();
    showToast("Producto agregado al pedido");
}

function renderCart() {
    const container = document.getElementById('cart-items-container');
    const btnCheckout = document.getElementById('btn-checkout');
    let subtotal = 0;
    
    if (cart.length === 0) {
        container.innerHTML = `
        <div class="empty-cart-msg">
            <div class="empty-icon">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
            </div>
            <p>Selecciona un producto para comenzar</p>
        </div>`;
        document.getElementById('cart-subtotal').textContent = '$0';
        document.getElementById('cart-total').textContent = '$0';
        btnCheckout.disabled = true;
        return;
    }
    
    container.innerHTML = cart.map(item => {
        subtotal += item.total;
        const details = [item.size.name, ...item.toppings.map(t=>t.name)].join(' · ');
        
        return `
        <div class="cart-item">
            <button class="btn-remove-item" onclick="removeFromCart('${item.cartId}')" title="Eliminar">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="cart-item-header">
                <span>Granizado de ${item.product.name}</span>
            </div>
            <div class="cart-item-details">${details || 'Sin toppings adicionales'}</div>
            <div class="cart-item-actions">
                <div class="qty-control">
                    <button class="qty-btn" onclick="updateCartQty('${item.cartId}', -1)">-</button>
                    <span class="qty-val">${item.quantity}</span>
                    <button class="qty-btn" onclick="updateCartQty('${item.cartId}', 1)">+</button>
                </div>
                <div class="cart-item-price">${formatMoney(item.total)}</div>
            </div>
        </div>
        `;
    }).join('');
    
    document.getElementById('cart-subtotal').textContent = formatMoney(subtotal);
    document.getElementById('cart-total').textContent = formatMoney(subtotal);
    btnCheckout.disabled = false;
}

window.updateCartQty = function(cartId, delta) {
    const item = cart.find(i => i.cartId === cartId);
    if (!item) return;
    
    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(cartId);
        return;
    }
    
    item.total = item.quantity * item.unitPrice;
    renderCart();
}

window.removeFromCart = function(cartId) {
    cart = cart.filter(i => i.cartId !== cartId);
    renderCart();
}

// --- CHECKOUT LOGIC ---
function openCheckoutModal() {
    const total = cart.reduce((sum, item) => sum + item.total, 0);
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    document.getElementById('checkout-total-amount').textContent = formatMoney(total);
    document.getElementById('checkout-items-count').textContent = `${count} producto(s)`;
    
    document.getElementById('checkout-details-list').innerHTML = cart.map(item => 
        `<div class="flex-between text-sm text-muted mt-2">
            <span>${item.quantity}x de ${item.product.name} (${item.size.name})</span>
            <span class="font-medium" style="color: var(--text-main);">${formatMoney(item.total)}</span>
        </div>`
    ).join('');
    
    openModal('modal-checkout');
}

function processSale() {
    // 1. Generate Sale
    const total = cart.reduce((sum, item) => sum + item.total, 0);
    const saleId = `00${appData.sales.length + 101}`;
    
    const newSale = {
        id: saleId,
        date: new Date().toISOString(),
        userId: appData.currentUser,
        items: JSON.parse(JSON.stringify(cart)), // Deep copy
        total: total,
        status: "Completada"
    };
    
    // 2. Deduct Inventory
    cart.forEach(item => {
        // Base deduct (Ice and Syrup depending on size)
        let iceQty = 150; let syrupQty = 50;
        if (item.size.id === 'size_m') { iceQty = 200; syrupQty = 70; }
        if (item.size.id === 'size_g') { iceQty = 250; syrupQty = 90; }
        
        deductInventory('hielo', iceQty * item.quantity);
        deductInventory(`jarabe_${item.product.flavorId}`, syrupQty * item.quantity);
        deductInventory(item.size.inventoryKey, 1 * item.quantity);
        
        // Toppings deduct
        item.toppings.forEach(top => {
            deductInventory(top.inventoryKey, top.qty * item.quantity);
        });
    });
    
    // 3. Save
    appData.sales.unshift(newSale); // Add to top
    saveData();
    
    // 4. Update UI
    cart = [];
    renderCart();
    closeModal();
    updateAlerts();
    renderInventory();
    
    showToast(`Venta #${saleId} procesada con éxito`);
}

function deductInventory(itemId, qty) {
    const invItem = appData.inventory.find(i => i.id === itemId);
    if (invItem) {
        invItem.stock -= qty;
        if (invItem.stock < 0) invItem.stock = 0;
    }
}

// --- ALERTS LOGIC ---
function updateAlerts() {
    const alerts = appData.inventory.filter(i => i.stock <= i.min);
    
    // Update Badge
    const badgeSidebar = document.getElementById('sidebar-alert-badge');
    const badgeHeader = document.getElementById('header-alert-badge');
    
    if (alerts.length > 0) {
        badgeSidebar.textContent = alerts.length;
        badgeHeader.textContent = alerts.length;
        badgeSidebar.classList.remove('hidden');
        badgeHeader.classList.remove('hidden');
    } else {
        badgeSidebar.classList.add('hidden');
        badgeHeader.classList.add('hidden');
    }
    
    // Render Alerts View
    const container = document.getElementById('alerts-list');
    if (alerts.length === 0) {
        container.innerHTML = `
        <div class="card text-center" style="padding: 48px;">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" style="color: var(--border-medium); margin-bottom: 16px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <p class="text-muted text-md">No hay alertas de inventario. Todo está en orden.</p>
        </div>`;
        return;
    }
    
    container.innerHTML = alerts.map(item => {
        const isOut = item.stock === 0;
        return `
        <div class="alert-card ${isOut ? 'danger' : 'warning'}">
            <div class="alert-icon">${isOut ? '🔴' : '⚠️'}</div>
            <div class="alert-content">
                <div>
                    <h4>${item.name}</h4>
                    <p>Stock actual: <strong style="color: var(--text-main);">${item.stock} ${item.unit}</strong> | Mínimo ideal: ${item.min} ${item.unit}</p>
                </div>
                <span class="status-badge ${isOut ? 'status-out' : 'status-low'}">
                    ${isOut ? 'Agotado' : 'Stock Bajo'}
                </span>
            </div>
        </div>
        `;
    }).join('');
}

// --- INVENTORY LOGIC ---
function renderInventory() {
    const term = document.getElementById('search-inventory').value.toLowerCase();
    const filter = document.getElementById('filter-inventory-status').value;
    
    let filtered = appData.inventory.filter(i => i.name.toLowerCase().includes(term) || i.category.toLowerCase().includes(term));
    
    if (filter === 'low') {
        filtered = filtered.filter(i => i.stock <= i.min);
    } else if (filter === 'ok') {
        filtered = filtered.filter(i => i.stock > i.min);
    }
    
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = filtered.map(item => {
        let statusClass = 'status-ok';
        let statusText = 'Disponible';
        if (item.stock === 0) { statusClass = 'status-out'; statusText = 'Agotado'; }
        else if (item.stock <= item.min) { statusClass = 'status-low'; statusText = 'Stock Bajo'; }
        
        return `
        <tr>
            <td><strong style="color: var(--text-main);">${item.name}</strong></td>
            <td><span class="text-muted">${item.category}</span></td>
            <td class="text-right"><strong style="color: var(--text-main);">${item.stock}</strong></td>
            <td>${item.unit}</td>
            <td class="text-right">${item.min}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="text-right">
                <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openAdjustInventory('${item.id}')">Ajustar</button>
            </td>
        </tr>
        `;
    }).join('');
}

window.openAdjustInventory = function(itemId) {
    const item = appData.inventory.find(i => i.id === itemId);
    document.getElementById('adjust-item-name').textContent = item.name;
    document.getElementById('adjust-stock-val').value = item.stock;
    document.getElementById('adjust-stock-unit').textContent = item.unit;
    document.getElementById('adjust-min-val').value = item.min;
    document.getElementById('adjust-item-id').value = item.id;
    openModal('modal-inventory-adjust');
}

document.getElementById('btn-save-inventory').addEventListener('click', () => {
    const id = document.getElementById('adjust-item-id').value;
    const item = appData.inventory.find(i => i.id === id);
    if(item) {
        item.stock = parseFloat(document.getElementById('adjust-stock-val').value) || 0;
        item.min = parseFloat(document.getElementById('adjust-min-val').value) || 0;
        saveData();
        renderInventory();
        updateAlerts();
        closeModal();
        showToast(`Stock de ${item.name} actualizado`);
    }
});

// --- SALES HISTORY LOGIC ---
function renderSales() {
    const term = document.getElementById('search-sales').value.toLowerCase();
    const dateFilter = document.getElementById('filter-sales-date').value;
    
    const now = new Date();
    
    let filtered = appData.sales.filter(s => s.id.toLowerCase().includes(term));
    
    filtered = filtered.filter(s => {
        const sDate = new Date(s.date);
        if (dateFilter === 'today') {
            return sDate.getDate() === now.getDate() && sDate.getMonth() === now.getMonth() && sDate.getFullYear() === now.getFullYear();
        }
        if (dateFilter === '7days') {
            return (now - sDate) / (1000 * 60 * 60 * 24) <= 7;
        }
        if (dateFilter === '30days') {
            return (now - sDate) / (1000 * 60 * 60 * 24) <= 30;
        }
        return true;
    });
    
    const tbody = document.getElementById('sales-table-body');
    tbody.innerHTML = filtered.map(sale => {
        const user = appData.users.find(u => u.id === sale.userId);
        const userName = user ? user.name : 'Desconocido';
        const itemsCount = sale.items.reduce((acc, i) => acc + i.quantity, 0);
        
        return `
        <tr>
            <td><strong style="color: var(--text-main);">#${sale.id}</strong></td>
            <td class="text-muted">${formatDate(sale.date)}</td>
            <td>${userName}</td>
            <td>${itemsCount} prod.</td>
            <td class="text-right"><strong style="color: var(--text-main);">${formatMoney(sale.total)}</strong></td>
            <td><span class="status-badge status-ok">${sale.status}</span></td>
            <td class="text-right">
                <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openSaleDetails('${sale.id}')">Ver Detalle</button>
            </td>
        </tr>
        `;
    }).join('');
}

window.openSaleDetails = function(saleId) {
    const sale = appData.sales.find(s => s.id === saleId);
    if (!sale) return;
    
    const user = appData.users.find(u => u.id === sale.userId);
    
    document.getElementById('detail-sale-ref').textContent = `Venta #${sale.id}`;
    document.getElementById('detail-sale-date').textContent = formatDate(sale.date);
    document.getElementById('detail-sale-vendor').textContent = user ? user.name : 'Desconocido';
    document.getElementById('detail-sale-total').textContent = formatMoney(sale.total);
    
    const itemsHtml = sale.items.map(item => {
        const details = [item.size.name, ...item.toppings.map(t=>t.name)].join(' · ');
        return `
        <div class="cart-item" style="border:none; padding:12px 0; border-bottom:1px solid var(--border-light); border-radius:0; box-shadow:none;">
            <div class="flex-between">
                <strong style="color: var(--text-main);">${item.quantity}x Granizado de ${item.product.name}</strong>
                <strong style="color: var(--text-main);">${formatMoney(item.total)}</strong>
            </div>
            <div class="text-sm text-muted mt-1">${details || 'Sin toppings'}</div>
        </div>
        `;
    }).join('');
    
    document.getElementById('detail-sale-items').innerHTML = itemsHtml;
    
    openModal('modal-sale-details');
}

// --- METRICS LOGIC ---
function renderMetrics() {
    const dateFilter = document.getElementById('filter-metrics-date').value;
    const now = new Date();
    
    // Filter sales data for metrics
    const data = appData.sales.filter(s => {
        const sDate = new Date(s.date);
        if (dateFilter === 'today') return sDate.getDate() === now.getDate() && sDate.getMonth() === now.getMonth() && sDate.getFullYear() === now.getFullYear();
        if (dateFilter === '7days') return (now - sDate) / (1000 * 60 * 60 * 24) <= 7;
        if (dateFilter === '30days') return (now - sDate) / (1000 * 60 * 60 * 24) <= 30;
        return true;
    });

    // Calc aggregates
    let totalRevenue = 0;
    let totalOrders = data.length;
    
    const productCount = {};
    const toppingCount = {};
    
    data.forEach(sale => {
        totalRevenue += sale.total;
        sale.items.forEach(item => {
            productCount[item.product.name] = (productCount[item.product.name] || 0) + item.quantity;
            item.toppings.forEach(t => {
                toppingCount[t.name] = (toppingCount[t.name] || 0) + item.quantity;
            });
        });
    });

    const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    const getTop = (obj) => {
        let max = 0; let topName = '-';
        for(let key in obj) { if(obj[key] > max) { max = obj[key]; topName = key; } }
        return topName;
    };

    const topProduct = getTop(productCount);

    document.getElementById('metric-revenue').textContent = formatMoney(totalRevenue);
    document.getElementById('metric-orders').textContent = totalOrders;
    document.getElementById('metric-ticket').textContent = formatMoney(avgTicket);
    document.getElementById('metric-top-product').textContent = topProduct;
    document.getElementById('metric-top-flavor').textContent = topProduct; // Flavor is the product now
    document.getElementById('metric-top-topping').textContent = getTop(toppingCount);

    // Render Charts (Simple CSS/HTML bars)
    renderSalesChart(data, dateFilter);
    renderProductsChart(productCount);
}

function renderSalesChart(data, filter) {
    const container = document.getElementById('chart-sales');
    if (data.length === 0) { container.innerHTML = '<div class="text-muted" style="width:100%; text-align:center; padding-bottom: 32px;">No hay datos para este período</div>'; return; }
    
    // Simple binning
    let bins = {};
    if (filter === 'today') {
        // Bin by hour
        for(let i=8; i<=20; i++) bins[i+':00'] = 0;
        data.forEach(s => { const h = new Date(s.date).getHours(); if(bins[h+':00']!==undefined) bins[h+':00'] += s.total; });
    } else {
        // Bin by day
        for(let i=6; i>=0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            bins[d.toLocaleDateString('es-CO', {weekday:'short'})] = 0;
        }
        data.forEach(s => {
            const dStr = new Date(s.date).toLocaleDateString('es-CO', {weekday:'short'});
            if(bins[dStr]!==undefined) bins[dStr] += s.total;
        });
    }

    let maxVal = Math.max(...Object.values(bins));
    if (maxVal === 0) maxVal = 1;

    let html = '';
    for(let label in bins) {
        const h = (bins[label] / maxVal) * 100;
        html += `
        <div class="chart-bar-wrap">
            <div class="chart-bar" style="height: ${h}%;" title="${formatMoney(bins[label])}"></div>
            <div class="chart-label">${label}</div>
        </div>`;
    }
    container.innerHTML = html;
}

function renderProductsChart(productCount) {
    const container = document.getElementById('chart-products');
    if (Object.keys(productCount).length === 0) { container.innerHTML = '<div class="text-muted" style="width:100%; text-align:center; padding-bottom: 32px;">No hay datos para este período</div>'; return; }
    
    let maxVal = Math.max(...Object.values(productCount));
    let html = '';
    for(let pName in productCount) {
        const h = (productCount[pName] / maxVal) * 100;
        html += `
        <div class="chart-bar-wrap">
            <div class="chart-bar" style="height: ${h}%; background: var(--teal-base);" title="${productCount[pName]} vendidos"></div>
            <div class="chart-label" style="writing-mode: vertical-rl; transform: rotate(180deg); margin-top:8px;">${pName.substring(0,3)}.</div>
        </div>`;
    }
    container.innerHTML = html;
}

// --- ADMIN VIEWS ---
function renderProductsAdmin() {
    const container = document.getElementById('admin-products-list');
    container.innerHTML = appData.products.map(p => `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding: 16px 24px;">
            <div>
                <h3 style="font-size: 1.1rem; color: var(--text-main); margin-bottom: 4px;">Granizado de ${p.name}</h3>
                <p class="text-muted text-sm">Precio Base: ${formatMoney(p.basePrice)}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 16px;">
                <span class="status-badge ${p.active ? 'status-ok' : 'status-out'}">${p.active ? 'Activo' : 'Inactivo'}</span>
                <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.85rem;" onclick="alert('Editar producto (Demo)')">Editar</button>
            </div>
        </div>
    `).join('');
}

function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = appData.users.map(u => `
        <tr>
            <td>
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="user-avatar" style="width:32px; height:32px; font-size:0.8rem; background: var(--teal-base);">
                        ${u.name.split(' ').map(n=>n[0]).join('').substring(0,2)}
                    </div>
                    <strong style="color: var(--text-main);">${u.name}</strong>
                </div>
            </td>
            <td><span class="text-muted">${u.role}</span></td>
            <td><span class="status-badge status-ok">${u.status}</span></td>
            <td class="text-muted">Hoy</td>
            <td class="text-right">
                <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.85rem;" onclick="alert('Editar usuario (Demo)')">Editar</button>
            </td>
        </tr>
    `).join('');
}

// Boot the app
window.onload = initApp;
