// Shared, friendly validation for the sign-in and sign-up pages.
// The server checks the same rules, so these hints never disagree with what is accepted.
// Show a scrollbar only when the card is taller than the visible window.
(() => {
  const fit = () => {
    const card = document.querySelector("main.card");
    if (!card) return;
    const cs = getComputedStyle(document.body);
    const needed = card.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const visible = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.classList.toggle("fits", needed <= visible + 1);
  };
  const start = () => {
    fit();
    const card = document.querySelector("main.card");
    if (card && window.ResizeObserver) new ResizeObserver(fit).observe(card);
    window.addEventListener("resize", fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();

window.BSValidate = (() => {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RULES = [
    { id: "len", text: "8+ characters", test: p => p.length >= 8 },
    { id: "letter", text: "a letter", test: p => /[A-Za-z]/.test(p) },
    { id: "number", text: "a number", test: p => /\d/.test(p) },
    { id: "email", text: "not your email", test: (p, e) => !p || !e || p.toLowerCase() !== e.trim().toLowerCase() }
  ];

  function emailProblem(value) {
    const v = value.trim();
    if (!v) return "Enter your email address.";
    if (/\s/.test(v)) return "Email addresses can't contain spaces.";
    if (!v.includes("@")) return "Email is missing the @ symbol, e.g. name@company.com.";
    const [local, domain = ""] = v.split("@");
    if (!local) return "Add the part before the @, e.g. name@company.com.";
    if (v.split("@").length > 2) return "Email can only contain one @ symbol.";
    if (!domain.includes(".")) return `"${domain || "…"}" needs a domain ending, e.g. company.com.`;
    if (!EMAIL_RE.test(v)) return "That doesn't look like a valid email, e.g. name@company.com.";
    return "";
  }

  // Shows/clears a message under a field and marks it invalid.
  function setFieldError(input, text) {
    let hint = input.closest(".pw") ? input.closest(".pw").nextElementSibling : input.nextElementSibling;
    if (!hint || !hint.classList.contains("field-err")) {
      hint = document.createElement("div");
      hint.className = "field-err";
      hint.setAttribute("aria-live", "polite");
      (input.closest(".pw") || input).after(hint);
    }
    hint.textContent = text || "";
    hint.hidden = !text;
    input.classList.toggle("invalid", Boolean(text));
    input.setAttribute("aria-invalid", text ? "true" : "false");
  }

  // Live checklist of password rules.
  function mountRules(container, passwordInput, emailInput) {
    container.className = "pw-rules";
    container.replaceChildren(...RULES.map(r => {
      const li = document.createElement("li");
      li.dataset.rule = r.id;
      li.textContent = r.text;
      return li;
    }));
    const paint = () => {
      const p = passwordInput.value, e = emailInput ? emailInput.value : "";
      RULES.forEach(r => {
        const li = container.querySelector(`[data-rule="${r.id}"]`);
        const ok = p.length > 0 && r.test(p, e);
        li.classList.toggle("ok", ok);
        li.classList.toggle("bad", p.length > 0 && !ok);
      });
    };
    passwordInput.addEventListener("input", paint);
    if (emailInput) emailInput.addEventListener("input", paint);
    paint();
  }

  const passwordProblems = (p, e) => RULES.filter(r => !r.test(p, e)).map(r => r.text.toLowerCase());

  // Warns when Caps Lock is on while typing a password.
  function capsWarning(input) {
    const warn = document.createElement("div");
    warn.className = "caps-warn"; warn.hidden = true; warn.textContent = "Caps Lock is on";
    (input.closest(".pw") || input).after(warn);
    const check = ev => { if (ev.getModifierState) warn.hidden = !ev.getModifierState("CapsLock"); };
    input.addEventListener("keydown", check);
    input.addEventListener("keyup", check);
    input.addEventListener("blur", () => { warn.hidden = true; });
  }

  // Wires live email checking: quiet while typing, explicit after leaving the field.
  function watchEmail(input) {
    let touched = false;
    input.addEventListener("blur", () => { touched = true; setFieldError(input, input.value ? emailProblem(input.value) : ""); });
    input.addEventListener("input", () => { if (touched || input.classList.contains("invalid")) setFieldError(input, emailProblem(input.value)); });
  }

  return { emailProblem, setFieldError, mountRules, passwordProblems, capsWarning, watchEmail };
})();
