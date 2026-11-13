// Adds a "Create an account" link under the sign-in form of the main app (including after sign-out).
(() => {
  const ID = "bs-signup-link";
  let busy = false;

  async function inject() {
    if (busy || document.getElementById(ID)) return;
    const pw = document.querySelector('input[type="password"]');
    if (!pw) return;
    const form = pw.closest("form") || pw.parentElement?.parentElement;
    if (!form || !/sign in/i.test(form.parentElement?.textContent || form.textContent || "")) return;
    busy = true;
    try {
      const s = await fetch("/api/session").then(r => r.json());
      if (s.user || s.setupRequired || !s.allowSignup || document.getElementById(ID)) return;
      const box = document.createElement("div");
      box.id = ID;
      box.style.cssText = "margin-top:16px;font-size:14px;color:#9aa6c4";
      box.append("New here? ");
      const a = document.createElement("a");
      a.href = "/signup.html";
      a.textContent = "Create an account";
      a.style.cssText = "color:#5b8cff;font-weight:600;text-decoration:none";
      box.append(a);
      form.after(box);
    } catch { /* ignore */ } finally { busy = false; }
  }

  new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
  inject();
})();
