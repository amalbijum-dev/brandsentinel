const $ = id => document.getElementById(id);
const msg = (text, ok) => { const m = $("msg"); m.textContent = text; m.className = "msg " + (ok ? "ok" : "err"); };
let setup = false;
let selectedRole = "manager";

const ROLES = {
  manager: { hint: "Edit the brand kit, review findings and approve content.", btn: "Sign in as Manager" },
  employee: { hint: "Upload content, see the problems found and respond to them.", btn: "Sign in as Employee" }
};
function setRole(role) {
  selectedRole = role;
  for (const [id, r] of [["optManager", "manager"], ["optEmployee", "employee"]]) {
    $(id).classList.toggle("active", role === r);
    $(id).setAttribute("aria-checked", role === r);
  }
  $("roleHint").textContent = ROLES[role].hint;
  if (!setup) $("go").textContent = ROLES[role].btn;
}

$("optManager").onclick = () => setRole("manager");
$("optEmployee").onclick = () => setRole("employee");

const V = window.BSValidate;
V.watchEmail($("email"));
V.capsWarning($("password"));
$("password").addEventListener("input", () => V.setFieldError($("password"), ""));

// ---------- Demo accounts ----------
async function demoLogin(role) {
  const btns = [$("demoManager"), $("demoEmployee")];
  btns.forEach(b => { b.disabled = true; });
  msg(`Opening the demo ${role === "manager" ? "Manager" : "Employee"} account…`, true);
  try {
    const res = await fetch("/api/demo-login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "brandsentinel" },
      body: JSON.stringify({ role })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not open the demo account.");
    location.href = "/";
  } catch (err) {
    msg(err.message, false);
    btns.forEach(b => { b.disabled = false; });
  }
}
$("demoManager").onclick = () => demoLogin("manager");
$("demoEmployee").onclick = () => demoLogin("employee");
const demoUrl = `${location.origin}/demo`;
$("copyDemo").onclick = async () => {
  try { await navigator.clipboard.writeText(demoUrl); $("copyDemo").textContent = "Demo link copied"; } catch { $("copyDemo").textContent = demoUrl; }
  setTimeout(() => { $("copyDemo").textContent = "Copy demo link"; }, 2000);
};


fetch("/api/session").then(r => r.json()).then(s => {
  if (s.user) { location.href = "/"; return; }
  if (s.demo) {
    $("demoCard").hidden = false;
    $("divider").hidden = false;
    $("shareWrap").hidden = false;
    const want = new URLSearchParams(location.search).get("demo");
    if (want === "manager" || want === "employee") { demoLogin(want); return; }
  }
  if (s.setupRequired) {
    setup = true;
    $("title").textContent = "Set up BrandSentinel";
    $("sub").textContent = "Create the first manager account for your organisation.";
    $("setupOnly").hidden = false;
    $("go").textContent = "Create manager account";
    $("password").autocomplete = "new-password";
    $("alt").hidden = true;
    $("pwRules").hidden = false;
    V.mountRules($("pwRules"), $("password"), $("email"));
    $("pwTip").textContent = "Choose a password you don't use anywhere else.";
    document.querySelector(".seg-role").hidden = true;
    $("roleHint").textContent = "First run: this creates the organisation and its first manager.";
    $("divider").querySelector("span").textContent = "or set up your organisation";
  } else if (!s.allowSignup) {
    $("alt").textContent = "Need an account? Ask your manager to add you.";
  }
}).catch(() => { });

$("toggle").onclick = () => {
  const show = $("password").type === "password";
  $("password").type = show ? "text" : "password";
  $("toggle").textContent = show ? "Hide" : "Show";
};

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value;
  $("msg").className = "msg";
  const emailErr = V.emailProblem(email);
  V.setFieldError($("email"), emailErr);
  if (emailErr) { $("email").focus(); return msg(emailErr, false); }
  if (!password) { V.setFieldError($("password"), "Enter your password."); $("password").focus(); return msg("Enter your password.", false); }
  if (setup) {
    if (!$("name").value.trim()) { V.setFieldError($("name"), "Enter your name."); $("name").focus(); return msg("Enter your name.", false); }
    const probs = V.passwordProblems(password, email);
    if (probs.length) { V.setFieldError($("password"), `Password needs: ${probs.join(", ")}.`); $("password").focus(); return msg("Your password doesn't meet the rules yet.", false); }
  }
  const body = setup
    ? { name: $("name").value.trim(), email, password, org: $("org").value.trim() }
    : { email, password, role: selectedRole };
  if (setup && !body.name) return msg("Enter your name.", false);
  $("go").disabled = true;
  try {
    const res = await fetch(setup ? "/api/setup" : "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "brandsentinel" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(data.error || "Too many attempts. Wait a few minutes and try again.");
    if (!res.ok) {
      // Wrong role chosen: offer a one-tap switch.
      if (res.status === 403 && /Normal Employee login option|Manager login option/.test(data.error || "")) {
        const target = /Normal Employee login option/.test(data.error) ? "employee" : "manager";
        msg(data.error, false);
        const sw = document.createElement("button");
        sw.type = "button"; sw.className = "quick-btn"; sw.style.marginTop = "8px";
        sw.textContent = `Switch to ${target === "manager" ? "Manager" : "Normal Employee"} and sign in`;
        sw.onclick = () => { setRole(target); $("form").requestSubmit(); };
        $("msg").append(document.createElement("br"), sw);
        $("go").disabled = false;
        return;
      }
      if (res.status === 401) V.setFieldError($("password"), "Incorrect email or password.");
      throw new Error(data.error || "Could not sign in.");
    }
    location.href = "/";
  } catch (err) {
    if (err instanceof TypeError) err = new Error("Can't reach the server. Check that BrandSentinel is running and try again.");
    msg(err.message, false);
    $("go").disabled = false;
  }
});
