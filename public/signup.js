const $ = id => document.getElementById(id);
const msg = (text, ok) => { const m = $("msg"); m.textContent = text; m.className = "msg " + (ok ? "ok" : "err"); };

let selectedRole = "employee";

const ROLES = {
  employee: { hint: "Upload content, see the problems found and respond to them.", btn: "Create employee account" },
  manager: { hint: "Edit the brand kit, review findings and approve content.", btn: "Create manager account" }
};
function setRole(role) {
  selectedRole = role;
  for (const [id, r] of [["optManager", "manager"], ["optEmployee", "employee"]]) {
    $(id).classList.toggle("active", role === r);
    $(id).setAttribute("aria-checked", role === r);
  }
  $("roleHint").textContent = ROLES[role].hint;
  $("go").textContent = ROLES[role].btn;
}

$("optManager").onclick = () => setRole("manager");
$("optEmployee").onclick = () => setRole("employee");

fetch("/api/session").then(r => r.json()).then(s => {
  if (s.org) $("org").textContent = `Join ${s.org} on BrandSentinel. Takes about a minute.`;
  if (s.setupRequired) { msg("No organisation yet. Open the sign-in page to create the manager account.", false); $("go").disabled = true; }
  else if (!s.allowSignup) { msg("Sign-up is turned off. Ask your manager to add you.", false); $("go").disabled = true; }
  if (s.user) location.href = "/";
}).catch(() => {});

$("toggle").onclick = () => {
  const show = $("password").type === "password";
  $("password").type = show ? "text" : "password";
  $("toggle").textContent = show ? "Hide" : "Show";
};

const V = window.BSValidate;
V.watchEmail($("email"));
V.capsWarning($("password"));
V.mountRules($("pwRules"), $("password"), $("email"));
$("name").addEventListener("input", () => V.setFieldError($("name"), ""));
$("confirm").addEventListener("input", () => {
  const c = $("confirm").value;
  V.setFieldError($("confirm"), c && c !== $("password").value.slice(0, c.length) ? "Passwords don't match yet." : "");
});
$("confirm").addEventListener("blur", () => {
  const c = $("confirm").value;
  V.setFieldError($("confirm"), c && c !== $("password").value ? "Passwords don't match." : "");
});



$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("name").value.trim(), email = $("email").value.trim(), password = $("password").value;
  $("msg").className = "msg";
  if (!name) { V.setFieldError($("name"), "Enter your full name."); $("name").focus(); return msg("Enter your full name.", false); }
  const emailErr = V.emailProblem(email);
  V.setFieldError($("email"), emailErr);
  if (emailErr) { $("email").focus(); return msg(emailErr, false); }
  const probs = V.passwordProblems(password, email);
  if (probs.length) { V.setFieldError($("password"), `Password needs: ${probs.join(", ")}.`); $("password").focus(); return msg("Your password doesn't meet the rules yet.", false); }
  if (password !== $("confirm").value) { V.setFieldError($("confirm"), "Passwords don't match."); $("confirm").focus(); return msg("The two passwords don't match.", false); }
  $("go").disabled = true;
  try {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "brandsentinel" },
      body: JSON.stringify({ name, email, password, role: selectedRole })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) { V.setFieldError($("email"), "This email already has an account. Sign in instead."); $("email").focus(); }
    if (res.status === 429) throw new Error(data.error || "Too many attempts. Wait a few minutes and try again.");
    if (!res.ok) throw new Error(data.error || "Could not create the account.");
    msg("Account created. Taking you to the app…", true);
    setTimeout(() => (location.href = "/"), 700);
  } catch (err) {
    if (err instanceof TypeError) err = new Error("Can't reach the server. Check that BrandSentinel is running and try again.");
    msg(err.message, false);
    $("go").disabled = false;
  }
});
