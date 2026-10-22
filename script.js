// ============================================
// SCROLL-AWARE HEADER
// ============================================
(function () {
    const header = document.getElementById('site-header');
    if (!header) return;
    function updateHeader() {
        header.classList.toggle('is-scrolled', window.scrollY > 60);
    }
    window.addEventListener('scroll', updateHeader, { passive: true });
    updateHeader();
})();

// ============================================
// MOBILE NAV TOGGLE
// ============================================
function toggleMenu() {
    const nav = document.getElementById('nav-menu');
    const btn = document.querySelector('.menu-btn');
    const isOpen = nav.classList.toggle('active');
    btn.classList.toggle('is-open', isOpen);
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

document.querySelectorAll('#nav-menu a').forEach(function (link) {
    link.addEventListener('click', function () {
        const nav = document.getElementById('nav-menu');
        const btn = document.querySelector('.menu-btn');
        nav.classList.remove('active');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
    });
});

// ============================================
// HERO SLIDESHOW
// ============================================
(function () {
    const slideshow = document.querySelector('.hero-slideshow');
    if (!slideshow) return;

    const slides = Array.from(slideshow.querySelectorAll('.hero-slide'));
    const dotsWrap = slideshow.querySelector('.slide-dots');
    const prevBtn = slideshow.querySelector('.slide-prev');
    const nextBtn = slideshow.querySelector('.slide-next');
    if (slides.length === 0) return;

    let current = slides.findIndex(function (s) { return s.classList.contains('is-active'); });
    if (current === -1) current = 0;

    const AUTOPLAY_MS = 4500;
    let timer = null;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    slides.forEach(function (_, i) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'slide-dot' + (i === current ? ' is-active' : '');
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
        dot.addEventListener('click', function () { goTo(i); restart(); });
        dotsWrap.appendChild(dot);
    });
    const dots = Array.from(dotsWrap.querySelectorAll('.slide-dot'));

    function restartKenBurns(slide) {
        const img = slide.querySelector('img');
        if (!img) return;
        img.style.animation = 'none';
        void img.offsetWidth;
        img.style.animation = '';
    }
    function render() {
        slides.forEach(function (slide, i) { slide.classList.toggle('is-active', i === current); });
        dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === current); });
        restartKenBurns(slides[current]);
    }
    function goTo(index) { current = (index + slides.length) % slides.length; render(); }
    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }
    function play() { if (prefersReducedMotion || slides.length < 2) return; stop(); timer = window.setInterval(next, AUTOPLAY_MS); }
    function stop() { if (timer) { window.clearInterval(timer); timer = null; } }
    function restart() { stop(); play(); }

    if (nextBtn) nextBtn.addEventListener('click', function () { next(); restart(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { prev(); restart(); });

    slideshow.addEventListener('mouseenter', stop);
    slideshow.addEventListener('mouseleave', play);
    slideshow.addEventListener('focusin', stop);
    slideshow.addEventListener('focusout', play);

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { stop(); } else { play(); }
    });

    let touchStartX = null;
    slideshow.addEventListener('touchstart', function (e) { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
    slideshow.addEventListener('touchend', function (e) {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) { if (dx < 0) { next(); } else { prev(); } restart(); }
        touchStartX = null;
    }, { passive: true });

    

    render();
    play();
})();

// ============================================
// ACCOUNT MODAL — Sign In / Create Account
//
// ⚠️ DEMO ONLY — NOT SECURE, NOT PRODUCTION-READY.
// This stores accounts in the browser's localStorage in
// PLAIN TEXT. That's fine for previewing the UI flow, but
// anyone can read it in devtools, and it only works on the
// one device/browser that created the account.
//
// Before real customers use this, replace the three
// functions below (registerUser, loginUser, getSession)
// with calls to a real auth provider — e.g. Supabase Auth
// or Firebase Auth — which handle password hashing,
// sessions, and security for you.
// ============================================
(function () {
    const overlay = document.getElementById('account-overlay');
    const trigger = document.getElementById('account-trigger');
    const closeBtn = document.getElementById('account-close');
    if (!overlay || !trigger) return;

    const loggedOutView = document.getElementById('account-logged-out');
    const signedInView = document.getElementById('account-signed-in');
    const nameDisplay = document.getElementById('account-name-display');
    const signOutBtn = document.getElementById('account-signout');

    const tabs = overlay.querySelectorAll('.account-tab');
    const forms = overlay.querySelectorAll('.account-form');

    const STORAGE_USERS = 'zv_demo_users';
    const STORAGE_SESSION = 'zv_demo_session';

    function getUsers() {
        try { return JSON.parse(localStorage.getItem(STORAGE_USERS)) || []; }
        catch (e) { return []; }
    }
    function saveUsers(users) {
        localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    }
    function getSession() {
        try { return JSON.parse(localStorage.getItem(STORAGE_SESSION)); }
        catch (e) { return null; }
    }
    function setSession(user) {
        localStorage.setItem(STORAGE_SESSION, JSON.stringify({ name: user.name, email: user.email }));
    }
    function clearSession() {
        localStorage.removeItem(STORAGE_SESSION);
    }

    function registerUser(name, email, password) {
        const users = getUsers();
        if (users.some(function (u) { return u.email.toLowerCase() === email.toLowerCase(); })) {
            return { ok: false, message: 'An account with that email already exists.' };
        }
        users.push({ name: name, email: email, password: password });
        saveUsers(users);
        return { ok: true };
    }

    function loginUser(email, password) {
        const users = getUsers();
        const match = users.find(function (u) {
            return u.email.toLowerCase() === email.toLowerCase() && u.password === password;
        });
        if (!match) return { ok: false, message: 'Incorrect email or password.' };
        setSession(match);
        return { ok: true, user: match };
    }

    function refreshView() {
        const session = getSession();
        if (session) {
            loggedOutView.style.display = 'none';
            signedInView.classList.add('is-active');
            nameDisplay.textContent = session.name;
            trigger.textContent = session.name.split(' ')[0];
        } else {
            loggedOutView.style.display = '';
            signedInView.classList.remove('is-active');
            trigger.textContent = 'Sign In';
        }
    }

    function openModal() { overlay.classList.add('is-open'); refreshView(); }
    function closeModal() { overlay.classList.remove('is-open'); }

    trigger.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (t) { t.classList.remove('is-active'); });
            tab.classList.add('is-active');
            forms.forEach(function (f) { f.classList.toggle('is-active', f.dataset.form === tab.dataset.tab); });
        });
    });

    const signinForm = document.getElementById('signin-form');
    const signinMsg = document.getElementById('signin-msg');
    signinForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;
        const result = loginUser(email, password);
        if (!result.ok) {
            signinMsg.textContent = result.message;
            signinMsg.className = 'form-msg is-error';
            return;
        }
        signinMsg.textContent = '';
        signinForm.reset();
        refreshView();
    });

    const signupForm = document.getElementById('signup-form');
    const signupMsg = document.getElementById('signup-msg');
    signupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        const result = registerUser(name, email, password);
        if (!result.ok) {
            signupMsg.textContent = result.message;
            signupMsg.className = 'form-msg is-error';
            return;
        }
        loginUser(email, password);
        signupMsg.textContent = '';
        signupForm.reset();
        refreshView();
    });

    signOutBtn.addEventListener('click', function () {
        clearSession();
        refreshView();
    });

    // Reflect an existing session in the nav button on page load
    refreshView();
})();