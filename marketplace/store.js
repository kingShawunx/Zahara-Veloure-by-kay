(function () {
  "use strict";
  console.info("[catalog] store.js evaluated");
  // Catalog seed data is retained in catalog.js for reference, but never shown
  // as live inventory. Public product views wait for Supabase catalog data.
  let products = [];
  let categoryRows = [];
  let homepageBanners = [];
  let storeContact = {};
  const defaultPaymentSettings = { paystack_enabled: false, manual_transfer_enabled: true };
  let paymentSettings = {};
  const checkoutConfig = window.STORE_CHECKOUT_CONFIG || { whatsappNumber: "", bank: {} };
  let checkoutSettings = {};
  const config = window.STORE_CONFIG || { brandName: "Store", demoMode: true, currency: "NGN" };
  const termsVersion = "2026-10-17";
  let demoMode = false;
  let catalogState = "loading";
  let catalogError = "";
  const supabaseConfig = window.SUPABASE_CONFIG || {};
  let db = null;
  try {
    const hasClient = typeof window.supabase?.createClient === "function";
    const hasUrl = !!supabaseConfig.url;
    const hasPublishableKey = !!supabaseConfig.anonKey;
    console.info("[catalog] Supabase initialization", { clientLibraryLoaded: hasClient, projectUrlConfigured: hasUrl, publishableKeyConfigured: hasPublishableKey });
    if (hasClient && hasUrl && hasPublishableKey) db = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch (error) {
    console.error("[catalog] Supabase client initialization failed", { message: catalogErrorMessage(error), status: error?.status || null });
  }
  const keys = { cart: "zv_market_cart_v1", wishlist: "zv_market_wishlist_v1", recent: "zv_market_recent_v1" };
  const cachedCatalogKey = "zv_market_live_catalog_v1";
  const orderNowKey = "zv_market_order_now_v1";
  const app = document.getElementById("app");
  const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
  let params = new URLSearchParams(location.search);
  const safe = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  function catalogErrorMessage(error) {
    let message = String(error?.message || error || "Unknown error");
    if (supabaseConfig.anonKey) message = message.split(supabaseConfig.anonKey).join("[redacted]");
    return message
      .replace(/\b(?:sb_publishable|sb_secret)_[A-Za-z0-9_-]+/gi, "[redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
      .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/((?:apikey|access_token|refresh_token)=)[^&\s]+/gi, "$1[redacted]");
  }
  function authErrorMessage(error, action = "account") {
    const code = String(error?.code || error?.name || "").toLowerCase();
    const message = String(error?.message || error || "").toLowerCase();
    const statusValue = error?.status ?? error?.statusCode;
    const status = Number(statusValue || 0);
    const hasStatus = statusValue != null && Number.isFinite(Number(statusValue));
    if (/invalid_credentials|invalid login credentials/.test(code + " " + message)) return "Email or password is incorrect. Check both and try again.";
    if (/email_not_confirmed|email not confirmed/.test(code + " " + message)) return "Please verify your email using the confirmation link we sent before signing in. Check your inbox and spam folder.";
    if (/user_already_exists|email_exists|already registered|already exists/.test(code + " " + message)) return "This email already has an account. Sign in or use Forgot password.";
    if (/weak_password|password should be|password is too weak/.test(code + " " + message)) return "Choose a stronger password with at least 10 characters and at least one number or symbol.";
    if (/over_request_rate_limit|too many requests|rate limit/.test(code + " " + message)) return "There have been too many attempts. Wait a few minutes, then try again.";
    if (/otp_expired|expired.*(token|link)|invalid.*(token|otp)/.test(code + " " + message)) return "This recovery link has expired or was already used. Request a new password recovery link.";
    if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|connection/i.test(message) || error?.name === "TypeError" || (hasStatus && status === 0)) return "We could not reach the account service. Check your internet connection and try again.";
    if (status >= 500) return "The account service is temporarily unavailable. Please try again in a few minutes.";
    if (action === "recovery") return "We could not send the recovery request. Check your connection and try again.";
    return action === "profile" ? "Your account details could not be loaded or saved. Please try again." : "We could not complete that account request. Check your details and try again.";
  }
  async function runCatalogQuery(name, makeQuery) {
    console.info("[catalog] Request started", { request: name });
    try {
      const result = await makeQuery();
      const status = Number.isFinite(result?.status) ? result.status : Number.isFinite(result?.error?.status) ? result.error.status : null;
      if (result?.error) console.error("[catalog] Request failed", { request: name, status, message: catalogErrorMessage(result.error) });
      else console.info("[catalog] Request completed", { request: name, status });
      return result;
    } catch (error) {
      const status = Number.isFinite(error?.status) ? error.status : Number.isFinite(error?.response?.status) ? error.response.status : null;
      console.error("[catalog] Request rejected", { request: name, status, message: catalogErrorMessage(error) });
      throw error;
    }
  }
  const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { toast("Browser storage is unavailable. Your changes may not be saved."); } };
  function withTimeout(promise, milliseconds) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The store catalog request timed out. Check your connection and try again.")), milliseconds);
      Promise.resolve(promise).then(
        (value) => { window.clearTimeout(timer); resolve(value); },
        (error) => { window.clearTimeout(timer); reject(error); }
      );
    });
  }
  function normalizeVariant(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch (_) {}
      return value ? { size: value } : {};
    }
    return {};
  }
  function sortVariantKeys(value) {
    if (Array.isArray(value)) return value.map(sortVariantKeys);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => { result[key] = sortVariantKeys(value[key]); return result; }, {});
    return value;
  }
  const variantKey = (value) => JSON.stringify(sortVariantKeys(normalizeVariant(value)));
  const cart = () => { const value = read(keys.cart, []); return Array.isArray(value) ? value.filter((x) => x && products.some((p) => p.id === x.id) && Number.isInteger(x.qty) && x.qty > 0).slice(0, 100).map((x) => ({ ...x, variant: variantKey(x.variant) })) : []; };
  function orderNowItems() {
    try {
      const value = JSON.parse(sessionStorage.getItem(orderNowKey) || "null");
      const product = value && productById(value.id);
      if (!product || !Number.isInteger(value.qty) || value.qty < 1 || value.qty > product.stock) return [];
      return [{ id: product.id, variant: variantKey(value.variant), qty: value.qty }];
    } catch (_) { return []; }
  }
  const checkoutItems = () => params.get("buyNow") === "1" ? orderNowItems() : cart();
  const wishlist = () => { const value = read(keys.wishlist, []); return Array.isArray(value) ? [...new Set(value.filter((id) => products.some((p) => p.id === id)))].slice(0, 100) : []; };
  const productById = (id) => products.find((p) => p.id === id);
  const variantText = (value) => { if (!value) return "One size"; try { const object = JSON.parse(value); return Object.values(object).filter((v) => typeof v === "string" || typeof v === "number").join(" Â· ") || "Selected option"; } catch (_) { return value; } };
  const image = (p, cls) => `<img class="${cls || ""}" src="${safe(p.image)}" alt="${safe(p.name)}" loading="lazy" onerror="this.classList.add('image-missing');this.removeAttribute('src')">`;

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message; el.classList.add("is-visible");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("is-visible"), 2800);
  }
  function updateHeader() {
    const count = cart().reduce((sum, item) => sum + item.qty, 0);
    document.getElementById("cart-count").textContent = count;
    const mobileCartCount = document.getElementById("mobile-cart-count");
    if (mobileCartCount) mobileCartCount.textContent = count;
    document.getElementById("wishlist-count").textContent = wishlist().length;
    if (db && params.get("view") !== "checkout") db.auth.getUser().then(({ data }) => { const label = document.getElementById("account-label"); if (label) label.textContent = data.user && !data.user.is_anonymous ? "My Account" : "Sign in"; }).catch(() => { const label = document.getElementById("account-label"); if (label) label.textContent = "Sign in"; });
    document.querySelectorAll("[data-brand]").forEach((el) => el.textContent = config.brandName);
    document.getElementById("year").textContent = new Date().getFullYear();
    document.getElementById("store-status").textContent = catalogState === "ready" ? "Live catalog Â· customer accounts enabled" : catalogState === "loading" ? "Connecting to the store catalogâ€¦" : "Catalog unavailable";
    const categoryLinks = document.getElementById("dynamic-category-links");
    const visibleCategories = categoryRows.filter((category) => !category.parent_id && category.nav_visible);
    const navCategories = visibleCategories.length ? visibleCategories.map((category) => category.name) : [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    if (categoryLinks) categoryLinks.innerHTML = navCategories.map((name) => `<a href="?view=shop&amp;category=${encodeURIComponent(name)}" data-category="${safe(name)}">${safe(name)}</a>`).join("");
  }
  function productCard(p) {
    const saved = wishlist().includes(p.id);
    const discount = p.compareAt ? Math.max(1, Math.round((1 - p.price / p.compareAt) * 100)) : 0;
    return `<article class="product-card">
      <div class="product-photo"><a href="?view=product&id=${encodeURIComponent(p.id)}" aria-label="View ${safe(p.name)}">${image(p)}</a>
        ${p.deal && discount ? `<span class="deal-badge">-${discount}%${demoMode ? " sample" : ""}</span>` : ""}
        <button class="save-button ${saved ? "is-saved" : ""}" type="button" data-action="wishlist" data-id="${safe(p.id)}" aria-label="${saved ? "Remove from" : "Add to"} wishlist" aria-pressed="${saved}">â™¡</button>
      </div>
      <div class="product-info"><p class="product-category">${safe(p.category)}${p.subcategory ? ` Â· ${safe(p.subcategory)}` : ""}</p><a class="product-name" href="?view=product&id=${encodeURIComponent(p.id)}">${safe(p.name)}</a>
        <div class="price-row"><strong>${money.format(p.price)}</strong>${p.compareAt ? `<del>${money.format(p.compareAt)}</del>` : ""}</div>
        <p class="sample-note">${demoMode ? "Sample listing Â· stock shown for preview" : `${p.stock} in stock`}</p>
        <div class="product-card-actions">
          ${p.stock <= 0 ? `<button class="quick-add" type="button" disabled>Out of stock</button><button class="quick-add" type="button" disabled>Order Now</button>` : p.sizes.length ? `<a class="quick-add" href="?view=product&id=${encodeURIComponent(p.id)}">Add to Cart</a><a class="quick-add" href="?view=product&id=${encodeURIComponent(p.id)}&buyNow=1">Order Now</a>` : `<button class="quick-add" type="button" data-action="add" data-id="${safe(p.id)}">Add to Cart</button><button class="quick-add quick-order-now" type="button" data-action="order-now" data-id="${safe(p.id)}">Order Now</button>`}
        </div>
      </div>
    </article>`;
  }
  function pageTitle(eyebrow, title, text) {
    return `<header class="section-heading"><p class="eyebrow">${safe(eyebrow)}</p><h1>${safe(title)}</h1>${text ? `<p>${safe(text)}</p>` : ""}</header>`;
  }
  function updatePageMetadata(view) {
    const product = view === "product" ? productById(params.get("id")) : null;
    const page = product
      ? { title: `${product.name} | Zahara Veloure by Kay`, description: `${product.name} at Zahara Veloure by Kay. Discover perfumes, abayas, and fashion.` }
      : ({
          home: { title: "Zahara Veloure by Kay — The scent of soft luxury", description: "Discover perfumes, abayas, and fashion at Zahara Veloure by Kay." },
          shop: { title: "Shop perfumes, abayas & fashion | Zahara Veloure", description: "Browse the Zahara Veloure by Kay collection of perfumes, abayas, and fashion." },
          search: { title: "Search the collection | Zahara Veloure", description: "Search perfumes, abayas, and fashion at Zahara Veloure by Kay." },
          deals: { title: "Offers | Zahara Veloure by Kay", description: "Browse current offers from Zahara Veloure by Kay." },
          cart: { title: "Your cart | Zahara Veloure by Kay", description: "Review your selected Zahara Veloure products." },
          checkout: { title: "Complete your order | Zahara Veloure by Kay", description: "Review selected products and contact Zahara Veloure by Kay on WhatsApp to confirm availability and delivery." },
          wishlist: { title: "Your wishlist | Zahara Veloure by Kay", description: "View products saved to your Zahara Veloure wishlist." },
          account: { title: "My account | Zahara Veloure by Kay", description: "Manage your Zahara Veloure customer account." }
        }[view] || { title: "Zahara Veloure by Kay — The scent of soft luxury", description: "Discover perfumes, abayas, and fashion at Zahara Veloure by Kay." });
    document.title = page.title;
    const metadata = { description: page.description, "og:title": page.title, "og:description": page.description, "og:image": new URL("icons/brand-logo.jpeg", document.baseURI).href, "twitter:title": page.title, "twitter:description": page.description, "twitter:image": new URL("icons/brand-logo.jpeg", document.baseURI).href };
    Object.entries(metadata).forEach(([name, content]) => {
      const element = document.querySelector(name.startsWith("og:") ? `meta[property="${name}"]` : `meta[name="${name}"]`);
      if (element) element.setAttribute("content", content);
    });
  }
  function productGrid(items, emptyText) {
    return items.length ? `<div class="product-grid">${items.map(productCard).join("")}</div>` : `<div class="empty-state"><span aria-hidden="true">âŒ•</span><h2>No products found</h2><p>${safe(emptyText || "Try another search or clear your filters.")}</p><a class="button button-primary" href="?view=shop">Browse all products</a></div>`;
  }
  function renderHome() {
    const featured = products.filter((p) => p.featured).slice(0, 8);
    const dealProducts = products.filter((p) => p.deal).slice(0, 4);
    const homepageCategories = categoryRows.filter((category) => !category.parent_id && category.active && category.featured);
    const activeRoots = categoryRows.filter((category) => !category.parent_id && category.active);
    const perfumeRoot = activeRoots.find((category) => /perfume|fragrance/i.test(category.name));
    const fashionRoot = activeRoots.find((category) => /fashion|clothing/i.test(category.name));
    const abayaChild = categoryRows.find((category) => category.active && category.parent_id === fashionRoot?.id && /abaya/i.test(category.name));
    const curatedCategories = [
      perfumeRoot && { label: "Perfumes", category: perfumeRoot.name },
      abayaChild && { label: "Abayas", category: fashionRoot.name, subcategory: abayaChild.name },
      fashionRoot && { label: "Fashion", category: fashionRoot.name }
    ].filter(Boolean);
    const fallbackCategories = homepageCategories.length ? homepageCategories.map((category) => ({ label: category.name, category: category.name })) : [...new Set(products.map((p) => p.category).filter(Boolean))].sort().map((name) => ({ label: name, category: name }));
    const categorySource = curatedCategories.length ? curatedCategories : fallbackCategories;
    const categoryTiles = categorySource.slice(0, 6).map((item, index) => {
      const href = `?view=shop&amp;category=${encodeURIComponent(item.category)}${item.subcategory ? `&amp;subcategory=${encodeURIComponent(item.subcategory)}` : ""}`;
      return `<a class="category-tile ${index % 2 ? "scent-tile" : "fashion-tile"}" href="${href}"><span class="tile-icon">0${index + 1}</span><strong>${safe(item.label)}</strong><span>Explore the curated ${safe(item.label.toLowerCase())} edit</span></a>`;
    }).join("");
    const bannerCards = homepageBanners.map((banner) => { const href = /^(https:\/\/|\/(?!\/)|\.{1,2}\/|\?)/i.test(banner.destination_url || "") ? banner.destination_url : "?view=shop"; const src = banner.image_path ? banner.image_path.startsWith("https://") ? banner.image_path : db.storage.from("product-images").getPublicUrl(banner.image_path).data.publicUrl : ""; return `<a class="homepage-banner" href="${safe(href)}">${src ? `<img src="${safe(src)}" alt="" loading="lazy">` : ""}<span><strong>${safe(banner.title)}</strong>${banner.body ? `<small>${safe(banner.body)}</small>` : ""}</span></a>`; }).join("");
    const whatsapp = String(storeContact.whatsapp || "").replace(/\D/g, "");
    const contactHref = whatsapp ? `https://wa.me/${whatsapp}` : "../contact.html";
    app.innerHTML = `<section class="hero-market">
      <div class="hero-copy"><p class="eyebrow">THE SCENT OF SOFT LUXURY</p><h1>Little finds.<br><em>Lovely moments.</em></h1><p>Explore elegant fashion and fragrances, thoughtfully chosen for your everyday and your special occasions.</p><a class="button button-dark" href="?view=shop">Explore the collection <span aria-hidden="true">â†’</span></a>${demoMode ? "<small>Preview store Â· sample catalog</small>" : ""}</div>
      <div class="hero-art">${products[0] ? image(products[0], "hero-image") : ""}<div class="hero-stamp"><span>THE</span><strong>VELOURE<br>EDIT</strong><span>FASHION Â· SCENT</span></div></div>
    </section>
    ${bannerCards ? `<section class="homepage-banners">${bannerCards}</section>` : ""}
    <section class="content-section"><div class="section-top"><div><p class="eyebrow">SHOP YOUR WAY</p><h2>Explore categories</h2></div></div>
      <div class="category-tiles">${categoryTiles || `<p class="empty-note">Categories will appear when products are published.</p>`}</div>
    </section>
    <section class="content-section deals-section"><div class="section-top"><div><p class="eyebrow">A LITTLE SOMETHING SPECIAL</p><h2>${demoMode ? "Sample deals" : "Offers"}</h2>${demoMode ? "<p>Prices and discounts below are for preview only.</p>" : ""}</div><a class="text-link" href="?view=deals">See all deals â†’</a></div>${productGrid(dealProducts)}</section>
    <section class="content-section"><div class="section-top"><div><p class="eyebrow">HANDPICKED FOR YOU</p><h2>Explore the edit</h2></div><a class="text-link" href="?view=shop">View all products â†’</a></div>${productGrid(featured)}</section>
    ${read(keys.recent, []).length ? `<section class="content-section recent-section"><div class="section-top"><div><p class="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Recently viewed</h2></div></div>${productGrid(read(keys.recent, []).map(productById).filter(Boolean).slice(0,4))}</section>` : ""}
    <section class="newsletter"><div><p class="eyebrow">A NOTE FROM US</p><h2>New arrivals, delivered gently.</h2><p>${safe(storeContact.email ? `Questions? Email ${storeContact.email}.` : "Questions about a piece? Our team is happy to help.")}</p></div><a class="button button-dark" href="${safe(contactHref)}">Get in touch</a></section>`;
  }
  function renderShop(mode) {
    const category = params.get("category") || "";
    const subcategory = params.get("subcategory") || "";
    const query = params.get("q") || "";
    const min = params.get("min") || "";
    const max = params.get("max") || "";
    const sort = params.get("sort") || "featured";
    let list = products.slice();
    if (mode === "deals") list = list.filter((p) => p.deal);
    if (category) list = list.filter((p) => p.category === category);
    if (subcategory) list = list.filter((p) => p.subcategory === subcategory);
    if (query) { const q = query.toLowerCase(); list = list.filter((p) => `${p.name} ${p.category} ${p.subcategory || ""} ${p.description}`.toLowerCase().includes(q)); }
    if (min !== "" && Number.isFinite(Number(min))) list = list.filter((p) => p.price >= Number(min));
    if (max !== "" && Number.isFinite(Number(max))) list = list.filter((p) => p.price <= Number(max));
    if (sort === "price-low") list.sort((a,b) => a.price - b.price);
    else if (sort === "price-high") list.sort((a,b) => b.price - a.price);
    else if (sort === "newest") list.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === "name") list.sort((a,b) => a.name.localeCompare(b.name));
    const title = mode === "deals" ? (demoMode ? "Sample deals" : "Offers") : query ? `Search: â€œ${query}â€` : category ? category : "All products";
    const rootCategories = categoryRows.filter((c) => !c.parent_id && c.active);
    const categoryOptions = rootCategories.length ? rootCategories.map((c) => c.name) : [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    const selectedRoot = rootCategories.find((c) => c.name === category);
    const subcategoryOptions = selectedRoot ? categoryRows.filter((c) => c.parent_id === selectedRoot.id && c.active) : category ? [...new Set(products.filter((p) => p.category === category).map((p) => p.subcategory).filter(Boolean))].map((name) => ({ name })) : [];
    app.innerHTML = `<section class="listing-page">${pageTitle(mode === "deals" ? (demoMode ? "PREVIEW OFFERS" : "OFFERS") : "THE COLLECTION", title, demoMode ? "Browse the sample catalog. Product availability and pricing must be confirmed before launch." : "Explore current products available from Zahara Veloure by Kay.")}
      <div class="listing-layout"><aside class="filter-panel"><form id="filter-form"><h2>Filter &amp; sort</h2><label>Category<select name="category"><option value="">All categories</option>${categoryOptions.map((name) => `<option value="${safe(name)}" ${category === name ? "selected" : ""}>${safe(name)}</option>`).join("")}</select></label>${subcategoryOptions.length ? `<label>Subcategory<select name="subcategory"><option value="">All subcategories</option>${subcategoryOptions.map((c) => `<option value="${safe(c.name)}" ${subcategory === c.name ? "selected" : ""}>${safe(c.name)}</option>`).join("")}</select></label>` : ""}<label>Minimum price<input name="min" type="number" min="0" step="500" value="${safe(min)}" placeholder="â‚¦0"></label><label>Maximum price<input name="max" type="number" min="0" step="500" value="${safe(max)}" placeholder="No maximum"></label><label>Sort by<select name="sort"><option value="featured" ${sort === "featured" ? "selected" : ""}>Featured</option><option value="price-low" ${sort === "price-low" ? "selected" : ""}>Price: low to high</option><option value="price-high" ${sort === "price-high" ? "selected" : ""}>Price: high to low</option><option value="newest" ${sort === "newest" ? "selected" : ""}>Newest</option><option value="name" ${sort === "name" ? "selected" : ""}>Name</option></select></label><button class="button button-primary" type="submit">Apply filters</button><a class="clear-filters" href="?view=${mode === "deals" ? "deals" : "shop"}">Clear all</a></form></aside>
      <div class="listing-results"><div class="results-bar"><span>${list.length}${demoMode ? " sample" : ""} ${list.length === 1 ? "product" : "products"}</span><span>Prices shown in Nigerian naira</span></div>${productGrid(list)}</div></div></section>`;
  }
  function renderProduct(id) {
    const p = productById(id);
    if (!p) { app.innerHTML = `${pageTitle("PRODUCT", "We couldnâ€™t find that item", "It may have moved or is not included in this sample catalog.")}<div class="empty-state"><a class="button button-primary" href="?view=shop">Back to products</a></div>`; return; }
    const recent = read(keys.recent, []).filter((x) => x !== p.id);
    write(keys.recent, [p.id, ...recent].slice(0, 6));
    const related = products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
    app.innerHTML = `<section class="product-detail-page"><div class="breadcrumbs"><a href="?view=home">Home</a><span>/</span><a href="?view=shop&category=${encodeURIComponent(p.category)}">${safe(p.category)}</a><span>/</span><span>${safe(p.name)}</span></div>
      <div class="product-detail"> <div class="detail-photo">${image(p, "detail-image")}${demoMode ? "<span class=\"image-caption\">Sample product image</span>" : ""}</div><div class="detail-info"><p class="product-category">${safe(p.category)}${p.subcategory ? ` Â· ${safe(p.subcategory)}` : ""}${demoMode ? " Â· SAMPLE LISTING" : ""}</p><h1>${safe(p.name)}</h1><p class="review-note">No customer reviews yet</p><div class="detail-price"><strong>${money.format(p.price)}</strong>${p.compareAt ? `<del>${money.format(p.compareAt)}</del>${demoMode ? "<span class=\"sample-discount\">Preview price</span>" : ""}` : ""}</div><p class="detail-description">${safe(p.description)}</p><p class="stock-line"><span class="stock-dot"></span>${demoMode ? `${p.stock} units shown in sample data` : `${p.stock} in stock`}</p>
      ${p.sizes.length ? `<label class="variant-label" for="product-size">Choose an option</label><select id="product-size" class="size-select" required><option value="" selected disabled>Choose an option</option>${p.sizes.map((s) => { const obj = typeof s === "string" ? { size:s } : s; const label = typeof s === "string" ? s : Object.values(s).filter((v) => typeof v === "string").join(" Â· ") || "Option"; return `<option value="${safe(JSON.stringify(obj))}">${safe(label)}</option>`; }).join("")}</select>` : ""}
      <div class="quantity-control"><span>Quantity</span><div><button type="button" data-action="qty-minus" aria-label="Decrease quantity">âˆ’</button><input id="product-qty" type="number" value="1" min="1" max="${p.stock}" aria-label="Quantity"><button type="button" data-action="qty-plus" aria-label="Increase quantity">+</button></div></div>
      <div class="detail-actions"><button class="button button-primary" data-action="detail-add" data-id="${safe(p.id)}" ${p.stock <= 0 ? "disabled" : ""}>${p.stock <= 0 ? "Out of stock" : "Add to Cart"}</button><button class="button button-quiet" data-action="detail-order-now" data-id="${safe(p.id)}" ${p.stock <= 0 ? "disabled" : ""}>Order Now</button><button class="button button-quiet" data-action="wishlist" data-id="${safe(p.id)}" aria-pressed="${wishlist().includes(p.id)}">${wishlist().includes(p.id) ? "â™¥ Saved" : "â™¡ Save to wishlist"}</button></div><div class="service-points"><p><span>âœ“</span> ${demoMode ? "Payment setup pending" : "Payment setup depends on store configuration"}</p><p><span>âœ“</span> ${demoMode ? "Confirm product details before ordering" : "Order status updates"}</p><p><span>âœ“</span> Contact our team for help</p></div><a class="text-link" href="../contact.html">Questions? Contact Zahara Veloure â†’</a></div></div>
      <section class="related-section"><div class="section-top"><div><p class="eyebrow">KEEP EXPLORING</p><h2>More in ${safe(p.category.toLowerCase())}</h2></div></div>${productGrid(related)}</section></section>`;
  }
  async function loadProductReviews(productId) {
    if (demoMode || !db || !productById(productId)) return;
    const section = document.createElement("section"); section.className = "related-section review-section"; section.innerHTML = `<div class="section-top"><div><p class="eyebrow">CUSTOMER FEEDBACK</p><h2>Reviews</h2></div></div><div class="review-list" id="customer-review-list"><p class="loading">Loading approved reviewsâ€¦</p></div><div id="review-form-slot"></div>`;
    const related = app.querySelector(".related-section"); if (related) related.before(section); else app.append(section);
    const { data, error } = await db.from("reviews").select("id,rating,title,body,created_at,profiles(full_name)").eq("product_id",productId).eq("moderation_status","approved").order("created_at",{ascending:false}).limit(50);
    const list = section.querySelector("#customer-review-list");
    const reviewNote = app.querySelector(".review-note");
    if (!error && data?.length && reviewNote) { const average = data.reduce((sum,r)=>sum+Number(r.rating),0)/data.length; reviewNote.textContent = `â˜… ${average.toFixed(1)} Â· ${data.length} verified ${data.length===1?"review":"reviews"}`; }
    if (error) list.innerHTML = `<p class="loading">Reviews are temporarily unavailable.</p>`;
    else if (!data?.length) list.innerHTML = `<p class="loading">No customer reviews yet.</p>`;
    else list.innerHTML = data.map((r)=>`<article class="customer-review"><div><strong>${safe(r.title||"Customer review")}</strong><span>${"â˜…".repeat(r.rating)}${"â˜†".repeat(5-r.rating)}</span></div><p>${safe(r.body)}</p><small>${safe(r.profiles?.full_name||"Verified customer")} Â· ${new Date(r.created_at).toLocaleDateString("en-NG")}</small></article>`).join("");
    const { data: { user } } = await db.auth.getUser();
    section.querySelector("#review-form-slot").innerHTML = user ? `<form id="review-form" class="review-form"><h3>Share your experience</h3><p>Reviews are accepted after a verified delivered order and appear after moderation.</p><input type="hidden" name="product_id" value="${safe(productId)}"><label>Rating<select name="rating" required><option value="5">5 â€” Loved it</option><option value="4">4 â€” Great</option><option value="3">3 â€” Good</option><option value="2">2 â€” Could be better</option><option value="1">1 â€” Not for me</option></select></label><label>Review title<input name="title" maxlength="120"></label><label>Your review<textarea name="body" required minlength="10" maxlength="2000" rows="4"></textarea></label><button class="button button-primary" type="submit">Submit review</button><p class="form-message" role="status"></p></form>` : `<p class="loading">Sign in and have a delivered order to leave a review.</p>`;
  }
  function renderCart() {
    const items = cart();
    if (!items.length) {
      app.innerHTML = "<section class=\"listing-page\">" + pageTitle("YOUR BAG", "Your cart is waiting", "Add a product from the live collection to see it here.") + "<div class=\"empty-state\"><span aria-hidden=\"true\">â–±</span><a class=\"button button-primary\" href=\"?view=shop\">Explore products</a></div></section>";
      return;
    }
    const lines = items.map((item) => {
      const p = productById(item.id);
      return "<article class=\"cart-line\">" + image(p,"cart-thumb") + "<div class=\"cart-line-info\"><a href=\"?view=product&id=" + encodeURIComponent(p.id) + "\">" + safe(p.name) + "</a><small>" + safe(variantText(item.variant)) + "</small><button class=\"remove-link\" data-action=\"remove\" data-id=\"" + safe(p.id) + "\" data-variant=\"" + safe(item.variant || "") + "\">Remove</button></div><div class=\"cart-quantity\"><button data-action=\"cart-minus\" data-id=\"" + safe(p.id) + "\" data-variant=\"" + safe(item.variant || "") + "\" aria-label=\"Decrease quantity\">âˆ’</button><span>" + item.qty + "</span><button data-action=\"cart-plus\" data-id=\"" + safe(p.id) + "\" data-variant=\"" + safe(item.variant || "") + "\" aria-label=\"Increase quantity\">+</button></div><strong class=\"cart-line-total\"><small>Unit: " + money.format(p.price) + "</small><br>Subtotal: " + money.format(p.price * item.qty) + "</strong></article>";
    }).join("");
    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = items.reduce((sum,item) => sum + productById(item.id).price * item.qty,0);
    app.innerHTML = "<section class=\"listing-page\">" + pageTitle("YOUR BAG","Shopping cart","Review your selected live products and options.") + "<div class=\"cart-layout\"><div class=\"cart-lines\">" + lines + "</div><aside class=\"order-summary\"><h2>Order summary</h2><p><span>Items</span><strong>" + itemCount + "</strong></p><p><span>Items subtotal</span><strong>" + money.format(subtotal) + "</strong></p><p><span>Delivery fee</span><strong>To be confirmed</strong></p><hr><p class=\"summary-total\"><span>Subtotal before delivery</span><strong>" + money.format(subtotal) + "</strong></p><p class=\"summary-disclaimer\">These are catalog prices. Confirm availability, discounts, delivery charges, and the final amount with the store on WhatsApp before paying. This website does not save an order.</p><a class=\"button button-primary button-full\" href=\"?view=checkout\">Proceed to Checkout</a><button class=\"button button-quiet button-full\" type=\"button\" data-action=\"clear-cart\">Clear cart</button><a class=\"continue-link\" href=\"?view=shop\">Continue Shopping</a></aside></div></section>";
  }
  function renderCheckout() {
    const isOrderNow = params.get("buyNow") === "1";
    if (catalogState !== "ready") {
      app.innerHTML = "<section class=\"listing-page\">" + pageTitle("CHECKOUT", "Product details unavailable", "Checkout uses the live catalog already saved on this device and does not contact Supabase. Open the catalog while connected, then return to checkout.") + "<div class=\"account-preview\"><p>Your cart and Order Now selection have not been changed.</p><a class=\"button button-primary\" href=\"?view=shop\">Open the catalog</a></div></section>";
      return;
    }
    const items = checkoutItems();
    if (!items.length) {
      if (isOrderNow) app.innerHTML = "<section class=\"listing-page\">" + pageTitle("CHECKOUT", "Selected product unavailable", "Return to the product page to choose a current option and quantity.") + "<div class=\"account-preview\"><a class=\"button button-primary\" href=\"?view=shop\">Continue Shopping</a></div></section>";
      else renderCart();
      return;
    }
    const subtotal = items.reduce((sum, item) => sum + productById(item.id).price * item.qty, 0);
    const bank = checkoutConfig.bank || {};
    const whatsappNumber = String(checkoutConfig.whatsappNumber || "").replace(/\D/g, "");
    const lines = items.map((item) => {
      const product = productById(item.id);
      return `<p><span>${safe(product.name)} × ${item.qty}<br><small>${safe(variantText(item.variant))} · Unit: ${money.format(product.price)}</small></span><strong>${money.format(product.price * item.qty)}</strong></p>`;
    }).join("");
    const checkoutDescription = isOrderNow
      ? "Order Now includes only the selected product. Your saved cart remains unchanged."
      : "Review every product in your cart. WhatsApp options use the prices currently displayed in the catalog.";
    app.innerHTML = `<section class="listing-page">${pageTitle("CHECKOUT", "Complete Your Order", checkoutDescription)}<div class="checkout-layout"><form class="checkout-form" id="checkout-contact-form"><h2>Contact details</h2><div class="form-grid"><label>Full name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email address<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Phone number<input name="phone" type="tel" required maxlength="40" autocomplete="tel"></label><label>Country<select name="country" required><option value="Nigeria">Nigeria</option></select></label><label class="wide-field">Delivery address<input name="address" required minlength="5" maxlength="250" autocomplete="street-address"></label><label>City<input name="city" required minlength="2" maxlength="100" autocomplete="address-level2"></label><label>State<input name="state" required minlength="2" maxlength="100" autocomplete="address-level1"></label><label class="wide-field">Delivery method<select name="delivery_method" required><option value="standard">Standard delivery</option></select><small>Available delivery options and charges are confirmed by the store.</small></label><label class="wide-field">Delivery note <span class="optional">(optional)</span><textarea name="note" rows="3" maxlength="500"></textarea></label><label class="wide-field">Location sharing link <span class="optional">(optional)</span><input name="location_link" type="url" maxlength="500" placeholder="Google Maps link"></label></div><section class="checkout-failure-payment-card"><div class="failure-card-heading"><p class="eyebrow">OPTION 1 · BANK TRANSFER</p><h2>Pay by Bank Transfer</h2><p>Use the account details below to transfer your selected items subtotal. Confirm the final amount with the store on WhatsApp before payment.</p></div><div class="failure-bank-details"><p><strong>Bank Name:</strong> ${safe(bank.name || "Access Bank Nigeria")}</p><p><strong>Account Name:</strong> ${safe(bank.accountName || "KARIMAH OMOWUNMI TIJANI")}</p><p><strong>Account Number:</strong> <span>${safe(bank.accountNumber || "1973097329")}</span> <button class="button button-quiet" type="button" data-action="copy-account-number" data-account-number="${safe(bank.accountNumber || "1973097329")}">Copy Account Number</button></p><p class="failure-total"><span>Selected products subtotal</span><strong>${money.format(subtotal)}</strong></p></div><p class="payment-pending">Delivery charges and the final amount are pending confirmation. Confirm final amount with the store on WhatsApp before payment. After transferring, attach your payment receipt or screenshot in the WhatsApp conversation. Payment is not verified automatically.</p><button class="button button-primary button-full" type="button" data-checkout-whatsapp="proof" ${whatsappNumber ? "" : "disabled"}>Proceed to WhatsApp Checkout</button></section><section class="order-summary"><h2>Option 2: Negotiate on WhatsApp</h2><p>Discuss product prices, availability, delivery charges, and other order details before payment.</p><button class="button button-quiet button-full" type="button" data-checkout-whatsapp="negotiate" ${whatsappNumber ? "" : "disabled"}>Discuss / Negotiate Order</button><p class="summary-disclaimer">No order is saved, confirmed, or marked paid by these options. WhatsApp opens a message for you to review and send.</p><p id="checkout-whatsapp-fallback" class="form-message" role="status" aria-live="polite" hidden></p><textarea id="checkout-whatsapp-message" class="checkout-whatsapp-message" aria-label="WhatsApp message to copy" readonly hidden></textarea><button class="button button-quiet" type="button" data-action="copy-checkout-message" hidden>Copy WhatsApp Message</button></section><p id="checkout-message" class="form-message" role="status" aria-live="polite"></p></form><aside class="order-summary"><h2>${isOrderNow ? "Order Now selection" : "Your cart"}</h2><p><span>Total quantity</span><strong>${items.reduce((sum, item) => sum + item.qty, 0)}</strong></p>${lines}<hr><p><span>Items subtotal</span><strong>${money.format(subtotal)}</strong></p><p><span>Delivery charge</span><strong>Pending confirmation</strong></p><p class="summary-disclaimer">Displayed prices are catalog prices only. The store will confirm availability, delivery charges, and any discount before you pay.</p><a class="continue-link" href="?view=cart">Review cart</a></aside></div></section>`;
  }
  function checkoutContactValues(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value || "").trim()]));
  }
  function checkoutWhatsappMessage(mode, items, delivery, subtotal) {
    const bank = checkoutConfig.bank || {};
    const lines = items.map((item) => {
      const product = productById(item.id);
      return `- ${product.name}${variantText(item.variant) ? ` (${variantText(item.variant)})` : ""} × ${item.qty} @ ${money.format(product.price)} each = ${money.format(product.price * item.qty)}`;
    });
    const address = [delivery.address, delivery.city, delivery.state, delivery.country].filter(Boolean).join(", ");
    return [
      "Checkout request for Zahara Veloure By Kay.",
      mode === "proof" ? "I am contacting you about bank transfer for these selected products." : "I would like to discuss or negotiate this order before paying.",
      "No order has been saved or confirmed by this website checkout.",
      "Customer: " + (delivery.name || "Not provided"),
      "Phone: " + (delivery.phone || "Not provided"),
      "Email: " + (delivery.email || "Not provided"),
      "Items and displayed catalog prices:\n" + (lines.join("\n") || "- No items"),
      "Items subtotal: " + money.format(subtotal),
      ...(mode === "proof" ? [
        "Bank: " + (bank.name || "Access Bank Nigeria"),
        "Account name: " + (bank.accountName || "KARIMAH OMOWUNMI TIJANI"),
        "Account number: " + (bank.accountNumber || "1973097329")
      ] : []),
      "Delivery method: " + (delivery.delivery_method || "Standard delivery"),
      "Delivery address: " + (address || "Not provided"),
      "Delivery note: " + (delivery.note || "None"),
      "Location link: " + (delivery.location_link || "Not provided"),
      "Delivery charges and any discount: pending store confirmation; subtotal is not the final amount.",
      mode === "proof"
        ? "Please confirm product availability, delivery charges, and the final amount. After payment, I will attach my transfer receipt or screenshot here. Please verify receipt before marking payment as received."
        : "Please confirm availability, discuss product prices and delivery charges, and agree the final amount with me before I pay."
    ].join("\n");
  }
  function openCheckoutWhatsapp(mode, form) {
    if (!form.reportValidity()) return;
    const items = checkoutItems().map((item) => ({ ...item }));
    if (!items.length || items.some((item) => !productById(item.id))) {
      const status = document.getElementById("checkout-message");
      if (status) { status.textContent = "Product details are unavailable. Your cart has not been changed. Return to the catalog and try again."; status.className = "form-message is-error"; }
      return;
    }
    const delivery = checkoutContactValues(form);
    const subtotal = items.reduce((sum, item) => sum + productById(item.id).price * item.qty, 0);
    const number = String(checkoutConfig.whatsappNumber || "").replace(/\D/g, "");
    const message = checkoutWhatsappMessage(mode, items, delivery, subtotal);
    const url = number ? "https://wa.me/" + number + "?text=" + encodeURIComponent(message) : "";
    if (!url) {
      showCheckoutMessageFallback(message);
      return;
    }
    const opened = window.open(url, "_blank");
    if (opened) opened.opener = null;
    else showCheckoutMessageFallback(message);
  }
  function showCheckoutMessageFallback(message) {
    const status = document.getElementById("checkout-whatsapp-fallback");
    const textarea = document.getElementById("checkout-whatsapp-message");
    const copyButton = document.querySelector('[data-action="copy-checkout-message"]');
    if (textarea) { textarea.value = message; textarea.hidden = false; }
    if (status) { status.textContent = "WhatsApp could not be opened. Contact +234 807 185 2423 and copy the message below."; status.hidden = false; status.className = "form-message is-error"; }
    if (copyButton) copyButton.hidden = false;
  }
  async function copyAccountNumber(button) {
    try {
      const accountNumber = button.dataset.accountNumber || "";
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(accountNumber);
      } else {
        const field = document.createElement("textarea");
        field.value = accountNumber;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("Clipboard access is unavailable");
      }
      const original = button.textContent;
      button.textContent = "Copied";
      toast("Account number copied successfully.");
      window.setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1800);
    } catch (_) {
      toast("Could not copy the account number. Please select and copy it manually.");
    }
  }
  function checkoutWhatsappUrl(message) {
    const number = String(checkoutConfig.whatsappNumber || "").replace(/\D/g, "");
    return number ? "https://wa.me/" + number + "?text=" + encodeURIComponent(message) : "";
  }
  function orderWhatsappSummary(order, lineItems, delivery, total, mode) {
    const items = lineItems.map((item) => {
      const variant = variantText(JSON.stringify(item.variant || {}));
      return "- " + (item.product_name || "Product") + (variant ? " (" + variant + ")" : "") + " x " + item.quantity + " @ " + money.format(Number(item.unit_price)) + " each = " + money.format(Number(item.line_total));
    }).join("\n");
    const address = [delivery.address, delivery.city, delivery.state, delivery.country].filter(Boolean).join(", ");
    const status = mode === "proof"
      ? "Awaiting payment. The store has not verified this transfer."
      : "I have not paid yet. Please confirm product availability, delivery charges, and the agreed amount before I transfer.";
    return [
      mode === "proof" ? "Hello, I have made a bank transfer for my order." : "Hello, I would like to discuss my order before payment.",
      "Order reference: " + order.order_number,
      "Customer: " + (delivery.name || "Not provided"),
      "Phone: " + (delivery.phone || "Not provided"),
      "Email: " + (delivery.email || "Not provided"),
      "Items:\n" + (items || "- Order items unavailable"),
      "Delivery method: " + (delivery.delivery_method || "Standard delivery"),
      "Delivery address: " + (address || "Not provided"),
      "Delivery note: " + (delivery.note || "None"),
      "Location link: " + (delivery.location_link || "Not provided"),
      "Order total: " + money.format(total),
      status,
      mode === "proof" ? "I will attach my transfer receipt in this WhatsApp chat. Please verify receipt before marking the order as paid." : "Please confirm availability and delivery charges and agree the payment amount with me before I transfer."
    ].join("\n");
  }
  function showCreatedOrder(order, items, delivery) {
    const lineItems = Array.isArray(order.items) ? order.items : items.map((item) => {
      const product = productById(item.id);
      let variant = {};
      try { variant = JSON.parse(item.variant || "{}"); } catch (_) {}
      const unitPrice = product?.price || 0;
      return { product_name: product?.name || "Product", quantity: item.qty, variant, unit_price: unitPrice, line_total: unitPrice * item.qty };
    });
    const lines = lineItems.map((item) => "<p><span>" + safe(item.product_name || "Product") + " × " + item.quantity + " · " + safe(variantText(JSON.stringify(item.variant || {}))) + "</span><strong>Unit: " + money.format(Number(item.unit_price)) + "<br>Subtotal: " + money.format(Number(item.line_total)) + "</strong></p>").join("");
    const bank = checkoutConfig.bank || {};
    const amountDue = order.negotiation_status === "confirmed" && order.agreed_total != null ? Number(order.agreed_total) : Number(order.total);
    const awaitingAgreement = order.negotiation_status === "awaiting_agreement";
    const declined = order.negotiation_status === "declined";
    const paid = order.payment_status === "paid";
    const proofHref = checkoutWhatsappUrl(orderWhatsappSummary(order, lineItems, delivery, amountDue, "proof"));
    const discussHref = checkoutWhatsappUrl(orderWhatsappSummary(order, lineItems, delivery, amountDue, "discuss"));
    const bankDetails = bank.name && bank.accountName && bank.accountNumber
      ? "<p><strong>Bank:</strong> " + safe(bank.name) + "<br><strong>Account name:</strong> " + safe(bank.accountName) + "<br><strong>Account number:</strong> <span>" + safe(bank.accountNumber) + "</span> <button class=\"button button-quiet\" type=\"button\" data-action=\"copy-account-number\" data-account-number=\"" + safe(bank.accountNumber) + "\">Copy Account Number</button></p>"
      : "<p class=\"payment-pending\">Bank details are not configured. Please contact the store before transferring.</p>";
    const privateProofForm = paymentSettings.manual_transfer_enabled !== false
      ? "<details class=\"proof-upload-details\"><summary>Or submit your receipt privately for verification</summary><form id=\"payment-proof-form\" class=\"checkout-form payment-proof-form\"><input type=\"hidden\" name=\"order_id\" value=\"" + safe(order.order_id) + "\"><label>Transfer receipt or screenshot<input name=\"proof\" type=\"file\" accept=\"image/jpeg,image/png,image/webp,application/pdf\" required></label><small>Private upload, maximum 5 MB. Submission does not mark the order as paid; the store must verify the transfer.</small><button class=\"button button-quiet\" type=\"submit\">Submit proof for verification</button><p class=\"form-message\" role=\"status\" aria-live=\"polite\"></p></form></details>"
      : "";
    const transferPanel = !awaitingAgreement && !declined && !paid
      ? "<section class=\"checkout-payment-panel\"><h2>Option 1: Pay by bank transfer</h2><p>Exact amount due: <strong>" + money.format(amountDue) + "</strong></p>" + bankDetails + "<p>Transfer the exact amount above to the displayed account, then use the WhatsApp button to attach your receipt. Clicking it does not verify payment. Your order remains unpaid until the store confirms receipt.</p>" + (proofHref ? "<a class=\"button button-primary button-full\" target=\"_blank\" rel=\"noopener noreferrer\" href=\"" + safe(proofHref) + "\">Send Payment Proof on WhatsApp</a>" : "") + privateProofForm + "</section>"
      : "";
    const paymentState = paid ? "Confirmed paid by the store" : awaitingAgreement ? "Awaiting store confirmation" : declined ? "Store declined this order" : "Awaiting payment";
    const discussionCopy = awaitingAgreement || declined
      ? "Please confirm product availability, discuss delivery charges, and agree the payment amount before transferring. Do not pay until the store confirms."
      : "You can discuss availability or delivery before transferring. If the amount changes, wait for the store to confirm the agreed price.";
    const discussButton = discussHref ? "<a class=\"button button-quiet button-full\" target=\"_blank\" rel=\"noopener noreferrer\" href=\"" + safe(discussHref) + "\">Discuss Order on WhatsApp Before Payment</a>" : "<p>WhatsApp contact is not configured.</p>";
    const exactTotal = Number.isFinite(amountDue) ? amountDue : Number(order.total);
    app.innerHTML = "<section class=\"listing-page\">" + pageTitle("ORDER CREATED", "Your order is saved", "Reference " + safe(order.order_number) + ". Keep this reference when contacting the seller.") + "<div class=\"checkout-layout\"><section class=\"checkout-form\"><h2>Order details</h2>" + lines + "<hr><p><span>Subtotal</span><strong>" + money.format(Number(order.subtotal)) + "</strong></p>" + (Number(order.discount) > 0 ? "<p><span>Discount</span><strong>−" + money.format(Number(order.discount)) + "</strong></p>" : "") + "<p><span>Delivery fee</span><strong>" + (Number(order.shipping_fee) ? money.format(Number(order.shipping_fee)) : "To be confirmed") + "</strong></p><p class=\"summary-total\"><span>Exact order total</span><strong>" + money.format(exactTotal) + "</strong></p><p>Payment status: <strong>" + paymentState + "</strong></p>" + (awaitingAgreement || declined ? "<p class=\"payment-pending\">" + (declined ? "The store declined this order. Contact the store before transferring." : "Awaiting store confirmation. Do not transfer until the store confirms product availability, delivery charges, and the agreed amount.") + "</p>" : transferPanel) + "</section><aside class=\"order-summary checkout-payment-panel\"><h2>Option 2: Discuss before payment</h2><p>" + discussionCopy + "</p>" + discussButton + "<p class=\"summary-disclaimer\">WhatsApp opens only when you choose a button. Messages are not sent automatically, and a WhatsApp message does not change the saved order total or payment status.</p><a class=\"continue-link\" href=\"?view=orders\">View my orders</a><a class=\"continue-link\" href=\"?view=shop\">Continue shopping</a></aside></div></section>";
  }
  async function syncWishlist(user) {
    if (!db || !user || user.is_anonymous) return;
    const localIds = wishlist().filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
    if (localIds.length) {
      const { error } = await db.from("wishlists").upsert(localIds.map((product_id) => ({ user_id: user.id, product_id })), { onConflict: "user_id,product_id", ignoreDuplicates: true });
      if (error) console.warn("Could not merge the local wishlist into the customer account.");
    }
    const { data, error } = await db.from("wishlists").select("product_id").eq("user_id", user.id);
    if (!error) write(keys.wishlist, (data || []).map((row) => row.product_id));
    updateHeader();
  }
  async function renderWishlist() {
    if (db) { const { data: { user } } = await db.auth.getUser(); if (user && !user.is_anonymous) await syncWishlist(user); }
    const items = products.filter((p) => wishlist().includes(p.id));
    app.innerHTML = `<section class="listing-page">${pageTitle("SAVED FOR LATER", "Your wishlist", "Keep the pieces you love close by.")}${db ? `<p class="wishlist-account-note"><a href="?view=account">${(await db.auth.getUser()).data.user?.is_anonymous ? "Create an account" : "Manage your account"}</a> to sync saved products across devices.</p>` : ""}${productGrid(items, "Save a product with the heart button and it will appear here.")}</section>`;
  }
  function renderAuth(mode) {
    if (!db) { app.innerHTML = `<section class="listing-page">${pageTitle("CUSTOMER ACCOUNT", "Sign-in is not configured", "Add the Supabase project URL and public anon key to config.js to enable secure accounts.")}</section>`; return; }
    if (mode === "reset-password") {
      app.innerHTML = `<section class="listing-page">${pageTitle("ACCOUNT SECURITY", "Choose a new password", "Use at least 10 characters.")}<form class="checkout-form auth-single" id="password-reset-form"><label>New password<div class="password-control"><input name="password" type="password" required minlength="10" autocomplete="new-password"><button type="button" data-toggle-password>Show</button></div></label><label>Confirm password<input name="confirm" type="password" required minlength="10" autocomplete="new-password"></label><button class="button button-primary">Update password</button><p class="form-message" role="status" aria-live="polite"></p></form></section>`; return;
    }
    if (mode === "forgot-password") {
      app.innerHTML = `<section class="listing-page">${pageTitle("ACCOUNT SECURITY", "Reset your password", "Enter your email and weâ€™ll send a recovery link if an account matches.")}<form class="checkout-form auth-single" id="forgot-form"><label>Email address<input name="email" type="email" required autocomplete="email"></label><button class="button button-primary">Send recovery link</button><p class="form-message" role="status" aria-live="polite"></p><a class="text-link" href="?view=login">Back to sign in</a></form></section>`; return;
    }
    const signup = mode === "signup";
    app.innerHTML = `<section class="listing-page">${pageTitle(signup ? "NEW CUSTOMER" : "YOUR ACCOUNT", signup ? "Create your account" : "Welcome back", signup ? "Save your details, orders and favourite pieces in one place." : "Sign in to manage your Zahara Veloure account.")}<form class="checkout-form auth-single" id="${signup ? "signup-form" : "signin-form"}">${signup ? `<label>Full name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email address<input name="email" type="email" required autocomplete="email"></label><label>Phone number <span class="optional">(optional)</span><input name="phone" type="tel" maxlength="40" autocomplete="tel"></label>` : `<label>Email address<input name="email" type="email" required autocomplete="email"></label>`}<label>Password<div class="password-control"><input name="password" type="password" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? "new-password" : "current-password"}"><button type="button" data-toggle-password>Show</button></div>${signup ? `<small>Use at least 10 characters and include at least one number or symbol.</small>` : ""}</label>${signup ? `<label>Confirm password<input name="confirm" type="password" required minlength="10" autocomplete="new-password"></label><label class="terms-check"><input name="terms" type="checkbox" required> I agree to the <a href="?view=terms">Terms</a> and <a href="?view=privacy">Privacy Policy</a>.</label>` : `<a class="text-link auth-secondary-link" href="?view=forgot-password">Forgot password?</a>`}<button class="button button-primary" type="submit">${signup ? "Create account" : "Sign in"}</button><p class="form-message" role="status" aria-live="polite"></p><p class="auth-switch">${signup ? `Already registered? <a href="?view=login">Sign in</a>` : `New customer? <a href="?view=signup">Create an account</a>`}</p></form></section>`;
  }
  async function renderAccount() {
    if (!db) { renderAuth("login"); return; }
    let authResult;
    try { authResult = await db.auth.getUser(); }
    catch (error) {
      app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "Account temporarily unavailable", authErrorMessage(error))}<div class="account-preview"><a class="button button-primary" href="?view=login">Return to sign in</a><button class="button button-quiet" type="button" data-account-retry>Try again</button></div></section>`;
      return;
    }
    const user = authResult.data?.user;
    if (authResult.error) {
      app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "We could not verify your session", authErrorMessage(authResult.error))}<div class="account-preview"><a class="button button-primary" href="?view=login">Return to sign in</a><button class="button button-quiet" type="button" data-account-retry>Try again</button></div></section>`;
      return;
    }
    if (!user) { renderAuth("login"); return; }
    if (user.is_anonymous) {
      app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "Youâ€™re shopping as a guest", "Create an account to keep your eligible orders and wishlist with you across devices.")}<form id="upgrade-form" class="checkout-form auth-single"><label>Full name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Phone number <span class="optional">(optional)</span><input name="phone" type="tel" maxlength="40" autocomplete="tel"></label><label>Password<input name="password" type="password" required minlength="10" autocomplete="new-password"><small>Use at least 10 characters and include at least one number or symbol.</small></label><label>Confirm password<input name="confirm" type="password" required minlength="10" autocomplete="new-password"></label><label class="terms-check"><input name="terms" type="checkbox" required> I agree to the <a href="?view=terms">Terms</a> and <a href="?view=privacy">Privacy Policy</a>.</label><button class="button button-primary">Save guest account</button><p class="form-message" role="status" aria-live="polite"></p></form></section>`; return;
    }
    let profileResult, addressResult;
    try {
      [profileResult, addressResult] = await Promise.all([
      db.from("profiles").select("full_name,email,phone").eq("id", user.id).maybeSingle(),
      db.from("customer_addresses").select("id,label,recipient_name,phone,address_line1,address_line2,city,state,postal_code,country,is_default").eq("user_id", user.id).order("is_default", { ascending: false }).order("created_at")
      ]);
    } catch (error) {
      app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "Account details unavailable", authErrorMessage(error, "profile"))}<div class="account-preview"><button class="button button-primary" type="button" data-account-retry>Try again</button></div></section>`;
      return;
    }
    const profile = profileResult.data;
    const addresses = addressResult.data;
    const addressError = addressResult.error;
    const profileError = profileResult.error || (!profile ? { message: "Customer profile was not found." } : null);
    const name = profile?.full_name || user.user_metadata?.full_name || "";
    const rows = addresses || [];
    app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", `Hello, ${name || user.email}`, "Manage your profile, delivery addresses, wishlist and orders.")}<div class="account-shortcuts"><a class="button button-primary" href="?view=orders">My orders</a><a class="button button-quiet" href="?view=wishlist">My wishlist</a><button class="button button-quiet" type="button" data-action="signout">Sign out</button></div><div class="account-columns"><form id="profile-form" class="checkout-form account-form"><h2>Profile</h2>${profileError ? `<p class="form-message is-error">${safe(authErrorMessage(profileError, "profile"))}</p>` : ""}<label>Full name<input name="name" required maxlength="120" value="${safe(name)}" autocomplete="name"></label><label>Email<input type="email" value="${safe(user.email)}" disabled></label><label>Phone<input name="phone" type="tel" maxlength="40" value="${safe(profile?.phone || "")}" autocomplete="tel"></label><button class="button button-primary" ${profileError ? "disabled" : ""}>Save profile</button><p class="form-message" role="status" aria-live="polite"></p><a class="text-link" href="?view=forgot-password">Change password</a></form><section class="checkout-form account-form address-panel"><h2>My addresses</h2>${addressError ? `<p class="form-message is-error">${safe(authErrorMessage(addressError, "profile"))} If this is a missing-table error, check that migration 202610170003_customer_accounts.sql has been applied.</p>` : rows.map((a) => `<article class="saved-address"><strong>${safe(a.label)}${a.is_default ? " Â· Default" : ""}</strong><p>${safe(a.recipient_name)} Â· ${safe(a.phone)}<br>${safe(a.address_line1)} ${safe(a.address_line2)}<br>${safe(a.city)}, ${safe(a.state)} ${safe(a.postal_code)}<br>${safe(a.country)}</p><button class="text-link" type="button" data-address-edit="${safe(a.id)}">Edit</button> <button class="text-link" type="button" data-address-delete="${safe(a.id)}">Remove</button></article>`).join("")}<form id="address-form"><input type="hidden" name="id"><label>Label<input name="label" maxlength="40" value="Home" required></label><label>Recipient<input name="recipient_name" maxlength="120" value="${safe(name)}" required></label><label>Phone<input name="phone" maxlength="40" required value="${safe(profile?.phone || "")}"></label><label>Address line 1<input name="address_line1" maxlength="250" required></label><label>Address line 2<input name="address_line2" maxlength="250"></label><label>City<input name="city" maxlength="100" required></label><label>State<input name="state" maxlength="100" required></label><label>Postal code<input name="postal_code" maxlength="24"></label><label>Country<input name="country" maxlength="80" value="Nigeria" required></label><label class="terms-check"><input name="is_default" type="checkbox"> Default address</label><button class="button button-primary">Save address</button><p class="form-message" role="status" aria-live="polite"></p></form></section></div></section>`;
    if (addressError) return;
    const form = $("#address-form", app);
    $(".address-panel", app).addEventListener("click", async (event) => {
      const edit = event.target.closest("[data-address-edit]");
      if (edit) { const row = rows.find((item) => item.id === edit.dataset.addressEdit); if (row) { Object.entries(row).forEach(([key, value]) => { const input = form.elements.namedItem(key); if (input) input.type === "checkbox" ? input.checked = !!value : input.value = value ?? ""; }); form.scrollIntoView({ behavior: "smooth", block: "center" }); } return; }
      const button = event.target.closest("[data-address-delete]"); if (!button || !confirm("Remove this saved address?")) return;
      try { const { error: deleteError } = await db.from("customer_addresses").delete().eq("id", button.dataset.addressDelete).eq("user_id", user.id); if (deleteError) throw deleteError; renderAccount(); }
      catch (error) { toast(authErrorMessage(error, "profile")); }
    });
  }
  async function renderOrders() {
    if (!db) { renderInfo("track"); return; }
    let authResult;
    try { authResult = await db.auth.getUser(); }
    catch (error) {
      app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "Orders temporarily unavailable", authErrorMessage(error))}<div class="account-preview"><a class="button button-primary" href="?view=login">Return to sign in</a><button class="button button-quiet" type="button" data-account-retry>Try again</button></div></section>`;
      return;
    }
    if (authResult.error) {
      app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "We could not verify your session", authErrorMessage(authResult.error))}<div class="account-preview"><a class="button button-primary" href="?view=login">Return to sign in</a><button class="button button-quiet" type="button" data-account-retry>Try again</button></div></section>`;
      return;
    }
    const user = authResult.data?.user;
    if (!user) { renderAccount(); return; }
    app.innerHTML = "<section class=\"listing-page\">" + pageTitle("YOUR ACCOUNT", "Your orders", "Loading your orders…") + "</section>";
    let orderResult;
    try { orderResult = await db.from("orders").select("id,order_number,total,agreed_total,negotiation_status,delivery_address,currency,payment_status,fulfillment_status,tracking_number,created_at,order_items(product_name,quantity,unit_price,variant),payments(provider,status,proof_path,rejection_reason,amount,submitted_at)").eq("user_id", user.id).order("created_at", { ascending: false }); }
    catch (error) { app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "Orders unavailable", authErrorMessage(error, "profile"))}<div class="account-preview"><button class="button button-primary" type="button" data-account-retry>Try again</button></div></section>`; return; }
    const { data, error } = orderResult;
    if (error) { app.innerHTML = `<section class="listing-page">${pageTitle("YOUR ACCOUNT", "Orders unavailable", authErrorMessage(error, "profile"))}<div class="account-preview"><button class="button button-primary" type="button" data-account-retry>Try again</button></div></section>`; return; }
    const rows = data || [];
    const bank = checkoutConfig.bank || {};
    app.innerHTML = "<section class=\"listing-page\">" + pageTitle("YOUR ACCOUNT", "Your orders", "Check payment and delivery progress. Refresh this page to see store updates.") + (rows.length ? "<div class=\"order-history\">" + rows.map((order) => {
      const amount = Number(order.negotiation_status === "confirmed" && order.agreed_total != null ? order.agreed_total : order.total);
      const payment = (order.payments || []).slice().sort((a,b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))[0];
      const awaitingAgreement = order.negotiation_status === "awaiting_agreement";
      const declined = order.negotiation_status === "declined";
      const itemRows = order.order_items || [];
      const itemText = itemRows.map((item) => item.product_name + " × " + item.quantity + (item.variant && Object.keys(item.variant).length ? " (" + Object.values(item.variant).join(", ") + ")" : "") + " @ " + money.format(Number(item.unit_price)) + " each = " + money.format(Number(item.unit_price) * Number(item.quantity))).join("\n");
      const delivery = order.delivery_address || {};
      const addressText = [delivery.address,delivery.city,delivery.state,delivery.country].filter(Boolean).join(", ");
      const mode = order.payment_status === "paid" ? "paid" : awaitingAgreement || declined ? "discuss" : payment?.status === "pending_verification" ? "verification" : "proof";
      const summary = [
        mode === "proof" ? "Hello, I have made a bank transfer for my order." : mode === "verification" ? "Hello, I submitted transfer proof for this order and would like to check its verification status." : mode === "paid" ? "Hello, I have a question about my confirmed order." : "Hello, I would like to discuss my order before payment.",
        "Order reference: " + order.order_number,
        "Customer: " + (delivery.name || "Not provided"),
        "Phone: " + (delivery.phone || "Not provided"),
        "Email: " + (delivery.email || "Not provided"),
        "Items:\n" + (itemText || "Order items unavailable"),
        "Delivery method: " + (delivery.delivery_method || "Standard delivery"),
        "Delivery: " + (addressText || "Not provided"),
        "Note: " + (delivery.note || "None"),
        "Location: " + (delivery.location_link || "Not provided"),
        "Total: " + money.format(amount),
        mode === "proof" ? "Payment status: awaiting payment or store verification. Please verify the transfer before marking as paid. I will attach the receipt in this chat." : mode === "verification" ? "Payment status: verification pending. Please let me know when the store has reviewed the receipt." : mode === "paid" ? "Payment status: confirmed by the store." : "I have not paid. Please confirm availability, delivery charges, and the final amount before I transfer."
      ].join("\n");
      const number = String(checkoutConfig.whatsappNumber || "").replace(/\D/g, "");
      const href = number ? "https://wa.me/" + number + "?text=" + encodeURIComponent(summary) : "";
      const paymentState = order.payment_status === "paid" ? "Confirmed paid by the store" : order.fulfillment_status === "cancelled" ? "Order cancelled — unpaid" : awaitingAgreement ? "Awaiting store confirmation" : declined ? "Store declined this order" : payment?.status === "pending_verification" ? "Payment verification pending" : payment?.status === "rejected" ? "Payment proof rejected: " + (payment.rejection_reason || "please resubmit proof") : payment?.status === "initialized" ? "Legacy Paystack payment pending" : "Awaiting payment";
      const awaitingVerification = payment?.status === "pending_verification";
      const canSubmitProof = order.payment_status !== "paid" && order.fulfillment_status !== "cancelled" && !awaitingAgreement && !declined && !awaitingVerification && paymentSettings.manual_transfer_enabled !== false;
      const transferDetails = bank.name && bank.accountName && bank.accountNumber
        ? "<p><strong>" + safe(bank.name) + "</strong><br>" + safe(bank.accountName) + "<br>" + safe(bank.accountNumber) + " <button class=\"button button-quiet\" type=\"button\" data-action=\"copy-account-number\" data-account-number=\"" + safe(bank.accountNumber) + "\">Copy Account Number</button></p><p>Amount due: <strong>" + money.format(amount) + "</strong></p>"
        : "<p>Bank transfer details are unavailable. Contact the store before transferring.</p>";
      const manualForm = canSubmitProof ? "<details><summary>Bank transfer and secure proof upload</summary>" + transferDetails + "<p>Uploading a receipt does not mark payment as paid. The store must verify the transfer.</p><form id=\"payment-proof-form-" + safe(order.id) + "\" class=\"checkout-form payment-proof-form\"><input type=\"hidden\" name=\"order_id\" value=\"" + safe(order.id) + "\"><label>Receipt or screenshot<input name=\"proof\" type=\"file\" accept=\"image/jpeg,image/png,image/webp,application/pdf\" required></label><small>Private upload, maximum 5 MB.</small><button class=\"button button-quiet\" type=\"submit\">Submit proof for verification</button><p class=\"form-message\" role=\"status\"></p></form></details>" : "";
      const whatsappLabel = mode === "proof" ? "Send Payment Proof on WhatsApp" : mode === "verification" ? "Ask About Payment Verification" : mode === "paid" ? "Contact Store About Order" : "Discuss Order on WhatsApp Before Payment";
      return "<article class=\"order-history-card\"><div><strong>" + safe(order.order_number) + "</strong><span>" + new Date(order.created_at).toLocaleDateString("en-NG") + "</span></div><p>" + safe(itemRows.map((item) => item.product_name + " × " + item.quantity).join(" · ")) + "</p><div><span>Payment: " + safe(paymentState) + "</span><span>Delivery: " + safe(order.fulfillment_status) + "</span>" + (order.tracking_number ? "<span>Tracking: " + safe(order.tracking_number) + "</span>" : "") + "</div><strong>" + money.format(amount) + "</strong>" + (manualForm ? manualForm : "") + (href ? "<p><a class=\"button button-quiet\" target=\"_blank\" rel=\"noopener noreferrer\" href=\"" + safe(href) + "\">" + whatsappLabel + "</a></p>" : "") + "</article>";
    }).join("") + "</div>" : "<div class=\"empty-state\"><h2>No orders yet</h2><p>Your orders will appear here after checkout.</p><a class=\"button button-primary\" href=\"?view=shop\">Explore products</a></div>") + "</section>";
  }
  async function renderPaymentReturn() {
    const reference = params.get("reference");
    if (!db || !reference) { renderInfo("track"); return; }
    app.innerHTML = `<section class="listing-page">${pageTitle("PAYMENT", "Checking your payment", "Weâ€™re verifying the transaction with Paystack.")}</section>`;
    const { data, error } = await db.functions.invoke("verify-paystack", { body: { reference } });
    if (error || !data?.verified) { app.innerHTML = `<section class="listing-page">${pageTitle("PAYMENT", "Payment not confirmed", data?.error || "Please check your orders or contact the store before trying again.")}<div class="account-preview"><a class="button button-primary" href="?view=orders">View my orders</a></div></section>`; return; }
    write(keys.cart, []); updateHeader();
    app.innerHTML = `<section class="listing-page">${pageTitle("PAYMENT", "Payment confirmed", "Your Paystack transaction was verified by the store server.")}<div class="account-preview"><a class="button button-primary" href="?view=orders">View your order</a></div></section>`;
  }
  function renderInfo(kind) {
    if (kind === "track" && db) { renderOrders(); return; }
    const copy = {
      help: ["SUPPORT", "How can we help?", "For product questions and shopping enquiries, reach out directly.", "Contact the team", "We can help with fragrance questions, sizing, product availability, delivery, and WhatsApp checkout."],
      shipping: ["DELIVERY", "Shipping & returns", "Delivery details are agreed directly with the store.", "Confirm delivery before payment", "The store will confirm availability, delivery arrangements, charges, and its current returns policy with you on WhatsApp before payment. This website does not create an order or delivery reference."],
      track: ["ORDER SUPPORT", "Track an order", "Sign in to review saved order references, payment state, and fulfilment updates.", "Order history available", "Open Your account â†’ Your orders. Use the order reference when contacting the store for help."],
      privacy: ["STORE INFORMATION", "Privacy notice", "Your cart and wishlist are stored in this browser.", "Information and WhatsApp", "This checkout does not save an order to the website. If you choose a WhatsApp option, review the prepared message before sending; customer and delivery details you include will be handled by WhatsApp and the store. Supabase is used for customer accounts and live catalog features. Contact the store for its current data-retention details."],
      terms: ["STORE INFORMATION", "Terms of use", "WhatsApp checkout is a request to discuss selected products.", "Payment and order status", "The displayed catalog subtotal is not a confirmed order total. The store must confirm product availability, discounts, delivery charges, and the final amount with you before payment. A WhatsApp message does not create a website order or verify a transfer. Attach proof in WhatsApp after payment and wait for the store to verify receipt." ]
    }[kind] || ["SUPPORT", "Information", "", "Contact the team", "Reach out to the store for assistance."];
    if (!demoMode && kind === "privacy") { copy[2] = "How information is handled depends on the feature you use."; copy[3] = "Account and checkout information"; copy[4] = "Supabase Auth handles account credentials, and Supabase stores the live product catalog and account features. The current WhatsApp checkout does not save customer or order details in the website database. If you send a prepared WhatsApp message, the details you include are handled by WhatsApp and the store. The store operator should publish contact and retention details for those records."; }
    app.innerHTML = `<section class="listing-page">${pageTitle(copy[0], copy[1], copy[2])}<div class="info-panel"><h2>${copy[3]}</h2><p>${copy[4]}</p><a class="button button-primary" href="../contact.html">Contact Zahara Veloure</a></div></section>`;
  }
  function render() {
    params = new URLSearchParams(location.search);
    updateHeader();
    document.querySelectorAll(".category-nav a,.mobile-nav a").forEach((a) => { const nav = a.dataset.nav; a.classList.toggle("is-current", nav === (params.get("view") || "home")); });
    const view = params.get("view") || (location.hash === "#shop" ? "shop" : "home");
    updatePageMetadata(view);
    const catalogViews = ["home", "shop", "search", "deals", "product", "cart", "checkout", "wishlist"];
    if (catalogViews.includes(view) && catalogState !== "ready") {
      if (view === "checkout") { renderCheckout(); return; }
      const title = catalogState === "loading" ? "Connecting to the store" : "Products are temporarily unavailable";
      const copy = catalogState === "loading"
        ? "Weâ€™re checking the live product catalog. Please wait a moment."
        : `The live catalog could not be loaded${catalogError ? `: ${catalogError}` : "."} No sample products are being shown, and checkout is unavailable until the catalog connection is restored.`;
      app.innerHTML = `<section class="listing-page">${pageTitle("LIVE STORE CATALOG", title, copy)}<div class="info-panel"><h2>${catalogState === "loading" ? "Loading products" : "No live inventory displayed"}</h2><p>${catalogState === "loading" ? "Your cart and checkout will be available once real catalog data loads." : "Please try again shortly, or contact the store if this continues."}</p>${catalogState === "error" ? `<button class="button button-primary" type="button" data-action="retry-catalog">Try again</button>` : ""}</div></section>`;
      updateHeader();
      return;
    }
    if (view === "home") renderHome();
    else if (view === "shop" || view === "search") renderShop("shop");
    else if (view === "deals") renderShop("deals");
    else if (view === "product") { renderProduct(params.get("id")); loadProductReviews(params.get("id")); }
    else if (view === "cart") renderCart();
    else if (view === "checkout") renderCheckout();
    else if (view === "wishlist") renderWishlist();
    else if (view === "account") renderAccount();
    else if (["login", "signup", "forgot-password", "reset-password"].includes(view)) renderAuth(view);
    else if (view === "orders") renderOrders();
    else if (view === "payment-return") renderPaymentReturn();
    else if (["help", "shipping", "track", "privacy", "terms"].includes(view)) renderInfo(view);
    else renderHome();
    const searchInput = document.getElementById("search-input");
    searchInput.value = params.get("q") || "";
    const appFocus = params.get("focus") === "1";
    if (appFocus) app.focus({ preventScroll: true });
  }
  function goTo(url) { location.href = url; }
  function startOrderNow(id, variant, qty) {
    const product = productById(id);
    const count = Number(qty);
    if (!product || product.stock < 1) { toast("This product is currently unavailable."); return; }
    if (!Number.isInteger(count) || count < 1 || count > product.stock) { toast("Choose a quantity within the available stock."); return; }
    try {
      sessionStorage.setItem(orderNowKey, JSON.stringify({ id: product.id, variant: normalizeVariant(variant), qty: count }));
      goTo("?view=checkout&buyNow=1");
    } catch (_) { toast("Checkout could not be opened. Your cart has not changed."); }
  }
  function selectedProductVariant(product) {
    if (!product?.sizes.length) return "{}";
    const select = document.getElementById("product-size");
    if (!select?.value) { toast("Choose a product option before continuing."); select?.focus(); return null; }
    return select.value;
  }
  function addToCart(id, variant, qty) {
    const p = productById(id); if (!p) return;
    const count = Math.max(1, Math.min(Number(qty) || 1, p.stock));
    const selectedVariantKey = variantKey(variant);
    const list = cart(); const row = list.find((x) => x.id === id && variantKey(x.variant) === selectedVariantKey);
    const already = row ? row.qty : 0;
    if (already + count > p.stock) { toast("That quantity is above the available stock."); return; }
    if (row) row.qty += count; else list.push({ id, variant: selectedVariantKey, qty: count });
    write(keys.cart, list); updateHeader(); toast("Added to your cart.");
  }
  async function toggleWishlist(id) {
    const list = wishlist(); const at = list.indexOf(id);
    if (at === -1) { list.push(id); toast("Saved to your wishlist."); } else { list.splice(at, 1); toast("Removed from your wishlist."); }
    write(keys.wishlist, list); updateHeader();
    if (db) { const { data: { user } } = await db.auth.getUser(); if (user && !user.is_anonymous) { const result = at === -1 ? await db.from("wishlists").upsert({ user_id:user.id, product_id:id }, { onConflict:"user_id,product_id", ignoreDuplicates:true }) : await db.from("wishlists").delete().eq("user_id",user.id).eq("product_id",id); if (result.error) toast("Your saved item could not sync to your account."); } }
    render();
  }
  function updateCartItem(id, variant, delta, remove) {
    const list = cart(); const at = list.findIndex((x) => x.id === id && variantKey(x.variant) === variantKey(variant));
    if (at < 0) return;
    if (remove) list.splice(at, 1);
    else { list[at].qty += delta; if (list[at].qty < 1) list.splice(at, 1); else if (list[at].qty > productById(id).stock) { list[at].qty = productById(id).stock; toast("Quantity limited to available stock."); } }
    write(keys.cart, list); render();
  }
  function startSearch(q) { const url = new URL(location.href); url.searchParams.set("view", "search"); if (q.trim()) url.searchParams.set("q", q.trim()); else url.searchParams.delete("q"); history.replaceState({}, "", url.href); params = new URLSearchParams(url.search); renderShop("shop"); document.getElementById("search-input").value = q; }
  async function loadCatalog() {
    console.info("[catalog] Initialization started");
    params = new URLSearchParams(location.search);
    if (params.get("view") === "checkout") {
      try {
        const cached = JSON.parse(localStorage.getItem(cachedCatalogKey) || "null");
        if (cached && Array.isArray(cached.products) && cached.products.length) {
          products = cached.products;
          categoryRows = Array.isArray(cached.categories) ? cached.categories : [];
          checkoutSettings = cached.checkoutSettings && typeof cached.checkoutSettings === "object" ? cached.checkoutSettings : {};
          catalogState = "ready";
          catalogError = "";
        } else {
          products = [];
          catalogState = "error";
          catalogError = "No live catalog snapshot is saved on this device.";
        }
      } catch (_) {
        products = [];
        catalogState = "error";
        catalogError = "The saved catalog snapshot is unavailable.";
      }
      render();
      return;
    }
    catalogState = "loading";
    catalogError = "";
    try {
      render();
      if (!db) throw new Error("Supabase client or public project configuration is unavailable.");
      const [catalog, categoryResult, bannerResult, contactResult, paymentResult, checkoutResult] = await withTimeout(Promise.all([
        runCatalogQuery("active products", () => db.from("products").select("id,name,description,price,compare_at_price,stock_quantity,variants,featured,created_at,category_id,categories(id,name,parent_id),product_images(storage_path,alt_text,sort_order)").eq("status", "active").order("created_at", { ascending: false })),
        runCatalogQuery("active categories", () => db.from("categories").select("id,name,slug,parent_id,active,nav_visible,featured,sort_order").eq("active", true).order("sort_order")),
        runCatalogQuery("homepage banners", () => db.from("homepage_banners").select("title,body,image_path,destination_url,sort_order,starts_at,ends_at").eq("active", true).order("sort_order").limit(8)),
        runCatalogQuery("contact settings", () => db.from("store_settings").select("value").eq("key", "contact").maybeSingle()),
        runCatalogQuery("payment settings", () => db.from("store_settings").select("value").eq("key", "payment").maybeSingle()),
        runCatalogQuery("checkout settings", () => db.from("store_settings").select("value").eq("key", "checkout").maybeSingle())
      ]), 15000);
      if (catalog.error) throw catalog.error;
      const data = catalog.data;
      categoryRows = categoryResult.error ? [] : categoryResult.data || [];
      homepageBanners = bannerResult.error ? [] : bannerResult.data || [];
      storeContact = contactResult.error ? {} : contactResult.data?.value || {};
      paymentSettings = paymentResult.error ? {} : { ...defaultPaymentSettings, ...(paymentResult.data?.value || {}) };
      checkoutSettings = checkoutResult.error ? {} : checkoutResult.data?.value || {};
      products = (data || []).map((row) => {
        const images = (row.product_images || []).slice().sort((a,b) => a.sort_order - b.sort_order);
        const path = images[0]?.storage_path || "";
        const imageUrl = path.startsWith("http") ? path : path ? db.storage.from("product-images").getPublicUrl(path).data.publicUrl : "";
        const assignedCategory = categoryRows.find((category) => category.id === row.category_id);
        const parentCategory = categoryRows.find((category) => category.id === assignedCategory?.parent_id);
        return { id: row.id, name: row.name, category: parentCategory?.name || assignedCategory?.name || row.categories?.name || "Collection", subcategory: parentCategory ? assignedCategory.name : "", description: row.description || "", price: Number(row.price), compareAt: row.compare_at_price == null ? null : Number(row.compare_at_price), image: imageUrl, sizes: Array.isArray(row.variants) ? row.variants : [], stock: Number(row.stock_quantity) || 0, featured: !!row.featured, createdAt: row.created_at, deal: row.compare_at_price != null && Number(row.compare_at_price) > Number(row.price) };
      });
      try { localStorage.setItem(cachedCatalogKey, JSON.stringify({ products, categories: categoryRows, checkoutSettings })); } catch (_) { console.warn("[catalog] Could not cache catalog snapshot for offline WhatsApp checkout."); }
      demoMode = false;
      catalogState = "ready";
      catalogError = "";
      render();
      console.info("[catalog] Initialization completed", { status: Number.isFinite(catalog.status) ? catalog.status : null });
    } catch (error) {
      const status = Number.isFinite(error?.status) ? error.status : Number.isFinite(error?.response?.status) ? error.response.status : null;
      catalogError = catalogErrorMessage(error);
      console.error("[catalog] Initialization failed", { status, message: catalogError });
      catalogState = "error";
      products = [];
      categoryRows = [];
      homepageBanners = [];
      storeContact = {};
      try {
        render();
      } catch (renderError) {
        console.error("[catalog] Error state render failed", { message: catalogErrorMessage(renderError) });
        const status = document.getElementById("store-status");
        if (status) status.textContent = "Catalog unavailable";
        if (app) {
          app.replaceChildren();
          const section = document.createElement("section");
          section.className = "listing-page";
          section.innerHTML = '<header class="section-heading"><p class="eyebrow">LIVE STORE CATALOG</p><h1>Products are temporarily unavailable</h1><p>No live inventory is shown until the catalog connection is restored.</p></header><div class="info-panel"><h2>No live inventory displayed</h2><p>The catalog could not be loaded. Please try again.</p><button class="button button-primary" type="button" data-action="retry-catalog">Try again</button></div>';
          app.append(section);
        }
      }
      return;
    }
    if (db) {
      try {
        const { data: { user } } = await db.auth.getUser();
        if (user && !user.is_anonymous) await syncWishlist(user);
      } catch (error) {
        console.error("[catalog] Account sync failed", { status: Number.isFinite(error?.status) ? error.status : null, message: catalogErrorMessage(error) });
      }
    }
  }

  document.getElementById("search-form").addEventListener("submit", (event) => { event.preventDefault(); startSearch(document.getElementById("search-input").value); });
  let searchTimer;
  document.getElementById("search-input").addEventListener("input", (event) => { clearTimeout(searchTimer); const value = event.target.value; searchTimer = setTimeout(() => { if (value.trim().length >= 2 || value.trim().length === 0) startSearch(value); }, 350); });
  app.addEventListener("click", async (event) => {
    if (event.target.closest('[data-action="retry-catalog"]')) { loadCatalog(); return; }
    if (event.target.closest("[data-account-retry]")) { params.get("view") === "orders" ? renderOrders() : renderAccount(); return; }
    const checkoutButton = event.target.closest("[data-checkout-whatsapp]");
    if (checkoutButton) { openCheckoutWhatsapp(checkoutButton.dataset.checkoutWhatsapp, document.getElementById("checkout-contact-form")); return; }
    const visibilityButton = event.target.closest("[data-toggle-password]");
    if (visibilityButton) { const input = visibilityButton.parentElement.querySelector("input"); input.type = input.type === "password" ? "text" : "password"; visibilityButton.textContent = input.type === "password" ? "Show" : "Hide"; }
    const button = event.target.closest("[data-action]"); if (!button) return;
    const { action, id, variant = "" } = button.dataset;
    if (action === "clear-cart") { write(keys.cart, []); updateHeader(); render(); return; }
    if (action === "copy-account-number") {
      await copyAccountNumber(button);
      return;
    }
    if (action === "copy-checkout-message") {
      const textarea = document.getElementById("checkout-whatsapp-message");
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(textarea.value);
        else { textarea.hidden = false; textarea.select(); if (!document.execCommand("copy")) throw new Error("copy failed"); }
        toast("WhatsApp message copied successfully.");
      } catch (_) { textarea.hidden = false; textarea.focus(); textarea.select(); toast("Select and copy the WhatsApp message above."); }
      return;
    }
    if (action === "wishlist") { event.preventDefault(); toggleWishlist(id); }
    if (action === "signout" && db) {
      button.disabled = true;
      try {
        const { error } = await db.auth.signOut();
        if (error) throw error;
        write(keys.wishlist, []);
        toast("You have signed out.");
        renderAuth("login");
        updateHeader();
      } catch (error) {
        button.disabled = false;
        toast(authErrorMessage(error));
      }
      return;
    }
    if (action === "add") addToCart(id, "{}", 1);
    if (action === "order-now") startOrderNow(id, "{}", 1);
    if (action === "detail-add" || action === "detail-order-now") {
      const p = productById(id);
      const variantValue = selectedProductVariant(p);
      if (variantValue === null) return;
      const input = document.getElementById("product-qty");
      const quantity = Number(input?.value);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > p.stock) { toast("Choose a quantity within the available stock."); input?.focus(); return; }
      if (action === "detail-order-now") startOrderNow(id, variantValue, quantity);
      else addToCart(id, variantValue, quantity);
    }
    if (action === "remove") updateCartItem(id, variant, 0, true);
    if (action === "cart-minus") updateCartItem(id, variant, -1, false);
    if (action === "cart-plus") updateCartItem(id, variant, 1, false);
    if (action === "qty-minus" || action === "qty-plus") { const input = document.getElementById("product-qty"); input.value = Math.max(1, Math.min(productById(params.get("id")).stock, Number(input.value || 1) + (action === "qty-plus" ? 1 : -1))); }
  });
  app.addEventListener("submit", async (event) => {
    if (event.target.id === "checkout-contact-form") { event.preventDefault(); return; }
    if (["signin-form", "signup-form", "upgrade-form"].includes(event.target.id)) {
      event.preventDefault(); const form = event.target; const values = new FormData(form); const status = form.querySelector(".form-message"); const submit = form.querySelector('[type="submit"]');
      const email = String(values.get("email") || "").trim(); const password = String(values.get("password") || ""); const name = String(values.get("name") || "").trim(); const phone = String(values.get("phone") || "").trim();
      if (form.id !== "signin-form") {
        if (password.length < 10) { status.textContent = "Use a password with at least 10 characters."; status.className = "form-message is-error"; return; }
        if (!/[0-9]/.test(password) && !/[^A-Za-z0-9]/.test(password)) { status.textContent = "Add at least one number or symbol to your password."; status.className = "form-message is-error"; return; }
        if (password !== String(values.get("confirm") || "")) { status.textContent = "The passwords do not match."; status.className = "form-message is-error"; return; }
        if (values.get("terms") !== "on") { status.textContent = "Please accept the Terms and Privacy Policy to create your account."; status.className = "form-message is-error"; return; }
      }
      const buttonText = submit.textContent; submit.disabled = true; submit.textContent = "Please waitâ€¦"; status.textContent = "";
      try {
        if (form.id === "signin-form") {
          const { data, error } = await db.auth.signInWithPassword({ email, password }); if (error) throw error;
          try { await syncWishlist(data.user); } catch (_) { console.warn("[account] Wishlist sync was unavailable after sign-in."); }
          const target = new URL(location.href); target.searchParams.set("view", "account"); location.assign(target.href);
        } else if (form.id === "upgrade-form") {
          const { data: current, error: currentError } = await db.auth.getUser(); if (currentError) throw currentError;
          if (!current.user?.is_anonymous) throw new Error("Sign in to an existing customer account or continue as a guest.");
          const { data, error } = await db.auth.updateUser({ email, password, data: { full_name: name, phone, terms_accepted: true, terms_version: termsVersion } }, { emailRedirectTo: `${location.origin}${location.pathname}?view=account` }); if (error) throw error;
          status.textContent = "Your account is ready. Check your email to verify the address; your guest orders stay linked."; status.className = "form-message is-info";
          if (data.user) { try { await syncWishlist(data.user); } catch (_) { console.warn("[account] Wishlist sync was unavailable after account upgrade."); } }
        } else {
          const { data, error } = await db.auth.signUp({ email, password, options: { data: { full_name: name, phone, terms_accepted: true, terms_version: termsVersion }, emailRedirectTo: `${location.origin}${location.pathname}?view=account` } }); if (error) throw error;
          if (data.session) { try { await syncWishlist(data.user); } catch (_) { console.warn("[account] Wishlist sync was unavailable after sign-up."); } location.assign("?view=account"); }
          else { status.textContent = "If registration succeeds, check your email for a verification link, then sign in. If this address already has an account, sign in or use Forgot password."; status.className = "form-message is-info"; form.reset(); }
        }
      } catch (error) { status.textContent = authErrorMessage(error, form.id); status.className = "form-message is-error"; }
      finally { submit.disabled = false; submit.textContent = buttonText; }
      return;
    }
    if (event.target.id === "forgot-form") {
      event.preventDefault(); const form = event.target; const status = form.querySelector(".form-message"); const submit = form.querySelector('[type="submit"]'); const buttonText = submit.textContent; submit.disabled = true; submit.textContent = "Sendingâ€¦";
      try { const email = String(new FormData(form).get("email") || "").trim(); const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}?view=reset-password` }); if (error) throw error; status.textContent = "If an account matches that email, a password recovery link will arrive shortly."; status.className = "form-message is-info"; }
      catch (error) { const networkFailure = /network|fetch|timeout|connection|rate limit/i.test(String(error?.message || error)) || error?.name === "TypeError"; status.textContent = networkFailure ? authErrorMessage(error, "recovery") : "If an account matches that email, a password recovery link will arrive shortly."; status.className = networkFailure ? "form-message is-error" : "form-message is-info"; }
      finally { submit.disabled = false; submit.textContent = buttonText; }
      return;
    }
    if (event.target.id === "password-reset-form") {
      event.preventDefault(); const form = event.target; const values = new FormData(form); const status = form.querySelector(".form-message"); const submit = form.querySelector('[type="submit"]');
      if (values.get("password") !== values.get("confirm")) { status.textContent = "The passwords do not match."; status.className = "form-message is-error"; return; }
      const buttonText = submit.textContent; submit.disabled = true; submit.textContent = "Updatingâ€¦";
      try { const { error } = await db.auth.updateUser({ password: String(values.get("password")) }); if (error) throw error; status.textContent = "Password updated. You can now sign in with your new password."; status.className = "form-message is-info"; form.reset(); }
      catch (error) { status.textContent = authErrorMessage(error, "recovery"); status.className = "form-message is-error"; }
      finally { submit.disabled = false; submit.textContent = buttonText; }
      return;
    }
    if (event.target.id === "profile-form") {
      event.preventDefault(); const form = event.target; const values = new FormData(form); const status = form.querySelector(".form-message");
      let currentUser;
      try { const result = await db.auth.getUser(); if (result.error) throw result.error; currentUser = result.data?.user; }
      catch (error) { status.textContent = authErrorMessage(error); status.className = "form-message is-error"; return; }
      if (!currentUser || currentUser.is_anonymous) return renderAuth("login");
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        const payload = { full_name: String(values.get("name") || "").trim(), phone: String(values.get("phone") || "").trim() };
        if (!payload.full_name || payload.full_name.length > 120 || payload.phone.length > 40) throw new Error("Enter a name of up to 120 characters and a phone number of up to 40 characters.");
        const { error } = await db.from("profiles").update(payload).eq("id", currentUser.id);
        if (error) throw error;
        status.textContent = "Profile saved."; status.className = "form-message is-info";
      }
      catch (error) { status.textContent = String(error?.message || "").startsWith("Enter a name") ? error.message : authErrorMessage(error, "profile"); status.className = "form-message is-error"; }
      finally { submit.disabled = false; }
      return;
    }
    if (event.target.id === "address-form") {
      event.preventDefault(); const form = event.target; const values = new FormData(form); const status = form.querySelector(".form-message");
      let currentUser;
      try { const result = await db.auth.getUser(); if (result.error) throw result.error; currentUser = result.data?.user; }
      catch (error) { status.textContent = authErrorMessage(error); status.className = "form-message is-error"; return; }
      if (!currentUser || currentUser.is_anonymous) return renderAuth("login");
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      try { const id = String(values.get("id") || ""); const payload = Object.fromEntries(["label","recipient_name","phone","address_line1","address_line2","city","state","postal_code","country"].map((key) => [key, String(values.get(key) || "").trim()])); payload.user_id = currentUser.id; const checkedDefault = values.get("is_default") === "on"; if (checkedDefault || !id) { const { count, error: countError } = await db.from("customer_addresses").select("id",{head:true,count:"exact"}).eq("user_id",currentUser.id); if (countError) throw countError; payload.is_default = checkedDefault || count === 0; } else payload.is_default = false; if (payload.is_default) { const { error: clearError } = await db.from("customer_addresses").update({ is_default:false }).eq("user_id",currentUser.id); if (clearError) throw clearError; } if (id) payload.id = id; const { error } = await db.from("customer_addresses").upsert(payload, { onConflict:"id" }); if (error) throw error; await renderAccount(); }
      catch (error) { status.textContent = error.message || "The address could not be saved."; status.className = "form-message is-error"; }
      finally { submit.disabled = false; }
      return;
    }
    if (event.target.id === "filter-form") {
      event.preventDefault(); const f = new FormData(event.target); const url = new URL(location.href);
      url.searchParams.set("view", params.get("view") === "deals" ? "deals" : "shop");
      ["category","subcategory","min","max","sort"].forEach((key) => { const value = String(f.get(key) || "").trim(); if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); });
      location.href = url.href;
    }
    if (event.target.id === "review-form") {
      event.preventDefault(); const form=event.target; const values=new FormData(form); const status=form.querySelector(".form-message"); const {data:{user}}=await db.auth.getUser();
      if(!user){status.textContent="Sign in to submit a review.";return;}
      const {error}=await db.from("reviews").insert({product_id:String(values.get("product_id")),user_id:user.id,rating:Number(values.get("rating")),title:String(values.get("title")||"").trim()||null,body:String(values.get("body")||"").trim()});
      if(error){status.textContent=error.code==="23505"?"You have already reviewed this product for that order.":"Reviews are available after a delivered order.";status.className="form-message is-info";return;}
      status.textContent="Thanks. Your review is pending moderation.";status.className="form-message is-info";form.reset();
    }
    if (event.target.id === "payment-proof-form" || event.target.classList.contains("payment-proof-form")) {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector('[type="submit"]') || form.querySelector("button");
      const status = form.querySelector(".form-message");
      const file = form.elements.proof.files[0];
      if (!file || !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
        status.textContent = "Choose a JPEG, PNG, WebP, or PDF file under 5 MB.";
        status.className = "form-message is-error";
        return;
      }
      button.disabled = true;
      status.textContent = "Uploading receipt privatelyâ€¦";
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData.user) { status.textContent = "Sign in again before uploading proof."; button.disabled = false; return; }
      const orderId = String(new FormData(form).get("order_id"));
      const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const path = authData.user.id + "/" + orderId + "/" + crypto.randomUUID() + "." + extension;
      const { error: uploadError } = await db.storage.from("payment-proofs").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { status.textContent = uploadError.message; button.disabled = false; return; }
      const { data: submitted, error } = await db.functions.invoke("submit-payment-proof", { body: { order_id: orderId, proof_path: path } });
      if (error || !submitted?.payment_id) {
        await db.storage.from("payment-proofs").remove([path]);
        status.textContent = submitted?.error || "Proof could not be recorded. The order remains unpaid.";
        button.disabled = false;
        return;
      }
      status.textContent = "Receipt submitted. Payment remains pending until the seller verifies the transfer.";
      button.textContent = "Proof submitted";
    }
  });
  console.info("[catalog] Starting storefront catalog loader");
  loadCatalog();
})();
