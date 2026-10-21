(function () {
  "use strict";
  const config = window.SUPABASE_CONFIG || {};
  const storeHomeUrl = new URL("../index.html", document.currentScript.src).href;
  const db = window.supabase?.createClient && config.url && config.anonKey ? window.supabase.createClient(config.url, config.anonKey) : null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat("en-NG", { style:"currency", currency:"NGN", maximumFractionDigits:0 });
  let adminUser = null, categories = [], productRows = [], orderRows = [], customerRows = [], couponRows = [], reviewRows = [], bannerRows = [];
  const safe = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const slug = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  function notify(message, error = false) { const el = $("#global-message"); el.textContent = message; el.style.background = error ? "#8b3228" : "#282522"; el.classList.add("is-visible"); clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.remove("is-visible"), 3600); }
  function message(id, text, error = false) { const el = $(id); if (!el) return; el.textContent = text; el.style.color = error ? "#a3342a" : "#27704c"; }
  function date(value) { return value ? new Date(value).toLocaleDateString("en-NG") : "â€”"; }
  function imageUrl(path) { return path && path.startsWith("http") ? path : path ? db.storage.from("product-images").getPublicUrl(path).data.publicUrl : ""; }
  async function audit(action, entityType, entityId, details = {}) {
    const { error } = await db.from("admin_audit_logs").insert({ actor_id:adminUser.id, action, entity_type:entityType, entity_id:String(entityId || ""), details });
    if (error) console.warn("Admin audit insert failed");
  }
  function showSection(section) {
    $$(".admin-section").forEach((el) => el.classList.toggle("is-visible", el.id === `section-${section}`));
    $$(".nav-item").forEach((el) => el.classList.toggle("is-active", el.dataset.section === section));
    const button = $(`.nav-item[data-section="${section}"]`); $("#section-title").textContent = button?.innerText.trim().replace(/^\S+\s*/,"") || "Overview";
    ({ overview:loadOverview, products:loadProducts, categories:loadCategories, orders:loadOrders, customers:loadCustomers, inventory:loadInventory, coupons:loadCoupons, content:loadContent, reviews:loadReviews, reports:loadReports })[section]?.();
  }
  async function checkAdmin(user) {
    const { data, error } = await db.from("profiles").select("id,full_name,role,account_status").eq("id",user.id).maybeSingle();
    if (error || !data || data.role !== "admin" || data.account_status !== "active") { await db.auth.signOut(); throw new Error("This account is not authorized to access store administration."); }
    adminUser = user; $("#admin-user").textContent = data.full_name || user.email;
    $("#login-screen").hidden = true; $("#dashboard").hidden = false;
    document.querySelectorAll(".back-store,.admin-brand").forEach((link) => { link.href = storeHomeUrl; });
    history.replaceState({}, "", new URL("dashboard/", location.href).href);
    showSection("overview");
  }
  function assertClient() {
    if (db) return true;
    if (!window.supabase?.createClient) {
      $("#login-message").textContent = "The Supabase client library did not load. Check your connection and refresh the page.";
      return false;
    }
    const missing = [];
    if (!config.url) missing.push("project URL");
    if (!config.anonKey) missing.push("publishable key");
    $("#login-message").textContent = missing.length
      ? `Admin sign-in is missing the ${missing.join(" and ")}. Check marketplace/config.js and refresh the page.`
      : "Admin sign-in could not initialize Supabase. Check the browser console for a configuration error.";
    return false;
  }
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!assertClient()) return;
    const button = $("button[type=submit]",event.currentTarget); const buttonText = button.textContent; button.disabled = true; button.textContent = "Signing inâ€¦"; $("#login-message").textContent = "";
    const form = new FormData(event.currentTarget);
    try {
      const { data, error } = await db.auth.signInWithPassword({ email:String(form.get("email")).trim(), password:String(form.get("password")) });
      if (error) throw error;
      await checkAdmin(data.user);
    } catch (error) { $("#login-message").textContent = error.message || "Sign-in failed."; }
    finally { button.disabled = false; button.textContent = buttonText; }
  });
  $("#toggle-admin-password").addEventListener("click", () => {
    const input = $("#admin-password"); const visible = input.type === "password";
    input.type = visible ? "text" : "password"; $("#toggle-admin-password").textContent = visible ? "Hide" : "Show";
    $("#toggle-admin-password").setAttribute("aria-label", visible ? "Hide password" : "Show password");
  });
  $("#admin-forgot-password").addEventListener("click", async (event) => {
    event.preventDefault();
    if (!assertClient()) return;
    const email = $("#login-form").elements.email.value.trim();
    if (!email) { $("#login-message").textContent = "Enter your administrator email first. If it is registered, weâ€™ll send a recovery link."; return; }
    const link = event.currentTarget; link.setAttribute("aria-disabled", "true");
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: new URL("../index.html?view=reset-password", location.href).href });
      if (error) throw error;
    } catch (_) { /* Keep recovery responses generic to prevent account enumeration. */ }
    finally { $("#login-message").textContent = "If an account matches that email, a password recovery link will arrive shortly."; link.removeAttribute("aria-disabled"); }
  });
  $("#signout-button").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });
  $("#admin-nav").addEventListener("click", (event) => { const button = event.target.closest("[data-section]"); if (button) showSection(button.dataset.section); });
  document.addEventListener("click", (event) => { const link = event.target.closest("[data-goto]"); if (link) showSection(link.dataset.goto); });

  async function loadOverview() {
    const metricEl = $("#metrics"); metricEl.innerHTML = `<p class="loading">Loading live store metricsâ€¦</p>`;
    const [orders, products, profiles, pending] = await Promise.all([
      db.from("orders").select("id,order_number,customer_name,customer_email,total,payment_status,fulfillment_status,created_at",{count:"exact"}).order("created_at",{ascending:false}).limit(5000),
      db.from("products").select("id,name,sku,stock_quantity,low_stock_threshold",{count:"exact"}).limit(5000),
      db.from("profiles").select("id",{count:"exact",head:true}).eq("role","customer"),
      db.from("orders").select("id",{count:"exact",head:true}).eq("fulfillment_status","pending")
    ]);
    if (orders.error || products.error || profiles.error || pending.error) { metricEl.innerHTML = `<p class="feedback">Could not load database metrics.</p>`; return; }
    orderRows = orders.data || []; productRows = products.data || [];
    const paid = orderRows.filter((x) => x.payment_status === "paid"); const revenue = paid.reduce((sum,x) => sum + Number(x.total),0);
    metricEl.innerHTML = [["Paid revenue",money.format(revenue),"verified paid orders only"],["Orders",String(orders.count || 0),"all order records"],["Products",String(products.count || 0),"published, draft and archived"],["Customers",String(profiles.count || 0),"customer accounts only"],["Pending fulfillment",String(pending.count || 0),"orders awaiting fulfillment"]].map((m) => `<article class="metric-card"><span>${safe(m[0])}</span><strong>${safe(m[1])}</strong><small>${safe(m[2])}</small></article>`).join("");
    renderSalesChart(paid); renderLowStock(productRows); renderRecentOrders(orderRows);
  }
  function renderSalesChart(orders) {
    const days = Array.from({length:7},(_,i) => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-(6-i)); return { date:d, total:0 }; });
    orders.forEach((order) => { const day = days.find((x) => x.date.toDateString() === new Date(order.created_at).toDateString()); if (day) day.total += Number(order.total); });
    const max = Math.max(1,...days.map((x) => x.total));
    $("#sales-chart").innerHTML = days.some((x) => x.total) ? days.map((x) => `<div class="chart-day" title="${safe(money.format(x.total))}"><i style="height:${Math.max(4,x.total/max*100)}%"></i><small>${x.date.toLocaleDateString("en-NG",{weekday:"short"})}</small></div>`).join("") : `<p class="empty-note">No paid sales recorded in the last seven days.</p>`;
  }
  function renderLowStock(rows) {
    const low = rows.filter((p) => Number(p.stock_quantity) <= Number(p.low_stock_threshold)).slice(0,7);
    $("#low-stock-list").innerHTML = low.length ? low.map((p) => `<div class="compact-row"><span>${safe(p.name)}</span><strong>${Number(p.stock_quantity)} left</strong></div>`).join("") : `<p class="loading">No products are below their stock threshold.</p>`;
  }
  function renderRecentOrders(rows) {
    const list = rows.slice(0,8);
    $("#recent-orders").innerHTML = list.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Total</th></tr></thead><tbody>${list.map((o) => `<tr><td>${safe(o.order_number)}</td><td>${safe(o.customer_name)}</td><td><span class="pill ${o.payment_status === "paid" ? "green" : "orange"}">${safe(o.payment_status)}</span></td><td>${money.format(Number(o.total))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="loading">No orders yet.</p>`;
  }
  async function loadCategories() {
    const { data, error } = await db.from("categories").select("id,name,slug,parent_id,description,active,nav_visible,featured,sort_order,products(count)").order("sort_order").limit(500);
    if (error) { notify("Categories could not be loaded.",true); return; }
    categories = data || [];
    const roots = categories.filter((c) => !c.parent_id);
    const parentSelect = $("#category-parent");
    if (parentSelect) parentSelect.innerHTML = `<option value="">Top-level category</option>${roots.map((c) => `<option value="${safe(c.id)}">${safe(c.name)}</option>`).join("")}`;
    const productSelect = $("#product-category");
    if (productSelect) productSelect.innerHTML = `<option value="">Uncategorized</option>${categories.map((c) => `<option value="${safe(c.id)}">${c.parent_id ? "&rarr; " : ""}${safe(c.name)}</option>`).join("")}`;
    $("#categories-table").innerHTML = categories.length ? categories.map((c) => {
      const count = Number(c.products?.[0]?.count || 0);
      const children = categories.filter((child) => child.parent_id === c.id).length;
      const label = `${c.parent_id ? "-- " : ""}${c.name}`;
      return `<tr><td>${safe(label)} <span class="muted">/${safe(c.slug)}</span></td><td>${count}</td><td><span class="pill ${c.active?"green":""}">${c.active?"Visible":"Hidden"}</span></td><td>${c.nav_visible?"Shown":"Hidden"}</td><td>${c.featured?"Yes":"â€”"}</td><td><button data-action="edit-category" data-id="${safe(c.id)}">Edit</button> <button class="danger-button" data-action="delete-category" data-id="${safe(c.id)}" data-count="${count}" data-children="${children}">Delete</button></td></tr>`;
    }).join("") : `<tr><td colspan="6">No categories yet.</td></tr>`;
  }
  async function loadProducts() {
    const { data, error } = await db.from("products").select("id,name,sku,price,compare_at_price,stock_quantity,status,featured,category_id,description,variants,created_at,product_images(storage_path,sort_order)").order("created_at",{ascending:false}).limit(500);
    if (error) { notify("Products could not be loaded.",true); return; }
    productRows = data || [];
    const q = $("#product-search").value.toLowerCase(); const status = $("#product-status-filter").value;
    const rows = productRows.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q) && (!status || p.status === status));
    $("#products-table").innerHTML = rows.length ? rows.map((p) => { const img = (p.product_images || []).sort((a,b)=>a.sort_order-b.sort_order)[0]?.storage_path; return `<tr><td><div class="table-product">${img ? `<img src="${safe(imageUrl(img))}" alt="">` : ""}<strong>${safe(p.name)}</strong></div></td><td>${safe(p.sku)}</td><td>${money.format(Number(p.price))}</td><td>${Number(p.stock_quantity)}</td><td><span class="pill ${p.status === "active" ? "green" : p.status === "draft" ? "orange" : ""}">${safe(p.status)}</span></td><td><div class="table-actions"><button data-action="edit-product" data-id="${safe(p.id)}">Edit</button><button class="danger-button" data-action="delete-product" data-id="${safe(p.id)}">Delete</button></div></td></tr>`; }).join("") : `<tr><td colspan="6">No products match those filters.</td></tr>`;
    await loadCategories();
  }
  function resetProductForm() { $("#product-form").reset(); $("#product-form [name=id]").value=""; $("#product-form [name=status]").value="draft"; $("#product-form [name=stock_quantity]").disabled=false; $("#product-editor-title").textContent="Add a product"; }
  function editProduct(id) {
    const p = productRows.find((x) => x.id === id); if (!p) return;
    const form = $("#product-form");
    for (const key of ["id","name","sku","category_id","price","compare_at_price","stock_quantity","description","status"]) form.elements[key].value = p[key] ?? "";
    form.elements.stock_quantity.disabled=true;
    form.elements.variants.value = [...new Set((p.variants || []).map((v) => v.size || "").filter(Boolean))].join(", "); form.elements.colors.value = [...new Set((p.variants || []).map((v) => v.color || "").filter(Boolean))].join(", "); form.elements.featured.checked = p.featured;
    $("#product-editor-title").textContent = "Edit product"; $("#product-editor").hidden = false; $("#product-editor").scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function uploadProductImage(file, productId) {
    if (!file) return null;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Choose a JPEG, PNG or WebP image under 5 MB.");
    const clean = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g,"-").slice(-90);
    const path = `products/${productId}/${crypto.randomUUID()}-${clean}`;
    const { error } = await db.storage.from("product-images").upload(path,file,{contentType:file.type,upsert:false});
    if (error) throw error; return path;
  }
  $("#new-product").addEventListener("click", () => { resetProductForm(); $("#product-editor").hidden=false; $("#product-editor").scrollIntoView({behavior:"smooth",block:"start"}); });
  $("#cancel-product").addEventListener("click", () => { $("#product-editor").hidden=true; resetProductForm(); });
  $("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form=event.currentTarget; const values=new FormData(form); const id=String(values.get("id")||""); const name=String(values.get("name")||"").trim(); const price=Number(values.get("price")); const compare=String(values.get("compare_at_price")||""); const stock=Number(values.get("stock_quantity"));
    if (!name || !Number.isFinite(price) || price<0 || !Number.isInteger(stock) || stock<0 || (compare && Number(compare)<price)) { message("#product-message","Check product name, price, comparison price and stock.",true); return; }
    const button=form.querySelector('[type="submit"]'); button.disabled=true; message("#product-message","Saving productâ€¦");
    try {
      const idForImage=id || crypto.randomUUID();
      const sizes=String(values.get("variants")||"").split(",").map((v)=>v.trim()).filter(Boolean); const colors=String(values.get("colors")||"").split(",").map((v)=>v.trim()).filter(Boolean);
      const variants=sizes.length&&colors.length?sizes.flatMap((size)=>colors.map((color)=>({size,color}))):sizes.length?sizes.map((size)=>({size})):colors.map((color)=>({color}));
      if(variants.length>50){message("#product-message","A product can have up to 50 size and color combinations.",true);return;}
      const payload={id:idForImage,name,slug:slug(name),sku:String(values.get("sku")).trim(),description:String(values.get("description")||"").trim(),category_id:String(values.get("category_id")||"")||null,price,compare_at_price:compare?Number(compare):null,variants,featured:form.elements.featured.checked,status:String(values.get("status")),published_at:form.elements.status.value==="active"?new Date().toISOString():null,updated_at:new Date().toISOString()};
      if(id){const {error}=await db.from("products").update(payload).eq("id",id);if(error)throw error;}
      else {payload.stock_quantity=0;const {error}=await db.from("products").insert(payload);if(error)throw error;if(stock){const {error:stockError}=await db.rpc("adjust_product_stock",{p_product_id:idForImage,p_delta:stock,p_reason:"Initial product stock"});if(stockError)throw stockError;}}
      const file=form.elements.image.files[0]; if(file){ const path=await uploadProductImage(file,idForImage); const oldImages=productRows.find((p)=>p.id===idForImage)?.product_images||[]; if(oldImages.length){ await db.storage.from("product-images").remove(oldImages.map((x)=>x.storage_path)); const {error:removeError}=await db.from("product_images").delete().eq("product_id",idForImage); if(removeError) throw removeError; } const {error:imageError}=await db.from("product_images").insert({product_id:idForImage,storage_path:path,alt_text:name,sort_order:0}); if(imageError) throw imageError; }
      await audit(id?"product.update":"product.create","product",idForImage,{name,sku:payload.sku}); message("#product-message","Product saved."); await loadProducts(); await loadOverview(); setTimeout(()=>{$("#product-editor").hidden=true;resetProductForm();},500);
    } catch(error){ message("#product-message",error.message||"Product could not be saved.",true); }
    finally {button.disabled=false;}
  });
  $("#product-search").addEventListener("input",loadProducts); $("#product-status-filter").addEventListener("change",loadProducts);

  function dateTimeLocal(value){if(!value)return "";const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  async function loadContent(){
    const [banners,contact,payment]=await Promise.all([db.from("homepage_banners").select("id,title,body,image_path,destination_url,active,starts_at,ends_at,sort_order,created_at").order("sort_order").limit(200),db.from("store_settings").select("value").eq("key","contact").maybeSingle(),db.from("store_settings").select("value").eq("key","payment").maybeSingle()]);
    if(banners.error||contact.error||payment.error){notify("Store content or payment settings could not be loaded.",true);return;}
    bannerRows=banners.data||[];const settings=contact.data?.value||{};const settingsForm=$("#store-settings-form");settingsForm.elements.email.value=settings.email||"";settingsForm.elements.phone.value=settings.phone||"";settingsForm.elements.whatsapp.value=settings.whatsapp||"";
    const pay=payment.data?.value||{};const paymentForm=$("#payment-settings-form");paymentForm.elements.manual_transfer_enabled.checked=pay.manual_transfer_enabled!==false;
    $("#banners-table").innerHTML=bannerRows.length?bannerRows.map((b)=>`<tr><td><strong>${safe(b.title)}</strong><br><span class="muted">${safe(b.destination_url||"No destination")}</span></td><td>${date(b.starts_at)} â€“ ${date(b.ends_at)}</td><td><span class="pill ${b.active?"green":"orange"}">${b.active?"Published":"Hidden"}</span></td><td><button data-action="edit-banner" data-id="${safe(b.id)}">Edit</button> <button data-action="toggle-banner" data-id="${safe(b.id)}" data-active="${b.active}">${b.active?"Unpublish":"Publish"}</button> <button class="danger-button" data-action="delete-banner" data-id="${safe(b.id)}">Delete</button></td></tr>`).join(""):`<tr><td colspan="4">No homepage banners yet.</td></tr>`;
  }
  $("#reset-banner").addEventListener("click",()=>$("#banner-form").reset());
  $("#banner-form").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;const f=new FormData(form);const id=String(f.get("id")||"");const starts=String(f.get("starts_at")||"");const ends=String(f.get("ends_at")||"");if(starts&&ends&&new Date(starts)>=new Date(ends)){message("#banner-message","End time must follow start time.",true);return;}const title=String(f.get("title")||"").trim();const payload={title,body:String(f.get("body")||"").trim()||null,image_path:String(f.get("image_path")||"").trim()||null,destination_url:String(f.get("destination_url")||"").trim()||null,sort_order:Number(f.get("sort_order"))||0,active:form.elements.active.checked,starts_at:starts?new Date(starts).toISOString():null,ends_at:ends?new Date(ends).toISOString():null};if(!title){message("#banner-message","Enter a banner title.",true);return;}const result=id?await db.from("homepage_banners").update(payload).eq("id",id):await db.from("homepage_banners").insert(payload);if(result.error){message("#banner-message",result.error.message,true);return;}await audit(id?"banner.update":"banner.create","homepage_banner",id||title,{active:payload.active});form.reset();form.elements.id.value="";message("#banner-message","Homepage banner saved.");loadContent();});
  $("#store-settings-form").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;const f=new FormData(form);const value={email:String(f.get("email")||"").trim(),phone:String(f.get("phone")||"").trim(),whatsapp:String(f.get("whatsapp")||"").trim()};const {error}=await db.from("store_settings").upsert({key:"contact",value,public_read:true,updated_at:new Date().toISOString()},{onConflict:"key"});if(error){message("#settings-message",error.message,true);return;}await audit("settings.contact_update","store_setting","contact");message("#settings-message","Contact details saved.");});
  $("#payment-settings-form").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;const value={paystack_enabled:false,manual_transfer_enabled:form.elements.manual_transfer_enabled.checked};const {error}=await db.from("store_settings").upsert({key:"payment",value,public_read:true,updated_at:new Date().toISOString()},{onConflict:"key"});if(error){message("#payment-settings-message",error.message,true);return;}await audit("settings.payment_update","store_setting","payment",{paystack_enabled:value.paystack_enabled,manual_transfer_enabled:value.manual_transfer_enabled});message("#payment-settings-message","Payment options saved.");});
  async function loadOrders() {
    const {data,error}=await db.from("orders").select("id,order_number,user_id,customer_name,customer_email,customer_phone,delivery_address,total,agreed_total,payment_method,subtotal,shipping_fee,discount_total,currency,payment_status,negotiation_status,fulfillment_status,tracking_number,created_at,order_items(product_name,sku,variant,quantity,unit_price,line_total),payments(id,provider,provider_reference,amount,status,proof_path,rejection_reason,submitted_at,created_at,verified_at,reviewed_at,reviewed_by)").order("created_at",{ascending:false}).limit(500);
    if(error){notify("Orders could not be loaded. Confirm the ordering/payment migration is installed.",true);return;}
    orderRows=data||[];
    await Promise.all(orderRows.flatMap((order)=>(order.payments||[]).filter((payment)=>payment.proof_path).map(async(payment)=>{
      const {data:signed,error:signedError}=await db.storage.from("payment-proofs").createSignedUrl(payment.proof_path,900);
      payment.proof_url=signedError?null:signed?.signedUrl||null;
    })));
    renderOrderTable();
  }
  function renderOrderTable(){
    const q=$("#order-search").value.toLowerCase();
    const status=$("#order-status-filter").value;
    const rows=orderRows.filter((o)=>String(o.order_number+" "+o.customer_name+" "+o.customer_email).toLowerCase().includes(q)&&(!status||o.fulfillment_status===status));
    $("#orders-table").innerHTML=rows.length?rows.map((o)=>{
      const address=o.delivery_address||{};
      const items=(o.order_items||[]).map((i)=>{
        const variant=Object.entries(i.variant||{}).map(([key,value])=>safe(key)+": "+safe(value)).join(", ");
        return "<li>"+safe(i.product_name)+" Ã— "+i.quantity+(variant?" Â· "+variant:"")+" â€” "+money.format(Number(i.line_total))+"</li>";
      }).join("");
      const payment=(o.payments||[]).slice().sort((a,b)=>new Date(b.submitted_at||0)-new Date(a.submitted_at||0))[0];
      const payState=o.payment_status==="paid"?"Paid":o.fulfillment_status==="cancelled"?"Order cancelled â€” unpaid":o.negotiation_status==="awaiting_agreement"?"Awaiting price confirmation":payment?.status==="pending_verification"?"Awaiting manual verification":payment?.status==="rejected"?"Proof rejected â€” awaiting new proof":payment?.status==="initialized"?"Awaiting Paystack payment":"Awaiting proof";
      const proof=payment?.proof_path?(payment.proof_url?"<a target=\"_blank\" rel=\"noopener noreferrer\" href=\""+safe(payment.proof_url)+"\">View private proof</a>":"<span>Proof link unavailable</span>"):"No proof submitted";
      const history=(o.payments||[]).length?"<details><summary>Payment history ("+(o.payments||[]).length+")</summary><ul>"+(o.payments||[]).map((attempt)=>"<li>"+safe(attempt.provider)+" Â· "+safe(attempt.status)+" Â· "+money.format(Number(attempt.amount))+" Â· "+date(attempt.submitted_at||attempt.reviewed_at||attempt.verified_at||attempt.created_at)+(attempt.rejection_reason?" Â· "+safe(attempt.rejection_reason):"")+(attempt.reviewed_at?" Â· Reviewed "+date(attempt.reviewed_at):"")+"</li>").join("")+"</ul></details>":"";
      const review=payment?.provider==="manual_transfer"&&payment.status==="pending_verification"?"<label>Review reason <input data-payment-reason=\""+safe(payment.id)+"\" maxlength=\"500\" placeholder=\"Required to reject\"></label><button data-action=\"review-payment\" data-id=\""+safe(payment.id)+"\" data-approve=\"true\">Confirm received</button><button data-action=\"review-payment\" data-id=\""+safe(payment.id)+"\" data-approve=\"false\">Reject proof</button>":"";
      const selected=(value,current)=>value===current?" selected":"";
      return "<tr data-order-row=\""+safe(o.id)+"\"><td><strong>"+safe(o.order_number)+"</strong><br><small>"+date(o.created_at)+"</small></td><td>"+safe(o.customer_name)+"<br>"+safe(o.customer_email)+"<br>"+safe(o.customer_phone)+"<details><summary>Delivery details</summary>"+safe(address.address||"")+"<br>"+safe([address.city,address.state,address.country].filter(Boolean).join(", "))+(address.location_link?"<br><a target=\"_blank\" rel=\"noopener noreferrer\" href=\""+safe(address.location_link)+"\">Open shared location</a>":"")+(address.note?"<br>Instructions: "+safe(address.note):"")+"</details></td><td><details><summary>"+(o.order_items||[]).length+" item(s)</summary><ul>"+items+"</ul></details></td><td>Current: "+money.format(Number(o.total))+"<br><label>Agreed total<input data-field=\"agreed_total\" type=\"number\" min=\"0\" step=\"0.01\" value=\""+safe(o.agreed_total??"")+"\"></label><label>Negotiation<select data-field=\"negotiation_status\"><option value=\"not_requested\""+selected("not_requested",o.negotiation_status)+">Not requested</option><option value=\"awaiting_agreement\""+selected("awaiting_agreement",o.negotiation_status)+">Awaiting agreement</option><option value=\"confirmed\""+selected("confirmed",o.negotiation_status)+">Price confirmed</option><option value=\"declined\""+selected("declined",o.negotiation_status)+">Declined</option></select></label></td><td><span class=\"pill "+(o.payment_status==="paid"?"green":"orange")+"\">"+safe(payState)+"</span><br>"+safe(payment?.provider||o.payment_method||"No payment method")+"<br>"+proof+"<br>"+history+(payment?.rejection_reason?"<br>Reason: "+safe(payment.rejection_reason):"")+"<br>"+review+"</td><td><select class=\"order-status-select\" data-field=\"fulfillment_status\" aria-label=\"Fulfillment status\">"+["pending","processing","shipped","delivered","cancelled"].map((s)=>"<option"+selected(s,o.fulfillment_status)+">"+s+"</option>").join("")+"</select></td><td><input class=\"tracking-input\" data-field=\"tracking_number\" value=\""+safe(o.tracking_number||"")+"\" placeholder=\"Tracking number\"></td><td><button data-action=\"save-order\" data-id=\""+safe(o.id)+"\">Save</button></td></tr>";
    }).join(""):"<tr><td colspan=\"8\">No orders found.</td></tr>";
  }
  $("#order-search").addEventListener("input",renderOrderTable); $("#order-status-filter").addEventListener("change",renderOrderTable);
  async function loadCustomers(){
    const [profiles,orders]=await Promise.all([db.from("profiles").select("id,full_name,email,phone,role,account_status,created_at").eq("role","customer").order("created_at",{ascending:false}).limit(500),db.from("orders").select("user_id,id").limit(5000)]);
    if(profiles.error||orders.error){notify("Customer records could not be loaded.",true);return;} const counts={}; (orders.data||[]).forEach((o)=>counts[o.user_id]=(counts[o.user_id]||0)+1); customerRows=(profiles.data||[]).map((p)=>({...p,order_count:counts[p.id]||0})); renderCustomerTable();
  }
  function renderCustomerTable(){const q=$("#customer-search").value.toLowerCase(); const rows=customerRows.filter((p)=>`${p.full_name} ${p.email||""} ${p.phone||""}`.toLowerCase().includes(q)); $("#customers-table").innerHTML=rows.length?rows.map((p)=>`<tr><td>${safe(p.full_name||"Customer")}<br><span class="muted">${safe(p.email||p.id)}</span></td><td>${safe(p.phone||"â€”")}</td><td>${date(p.created_at)}</td><td><span class="pill ${p.account_status==="active"?"green":"orange"}">${safe(p.account_status)}</span></td><td>${p.order_count}</td><td><button data-action="toggle-customer" data-id="${safe(p.id)}" data-status="${safe(p.account_status)}">${p.account_status==="active"?"Suspend":"Reactivate"}</button></td></tr>`).join(""):`<tr><td colspan="6">No customer accounts found.</td></tr>`;}
  $("#customer-search").addEventListener("input",renderCustomerTable);
  async function loadInventory(){if(!productRows.length||!("status" in productRows[0])) await loadProducts(); $("#inventory-table").innerHTML=productRows.map((p)=>`<tr><td>${safe(p.name)}</td><td>${safe(p.sku)}</td><td><span class="pill ${Number(p.stock_quantity)<=Number(p.low_stock_threshold)?"orange":"green"}">${Number(p.stock_quantity)}</span></td><td>${Number(p.low_stock_threshold)}</td><td>${date(p.updated_at)}</td></tr>`).join("")||`<tr><td colspan="5">No products.</td></tr>`;}
  $("#inventory-form").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;const f=new FormData(form);const {data,error}=await db.rpc("adjust_product_stock",{p_product_id:String(f.get("product_id")),p_delta:Number(f.get("delta")),p_reason:String(f.get("reason")).trim()});if(error){notify(error.message,true);return;}notify(`Inventory updated. New stock: ${data}`);form.reset();await loadProducts();await loadInventory();await loadOverview();});
  function resetCategoryForm(){const form=$("#category-form");form.reset();form.elements.id.value="";$("#category-submit").textContent="Create category";$("#cancel-category").hidden=true;}
  function editCategory(id){const c=categories.find((x)=>x.id===id);if(!c)return;const form=$("#category-form");form.elements.id.value=c.id;form.elements.name.value=c.name;form.elements.slug.value=c.slug;form.elements.parent_id.value=c.parent_id||"";form.elements.sort_order.value=c.sort_order||0;form.elements.description.value=c.description||"";form.elements.active.checked=c.active;form.elements.nav_visible.checked=c.nav_visible;form.elements.featured.checked=c.featured;$("#category-submit").textContent="Save category";$("#cancel-category").hidden=false;form.scrollIntoView({behavior:"smooth",block:"center"});}
  $("#cancel-category").addEventListener("click",resetCategoryForm);
  $("#category-form").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;const f=new FormData(form);const id=String(f.get("id")||"");const name=String(f.get("name")||"").trim();const categorySlug=slug(String(f.get("slug")||name));const payload={name,slug:categorySlug,parent_id:String(f.get("parent_id")||"")||null,description:String(f.get("description")||"").trim()||null,sort_order:Number(f.get("sort_order"))||0,active:form.elements.active.checked,nav_visible:form.elements.nav_visible.checked,featured:form.elements.featured.checked};if(!name||!categorySlug){message("#category-message","Enter a category name and valid slug.",true);return;}const result=id?await db.from("categories").update(payload).eq("id",id):await db.from("categories").insert(payload);if(result.error){message("#category-message",result.error.message,true);return;}await audit(id?"category.update":"category.create","category",id||categorySlug,{name,parent_id:payload.parent_id,active:payload.active});resetCategoryForm();message("#category-message",id?"Category updated.":"Category created.");await loadCategories();await loadProducts();});  async function loadCoupons(){const {data,error}=await db.from("coupons").select("id,code,discount_type,discount_amount,usage_count,usage_limit,starts_at,expires_at,enabled").order("created_at",{ascending:false}).limit(500);if(error){notify("Coupons could not be loaded.",true);return;}couponRows=data||[];$("#coupons-table").innerHTML=couponRows.length?couponRows.map((c)=>`<tr><td><strong>${safe(c.code)}</strong></td><td>${c.discount_type==="percent"?`${Number(c.discount_amount)}%`:money.format(Number(c.discount_amount))}</td><td>${c.usage_count}${c.usage_limit?` / ${c.usage_limit}`:""}</td><td>${date(c.starts_at)}</td><td>${date(c.expires_at)}</td><td><span class="pill ${c.enabled?"green":""}">${c.enabled?"Enabled":"Disabled"}</span></td><td><button data-action="toggle-coupon" data-id="${safe(c.id)}" data-enabled="${c.enabled}">${c.enabled?"Disable":"Enable"}</button> <button class="danger-button" data-action="delete-coupon" data-id="${safe(c.id)}">Delete</button></td></tr>`).join(""):`<tr><td colspan="7">No coupons set up.</td></tr>`;}
  $("#coupon-form").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;const f=new FormData(form);const amount=Number(f.get("discount_amount"));const type=String(f.get("discount_type"));if(amount<=0||(type==="percent"&&amount>100)){message("#coupon-message","Enter a valid discount amount.",true);return;}const start=String(f.get("starts_at")||"");const exp=String(f.get("expires_at")||"");if(start&&exp&&new Date(start)>=new Date(exp)){message("#coupon-message","Expiration must be after the start date.",true);return;}const {error}=await db.from("coupons").insert({code:String(f.get("code")).trim().toUpperCase(),discount_type:type,discount_amount:amount,minimum_order:Number(f.get("minimum_order"))||0,usage_limit:String(f.get("usage_limit")||"")?Number(f.get("usage_limit")):null,starts_at:start?new Date(start).toISOString():null,expires_at:exp?new Date(exp).toISOString():null,enabled:form.elements.enabled.checked});if(error){message("#coupon-message",error.message,true);return;}await audit("coupon.create","coupon",String(f.get("code")).toUpperCase());form.reset();message("#coupon-message","Coupon created.");loadCoupons();});
  async function loadReviews(){const {data,error}=await db.from("reviews").select("id,rating,title,body,moderation_status,created_at,profiles(full_name),products(name)").order("created_at",{ascending:false}).limit(500);if(error){notify("Reviews could not be loaded.",true);return;}reviewRows=data||[];$("#reviews-table").innerHTML=reviewRows.length?reviewRows.map((r)=>`<tr><td>${safe(r.products?.name||"Deleted product")}</td><td>${r.rating} / 5</td><td class="review-body">${safe(r.title||"")} ${safe(r.body)}</td><td>${safe(r.profiles?.full_name||"Customer")}</td><td>${date(r.created_at)}</td><td><div class="review-actions"><select data-review-status="${safe(r.id)}"><option value="pending" ${r.moderation_status==="pending"?"selected":""}>Pending</option><option value="approved" ${r.moderation_status==="approved"?"selected":""}>Approved</option><option value="rejected" ${r.moderation_status==="rejected"?"selected":""}>Rejected</option></select><button data-action="save-review" data-id="${safe(r.id)}">Save</button></div></td></tr>`).join(""):`<tr><td colspan="6">No customer reviews have been submitted.</td></tr>`;}
  async function loadReports(){const from=$("#report-from").value;const to=$("#report-to").value;if(from&&to&&from>to){notify("Report start date must be before its end date.",true);return;}let query=db.from("orders").select("order_number,customer_name,customer_email,total,payment_status,fulfillment_status,tracking_number,created_at").order("created_at",{ascending:false}).limit(5000);if(from)query=query.gte("created_at",new Date(`${from}T00:00:00`).toISOString());if(to)query=query.lte("created_at",new Date(`${to}T23:59:59.999`).toISOString());const {data,error}=await query;if(error){notify("Reports could not be loaded.",true);return;}const rows=data||[];orderRows=rows;const paid=rows.filter((x)=>x.payment_status==="paid");const total=paid.reduce((s,x)=>s+Number(x.total),0);$("#report-summary").innerHTML=`<div class="metric-grid"><article class="metric-card"><span>Paid revenue</span><strong>${money.format(total)}</strong><small>${paid.length} verified paid orders</small></article><article class="metric-card"><span>All orders</span><strong>${rows.length}</strong><small>${from||"All time"}${to?` to ${to}`:""}</small></article><article class="metric-card"><span>Open fulfillment</span><strong>${rows.filter((x)=>["pending","processing","shipped"].includes(x.fulfillment_status)).length}</strong><small>not delivered or cancelled</small></article></div>`;let bestQuery=db.from("order_items").select("product_name,quantity,line_total,orders!inner(payment_status,created_at)").eq("orders.payment_status","paid").limit(10000);if(from)bestQuery=bestQuery.gte("orders.created_at",new Date(`${from}T00:00:00`).toISOString());if(to)bestQuery=bestQuery.lte("orders.created_at",new Date(`${to}T23:59:59.999`).toISOString());const best=await bestQuery;const totals=new Map();(best.data||[]).forEach((i)=>{const key=i.product_name;const row=totals.get(key)||{quantity:0,total:0};row.quantity+=Number(i.quantity);row.total+=Number(i.line_total);totals.set(key,row);});const top=[...totals.entries()].sort((a,b)=>b[1].quantity-a[1].quantity).slice(0,10);$("#best-sellers-table").innerHTML=best.error?`<tr><td colspan="3">Sales detail unavailable.</td></tr>`:top.length?top.map(([name,row])=>`<tr><td>${safe(name)}</td><td>${row.quantity}</td><td>${money.format(row.total)}</td></tr>`).join(""):`<tr><td colspan="3">No paid product sales in this date range.</td></tr>`;}
  $("#apply-report-range").addEventListener("click",loadReports);
  function exportCsv(){const rows=orderRows;if(!rows.length){notify("Load orders before exporting.");return;}const fields=["order_number","customer_name","customer_email","total","payment_status","fulfillment_status","tracking_number","created_at"];const csv=[fields.join(","),...rows.map((o)=>fields.map((key)=>`"${String(o[key]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="zahara-orders-report.csv";a.click();URL.revokeObjectURL(a.href);}
  $("#export-orders").addEventListener("click",async()=>{if(!orderRows.length)await loadOrders();exportCsv();});
  $("#export-inventory").addEventListener("click",async()=>{if(!productRows.length||!("status" in productRows[0]))await loadProducts();const rows=productRows;const csv=["name,sku,stock_quantity,low_stock_threshold,status",...rows.map((p)=>[p.name,p.sku,p.stock_quantity,p.low_stock_threshold,p.status].map((v)=>`"${String(v??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download="zahara-inventory-report.csv";a.click();URL.revokeObjectURL(a.href);});

  document.addEventListener("click",async(event)=>{
    const button=event.target.closest("[data-action]");if(!button)return;const {action,id}=button.dataset;
    try{
      if(action==="edit-product")editProduct(id); if(action==="edit-category")editCategory(id);
      if(action==="edit-banner"){const b=bannerRows.find((row)=>row.id===id);if(!b)return;const form=$("#banner-form");Object.entries({id:b.id,title:b.title,body:b.body||"",image_path:b.image_path||"",destination_url:b.destination_url||"",sort_order:b.sort_order,starts_at:dateTimeLocal(b.starts_at),ends_at:dateTimeLocal(b.ends_at),active:b.active}).forEach(([key,value])=>{const field=form.elements.namedItem(key);if(field)field.type==="checkbox"?field.checked=!!value:field.value=value??"";});form.scrollIntoView({behavior:"smooth",block:"center"});}
      if(action==="toggle-banner"){const current=bannerRows.find((row)=>row.id===id);const active=!current.active;const {error}=await db.from("homepage_banners").update({active}).eq("id",id);if(error)throw error;await audit("banner.toggle","homepage_banner",id,{active});notify(`Banner ${active?"published":"unpublished"}.`);await loadContent();}
      if(action==="delete-banner"){if(!confirm("Delete this homepage banner?"))return;const {error}=await db.from("homepage_banners").delete().eq("id",id);if(error)throw error;await audit("banner.delete","homepage_banner",id);notify("Banner deleted.");await loadContent();}
      if(action==="delete-product"){const p=productRows.find((x)=>x.id===id);if(!confirm(`Delete â€œ${p?.name||"this product"}â€? Existing order records will retain their saved product snapshots.`))return;const {error}=await db.from("products").delete().eq("id",id);if(error)throw error;await audit("product.delete","product",id,{name:p?.name});notify("Product deleted.");await loadProducts();}
      if(action==="delete-category"){if(Number(button.dataset.children)>0){notify("Move or remove nested categories first.",true);return;}if(Number(button.dataset.count)>0){notify("This category still has products. Reassign them before deleting the category.",true);return;}if(!confirm("Delete this empty category?"))return;const {error}=await db.from("categories").delete().eq("id",id);if(error)throw error;await audit("category.delete","category",id);notify("Category deleted.");loadCategories();}
      if(action==="save-order"){
        const row=$("[data-order-row=\"" + CSS.escape(id) + "\"]");
        const fulfillment_status=$("[data-field=fulfillment_status]",row).value;
        const tracking_number=$("[data-field=tracking_number]",row).value.trim();
        const negotiation_status=$("[data-field=negotiation_status]",row).value;
        const agreedValue=$("[data-field=agreed_total]",row).value.trim();
        const current=orderRows.find((o)=>o.id===id);
        const hasOpenPayment=(current.payments||[]).some((payment)=>["initialized","pending_verification"].includes(payment.status));
        if(current.payment_status!=="paid"&&fulfillment_status!=="pending"&&!(fulfillment_status==="cancelled"&&!hasOpenPayment&&!current.payment_method)){notify("Only paid orders can move into fulfillment; cancel an unpaid order only after resolving payment attempts.",true);return;}
        if(negotiation_status==="confirmed"&&(!agreedValue||!Number.isFinite(Number(agreedValue))||Number(agreedValue)<0)){notify("Enter the final agreed total before confirming the price.",true);return;}
        const {error}=await db.from("orders").update({fulfillment_status,tracking_number:tracking_number||null,negotiation_status,agreed_total:agreedValue?Number(agreedValue):null,updated_at:new Date().toISOString()}).eq("id",id);
        if(error)throw error;
        await audit("order.admin_update","order",id,{fulfillment_status,negotiation_status,agreed_total:agreedValue?Number(agreedValue):null});
        notify("Order and price agreement saved. Payment status was not changed.");
        await loadOrders();await loadOverview();
      }
      if(action==="review-payment"){
        const approve=button.dataset.approve==="true";
        const reason=$("[data-payment-reason=\"" + CSS.escape(id) + "\"]")?.value.trim()||"";
        if(!approve&&!reason){notify("Enter a reason before rejecting the proof.",true);return;}
        if(approve&&!confirm("Confirm that the transfer was received in the store bank account?"))return;
        button.disabled=true;
        const {data,error}=await db.functions.invoke("review-manual-payment",{body:{payment_id:id,approve,reason}});
        if(error||!data?.order_id)throw new Error(data?.error||"Payment review could not be recorded.");
        notify(approve?"Transfer verified and order marked paid.":"Proof rejected. The order remains unpaid.");
        await loadOrders();await loadOverview();
      }
      if(action==="toggle-customer"){const status=button.dataset.status==="active"?"suspended":"active";if(!confirm(`${status==="suspended"?"Suspend":"Reactivate"} this customer account?`))return;const {error}=await db.from("profiles").update({account_status:status}).eq("id",id);if(error)throw error;await audit(`customer.${status}`,"profile",id);notify(`Customer ${status}.`);loadCustomers();}
      if(action==="toggle-coupon"){const current=couponRows.find((x)=>x.id===id);const {error}=await db.from("coupons").update({enabled:!current.enabled}).eq("id",id);if(error)throw error;await audit("coupon.toggle","coupon",id,{enabled:!current.enabled});notify("Coupon status updated.");loadCoupons();}
      if(action==="delete-coupon"){if(!confirm("Delete this coupon?"))return;const {error}=await db.from("coupons").delete().eq("id",id);if(error)throw error;await audit("coupon.delete","coupon",id);notify("Coupon deleted.");loadCoupons();}
      if(action==="save-review"){const status=$(`[data-review-status="${CSS.escape(id)}"]`).value;const {error}=await db.from("reviews").update({moderation_status:status}).eq("id",id);if(error)throw error;await audit("review.moderate","review",id,{status});notify("Review moderation saved.");loadReviews();}
    }catch(error){notify(error.message||"The action could not be completed.",true);}
  });

  if(!db){assertClient();}else{db.auth.getSession().then(({data})=>{if(data.session)checkAdmin(data.session.user).catch((e)=>{ $("#login-message").textContent=e.message; });});}
})();
