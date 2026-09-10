let menu = null;
let cart = JSON.parse(localStorage.getItem("cookies_cart") || "[]");
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

async function loadMenu() {
  try {
    const res = await fetch("/api/menu");
    menu = await res.json();
    renderCategories();
  } catch (err) {
    console.error("Failed to load menu:", err);
  }
}

function money(n) {
  return "₱" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function price(v) {
  const m = String(v).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function showPage(id) {
  $$(".page").forEach(x => x.classList.toggle("active", x.id === id));
  $$("nav a").forEach(x => x.classList.toggle("active", x.dataset.page === id));
  $("#navMenu").classList.remove("show");
  $("#hamburger").classList.remove("open");
  if ($("#currentDetails")) $("#currentDetails").remove();
  const backBtn = $("#floatingBackBtn");
  if (backBtn) backBtn.classList.remove("show");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCategories() {
  const box = $("#categories");
  if (!menu || !menu.categories || !box) return;

  box.innerHTML = menu.categories.map(c => {
    const img = c.image || "/images/placeholder.svg";
    return `
      <div class="category-card" onclick="openCategory('${c.id}')" role="button" tabindex="0">
        <img src="${img}" alt="${escapeHtml(c.name)}" onerror="this.src='/images/placeholder.svg'">
        <div class="category-info">
          <div class="category-info-text">
            <h3>${escapeHtml(c.name)}</h3>
          </div>
          <div class="category-arrow">→</div>
        </div>
      </div>
    `;
  }).join("");
}

function openCategory(id) {
  const c = menu.categories.find(x => x.id === id);
  if (!c) return;

  const existing = $("#currentDetails");
  if (existing) existing.remove();

  const sec = document.createElement("section");
  sec.className = "details page active";
  sec.id = "currentDetails";

  const itemsHtml = c.items && c.items.length ? c.items.map(item => `
    <article class="item-card">
      <div class="item-img-wrap">
        <img src="${item.image || '/images/placeholder.svg'}" alt="${escapeHtml(item.name)}" onerror="this.src='/images/placeholder.svg'">
      </div>
      <div class="item-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.description || "Freshly made to order.")}</p>
        <div class="item-foot">
          <div class="price-wrap">
            <span class="price">${escapeHtml(item.price)}</span>
            ${item.price_caption ? `<span class="price-caption">${escapeHtml(item.price_caption)}</span>` : ""}
          </div>
          ${item.available ? `
            <button class="btn-add" onclick='addToCart(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
              <span>+ Add</span>
            </button>
          ` : `
            <span class="badge-unavailable">Sold Out</span>
          `}
        </div>
      </div>
    </article>
  `).join("") : `<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:40px;">No items currently available in this category.</p>`;

  sec.innerHTML = `
    <div class="detail-wrap">
      <div class="detail-nav-bar">
        <button class="back-button" onclick="closeDetails()">
          ← Back to Menus
        </button>
      </div>

      <div class="detail-hero">
        <div class="detail-hero-content">
          <span class="section-tag"></span>
          <h2>${escapeHtml(c.name)}</h2>
          <p>Delicious dishes handcrafted fresh to order</p>
          ${c.note ? `<div class="note">${escapeHtml(c.note)}</div>` : ""}
        </div>
        <img src="${c.image || '/images/placeholder.svg'}" alt="${escapeHtml(c.name)}" onerror="this.src='/images/placeholder.svg'">
      </div>

      <div class="menu-list">
        ${itemsHtml}
      </div>
    </div>
  `;

  document.querySelector("main").appendChild(sec);
  $$(".page").forEach(x => {
    if (x.id !== "currentDetails") x.classList.remove("active");
  });

  const backBtn = $("#floatingBackBtn");
  if (backBtn) backBtn.classList.remove("show");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeDetails() {
  const det = $("#currentDetails");
  if (det) det.remove();
  const backBtn = $("#floatingBackBtn");
  if (backBtn) backBtn.classList.remove("show");
  showPage("menu");
}

function addToCart(item) {
  const existing = cart.find(i => i.id === item.id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image || "/images/placeholder.svg",
      qty: 1
    });
  }
  saveCart();
  toast(`Added "${item.name}" to cart`);
}

function saveCart() {
  localStorage.setItem("cookies_cart", JSON.stringify(cart));
  renderCart();
}

function renderCart() {
  const totalCount = cart.reduce((a, x) => a + x.qty, 0);
  const totalPrice = cart.reduce((a, x) => a + x.qty * price(x.price), 0);

  const badge = $("#cartCount");
  if (badge) badge.textContent = totalCount;

  const totalEl = $("#cartTotal");
  if (totalEl) totalEl.textContent = money(totalPrice);

  const container = $("#cartItems");
  if (!container) return;

  if (!cart.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
        <div style="display:flex; justify-content:center; margin-bottom:14px;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
        </div>
        <p>Your cart is empty.</p>
        <p style="font-size:13px; color:var(--text-dim);">Add some delicious dishes from our menu!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-row">
      <img src="${item.image}" onerror="this.src='/images/placeholder.svg'" alt="">
      <div class="cart-row-info">
        <b>${escapeHtml(item.name)}</b>
        <span class="item-price">${escapeHtml(item.price)}</span>
        <div class="qty-control">
          <button onclick="changeQty('${item.id}', -1)">−</button>
          <span>${item.qty}</span>
          <button onclick="changeQty('${item.id}', 1)">+</button>
        </div>
      </div>
      <div class="cart-row-total">
        ${money(item.qty * price(item.price))}
      </div>
    </div>
  `).join("");
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== id);
  }
  saveCart();
}

function openCart() {
  $("#cartDrawer").classList.add("open");
  $("#overlay").classList.add("show");
}

function closeCart() {
  $("#cartDrawer").classList.remove("open");
  $("#overlay").classList.remove("show");
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = "0";
  }, 2200);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Navigation & event listeners
$("#hamburger").onclick = () => {
  $("#hamburger").classList.toggle("open");
  $("#navMenu").classList.toggle("show");
};

$$("[data-page]").forEach(el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    showPage(el.dataset.page);
  });
});

$("#cartFab").onclick = openCart;
$("#closeCart").onclick = closeCart;
$("#overlay").onclick = closeCart;

// Dine-in Table Session & Order Type logic
let currentTable = sessionStorage.getItem("cookies_table") || "";
let currentSessionToken = sessionStorage.getItem("cookies_session_token") || "";

async function initTableSession() {
  const params = new URLSearchParams(window.location.search);
  const tableParam = params.get("table") || params.get("t");
  const tokenParam = params.get("session") || params.get("token") || params.get("s");

  if (tableParam) {
    currentTable = tableParam.trim();
    if (tokenParam) currentSessionToken = tokenParam.trim();
    sessionStorage.setItem("cookies_table", currentTable);
    if (currentSessionToken) sessionStorage.setItem("cookies_session_token", currentSessionToken);
  }

  if (currentTable) {
    try {
      const res = await fetch(`/api/tables/validate?table=${encodeURIComponent(currentTable)}&token=${encodeURIComponent(currentSessionToken)}`);
      const val = await res.json();
      
      const banner = $("#tableIndicatorBanner");
      const bannerNum = $("#tableBannerNumber");
      const sessionTag = $("#tableSessionTag");

      if (val.ok && val.active) {
        if (val.session_token) {
          currentSessionToken = val.session_token;
          sessionStorage.setItem("cookies_session_token", currentSessionToken);
        }
        if (banner && bannerNum) {
          bannerNum.textContent = `Table #${currentTable}`;
          if (sessionTag) sessionTag.textContent = "Active Dining Session Verified";
          banner.style.display = "flex";
          banner.style.borderColor = "rgba(147,38,53,0.6)";
        }
      } else {
        // Inactive or ended
        if (banner && bannerNum) {
          bannerNum.textContent = `Table #${currentTable} (Inactive)`;
          if (sessionTag) sessionTag.textContent = "Table Session Ended";
          banner.style.display = "flex";
          banner.style.borderColor = "#ef4444";
        }
        if (tableParam) {
          toast(val.error || `Table #${currentTable} is closed.`);
        }
      }
    } catch (e) {
      console.warn("Table validation check error:", e);
    }
  }
}

const clearTableBtn = $("#clearTableBtn");
if (clearTableBtn) {
  clearTableBtn.onclick = () => {
    currentTable = "";
    currentSessionToken = "";
    sessionStorage.removeItem("cookies_table");
    sessionStorage.removeItem("cookies_session_token");
    const banner = $("#tableIndicatorBanner");
    if (banner) banner.style.display = "none";
    const tableInput = $("#tableNumberInput");
    if (tableInput) tableInput.value = "";
    const tokenInput = $("#sessionTokenInput");
    if (tokenInput) tokenInput.value = "";
    toast("Table session cleared.");
  };
}

function updateOrderTypeFields() {
  const typeSelect = $("#orderTypeSelect");
  const tableGroup = $("#tableNumberGroup");
  const tableInput = $("#tableNumberInput");
  const tokenInput = $("#sessionTokenInput");
  const passcodeGroup = $("#passcodeGroup");
  const addressGroup = $("#addressGroup");
  const addressInput = $("#addressInput");

  if (!typeSelect) return;
  const val = typeSelect.value;

  if (val === "Dine-in") {
    if (tableGroup) tableGroup.style.display = "block";
    if (tableInput) {
      tableInput.required = true;
      if (currentTable && !tableInput.value) tableInput.value = currentTable;
    }
    if (tokenInput) {
      tokenInput.value = currentSessionToken || "";
    }
    if (passcodeGroup) {
      passcodeGroup.style.display = currentSessionToken ? "none" : "block";
    }
    if (addressGroup) addressGroup.style.display = "none";
    if (addressInput) {
      addressInput.required = false;
      addressInput.value = "";
    }
  } else if (val === "Delivery") {
    if (tableGroup) tableGroup.style.display = "none";
    if (tableInput) tableInput.required = false;
    if (passcodeGroup) passcodeGroup.style.display = "none";
    if (addressGroup) addressGroup.style.display = "block";
    if (addressInput) addressInput.required = true;
  } else {
    // Takeout
    if (tableGroup) tableGroup.style.display = "none";
    if (tableInput) tableInput.required = false;
    if (passcodeGroup) passcodeGroup.style.display = "none";
    if (addressGroup) addressGroup.style.display = "none";
    if (addressInput) {
      addressInput.required = false;
      addressInput.value = "";
    }
  }
}

const orderTypeSelect = $("#orderTypeSelect");
if (orderTypeSelect) {
  orderTypeSelect.onchange = updateOrderTypeFields;
}

// Checkout handling
$("#checkoutBtn").onclick = () => {
  if (!cart.length) {
    toast("Your cart is empty!");
    return;
  }
  closeCart();
  updateOrderTypeFields();
  const summaryBox = $("#checkoutSummary");
  const total = cart.reduce((a, x) => a + x.qty * price(x.price), 0);
  summaryBox.innerHTML = cart.map(x => `
    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
      <span>${escapeHtml(x.name)} × ${x.qty}</span>
      <b style="color:var(--yellow);">${money(x.qty * price(x.price))}</b>
    </div>
  `).join("") + `
    <div style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px; display:flex; justify-content:space-between; font-size:15px;">
      <b>Total</b>
      <b style="color:var(--yellow);">${money(total)}</b>
    </div>
  `;
  $("#checkoutModal").classList.add("show");
};

$("#closeCheckout").onclick = () => {
  $("#checkoutModal").classList.remove("show");
};

$("#checkoutForm").onsubmit = async e => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.items = cart.map(x => ({
    id: x.id,
    name: x.name,
    qty: x.qty,
    price: x.price,
    image: x.image
  }));

  const msg = $("#orderMsg");
  msg.style.color = "var(--text-muted)";
  msg.textContent = "Sending your order to Cookie's kitchen…";

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) {
      msg.style.color = "#ef4444";
      msg.textContent = result.error || "Failed to submit order. Please check inputs.";
      return;
    }

    msg.style.color = "var(--yellow)";
    msg.textContent = `Order #${result.orderId} placed successfully! Thank you!`;
    cart = [];
    saveCart();
    form.reset();
    setTimeout(() => {
      $("#checkoutModal").classList.remove("show");
      msg.textContent = "";
      toast(`Order #${result.orderId} received!`);
    }, 2500);
  } catch (err) {
    msg.style.color = "#ef4444";
    msg.textContent = "Connection error. Please try again.";
  }
};

// Floating navigation and scroll-to-top buttons
const backBtn = $("#floatingBackBtn");
const scrollTopBtn = $("#scrollTopBtn");

if (backBtn) {
  backBtn.onclick = () => closeDetails();
}

if (scrollTopBtn) {
  scrollTopBtn.onclick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

// Window scroll listener: show buttons when scrolled down, hide when at top
window.addEventListener("scroll", () => {
  const isScrolled = window.scrollY > 150;

  // Scroll to top button appears on scroll
  if (scrollTopBtn) {
    scrollTopBtn.classList.toggle("show", isScrolled);
  }

  // Back to Menus button appears on scroll when viewing category details
  if (backBtn) {
    const isDetailsActive = !!$("#currentDetails");
    backBtn.classList.toggle("show", isScrolled && isDetailsActive);
  }
});

// Initial boot
initTableSession();
loadMenu();
renderCart();
