(function () {
    var CART_KEY = "luxeScentCart";

    function getCart() {
        var raw = localStorage.getItem(CART_KEY);
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }

    function saveCart(cart) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
    }

    function formatPrice(value) {
        var num = Number(value) || 0;
        return "₦" + num.toLocaleString("en-NG");
    }

    function updateCartCount() {
        var cart = getCart();
        var count = 0;
        for (var i = 0; i < cart.length; i++) {
            count += cart[i].qty;
        }
        var el = document.getElementById("cart-count");
        if (el) {
            el.textContent = count;
            el.style.display = count ? "inline-flex" : "none";
        }
    }

    function renderMiniCart() {
        var cart = getCart();
        var list = document.getElementById("cart-items");
        var totalBox = document.getElementById("cart-total");
        if (!list) return;

        var total = 0;
        if (cart.length === 0) {
            list.innerHTML = "<p class=\"cart-empty\">Your cart is empty. Add a fragrance to get started.</p>";
            if (totalBox) totalBox.style.display = "none";
        } else {
            var html = "";
            for (var i = 0; i < cart.length; i++) {
                var item = cart[i];
                var line = item.price * item.qty;
                total += line;
                html +=
                    "<div class=\"cart-item\">" +
                    "<span class=\"item-name\">" + item.name + " &times; " + item.qty + "</span>" +
                    "<span class=\"item-qty\">" + formatPrice(line) + "</span>" +
                    "</div>";
            }
            list.innerHTML = html;
            if (totalBox) {
                totalBox.style.display = "block";
                var subtotalEl = document.getElementById("cart-subtotal");
                if (subtotalEl) subtotalEl.textContent = formatPrice(total);
            }
        }
    }

    function addToCart(card) {
        var id = card.getAttribute("data-id");
        var name = card.getAttribute("data-name");
        var price = parseFloat(card.getAttribute("data-price"));
        var cart = getCart();
        var found = -1;
        for (var i = 0; i < cart.length; i++) {
            if (cart[i].id === id) {
                found = i;
                break;
            }
        }
        if (found > -1) {
            cart[found].qty += 1;
        } else {
            cart.push({ id: id, name: name, price: price, qty: 1 });
        }
        saveCart(cart);
        updateCartCount();
        renderMiniCart();
    }

    function init() {
        var cards = document.querySelectorAll(".product-card .add-to-cart");
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener("click", function () {
                var card = this.closest(".product-card");
                if (card) {
                    addToCart(card);
                    window.location.href = "checkout.html";
                }
            });
        }
        updateCartCount();
        renderMiniCart();
    }

    if (document.readyState !== "loading") {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init);
    }
})();
