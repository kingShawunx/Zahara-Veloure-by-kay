(function () {
  "use strict";
  const button = document.getElementById("install-app");
  const help = document.getElementById("ios-install-help");
  if (!button) return;
  let installPrompt = null;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js", { scope: "./" }).catch(() => {}), { once: true });
  }

  if (!isStandalone && isIOS) {
    button.hidden = false;
    button.textContent = "Install on iPhone";
    button.addEventListener("click", () => { if (help?.showModal) help.showModal(); });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (!isStandalone) { button.hidden = false; button.textContent = "Install the app"; }
  });
  button.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      button.hidden = choice.outcome === "accepted";
    } catch (_) {
      button.hidden = false;
    }
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; button.hidden = true; });

  const toast = document.getElementById("toast");
  function setConnectionState() {
    if (!toast) return;
    toast.textContent = navigator.onLine
      ? "You’re back online. Check current stock and prices before ordering."
      : "You’re offline. Your cart stays on this device; live products and checkout need a connection.";
    toast.classList.add("is-visible");
    clearTimeout(setConnectionState.timer);
    if (navigator.onLine) setConnectionState.timer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }
  window.addEventListener("offline", setConnectionState);
  window.addEventListener("online", setConnectionState);

  if (new URLSearchParams(location.search).get("focus") === "search") {
    requestAnimationFrame(() => document.getElementById("search-input")?.focus({ preventScroll: true }));
  }
})();
