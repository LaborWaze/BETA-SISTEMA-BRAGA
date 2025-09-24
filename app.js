// app.js (com suporte a "Esqueci a senha")

// --- Mock de usuários (DEMO). Em produção, valide no backend (HTTPS).
const USERS = [
  { username: "admin",  password: "1234", role: "admin",        name: "Administrador(a)" },
  { username: "gestor", password: "1234", role: "gestor",       name: "Gestor(a)" },
  { username: "colab",  password: "1234", role: "colaborador",  name: "Colaborador(a)" },
];

// Configurações simples de segurança/UX
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 2;

// Chaves de storage
const KEY = {
  REMEMBER:  "app.rememberUser",
  LOCK:      "app.lockUntil",
  ATTEMPTS:  "app.attempts",
  SESSION:   "app.session",
  CREDS:     "app.creds"          // { [username]: "novaSenha" }
};

// ===== Header básico em todas as páginas =====
(function initHeader(){
  const sessRaw = sessionStorage.getItem("app.session");
  let sess = null;
  try { sess = JSON.parse(sessRaw || "null"); } catch { /* noop */ }

  // Preenche nome/papel se existir no HTML
  const $name = document.getElementById("userName");
  const $role = document.getElementById("userRole");
  if (sess && $name) $name.textContent = sess.name || "";
  if (sess && $role) {
    $role.textContent = sess.role || "";
    $role.classList.add("role-" + (sess.role || "user"));
  }

  // Logout global
  const $logout = document.getElementById("logoutBtn");
  if ($logout) {
    $logout.addEventListener("click", () => {
      sessionStorage.removeItem("app.session");
      window.location.href = "./index.html";
    });
  }
})();

function now(){ return Date.now(); }
function mins(n){ return n * 60 * 1000; }
function normalizeUsername(v){ return String(v || "").trim().toLowerCase(); }

function readCredOverrides(){
  try{ return JSON.parse(localStorage.getItem(KEY.CREDS) || "{}"); }
  catch(e){ return {}; }
}
function writeCredOverrides(obj){
  localStorage.setItem(KEY.CREDS, JSON.stringify(obj || {}));
}

function getEffectivePassword(user){
  const overrides = readCredOverrides();
  return overrides[user.username] || user.password;
}

function updateAttemptsUI(){
  const attempts = Number(localStorage.getItem(KEY.ATTEMPTS) || "0");
  const lockUntil = Number(localStorage.getItem(KEY.LOCK) || "0");
  const info = document.getElementById("attemptsInfo");
  if(!info) return;

  if (lockUntil && now() < lockUntil){
    const seconds = Math.ceil((lockUntil - now()) / 1000);
    info.textContent = `Bloqueado por ${seconds}s`;
  } else if (attempts > 0){
    info.textContent = `Tentativas: ${attempts}/${MAX_ATTEMPTS}`;
  } else {
    info.textContent = "";
  }
}

function setSession(user){
  sessionStorage.setItem(KEY.SESSION, JSON.stringify({
    username: user.username,
    role: user.role,
    name: user.name,
    ts: now()
  }));
}
function getSession(){
  try{ return JSON.parse(sessionStorage.getItem(KEY.SESSION) || "null"); }
  catch(e){ return null; }
}
function clearSession(){ sessionStorage.removeItem(KEY.SESSION); }

// Auxiliar para alternar senha (em vários campos)
function attachToggleButtons(){
  document.querySelectorAll(".icon-btn[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sel = btn.getAttribute("data-toggle");
      const input = document.querySelector(sel);
      if (!input) return;

      const toText = input.type === "password";
      input.type = toText ? "text" : "password";

      // alterna o ícone (eye/eye-off)
      btn.classList.toggle("is-on", toText);

      // acessibilidade opcional
      btn.setAttribute("aria-pressed", String(toText));
      btn.setAttribute("title", toText ? "Ocultar senha" : "Mostrar senha");
    });
  });
}


/* =========================
   LOGIN
   ========================= */
(function initLogin(){
  const form = document.getElementById("loginForm");
  if(!form) return; // estamos em outra página

  // Lembrar usuário
  const savedUser = localStorage.getItem(KEY.REMEMBER);
  if (savedUser) document.getElementById("username").value = savedUser;

  // Toggle do campo de senha do login (compat antigo)
  const toggle = document.getElementById("togglePwd");
  if (toggle){
    toggle.addEventListener("click", () => {
      const input = document.getElementById("password");
      input.type = input.type === "password" ? "text" : "password";
      toggle.classList.toggle("is-on", input.type === "text"); // <<< mantém só 1 ícone visível
    });
  }

  // Botão de desbloqueio (limpa bloqueio e tentativas)
  const unlockBtn = document.getElementById("unlockBtn");
  if (unlockBtn){
    unlockBtn.addEventListener("click", () => {
      localStorage.removeItem(KEY.LOCK);
      localStorage.setItem(KEY.ATTEMPTS, "0");
      updateAttemptsUI();
      alert("Tentativas e bloqueio limpos.");
    });
  }

  // Atualiza UI de tentativas a cada 1s (para contagem)
  updateAttemptsUI();
  setInterval(updateAttemptsUI, 1000);

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const usernameRaw = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const username = normalizeUsername(usernameRaw);

    // validações simples
    const uErr = document.querySelector('[data-error-for="username"]');
    const pErr = document.querySelector('[data-error-for="password"]');
    uErr.textContent = ""; pErr.textContent = "";

    if(!username) uErr.textContent = "Informe o usuário.";
    if(!password) pErr.textContent = "Informe a senha.";
    if(!username || !password) return;

    // bloqueio por muitas tentativas
    const lockUntil = Number(localStorage.getItem(KEY.LOCK) || "0");
    if (lockUntil && now() < lockUntil){
      pErr.textContent = "Muitas tentativas. Aguarde o desbloqueio ou use o botão 'Desbloquear'.";
      return;
    }

    // autenticação case-insensitive
    const user = USERS.find(u => u.username.toLowerCase() === username);
    if (!user){
      uErr.textContent = "Usuário não encontrado.";
      return;
    }

    const effectivePwd = getEffectivePassword(user);
    if (effectivePwd !== password){
      const attempts = Number(localStorage.getItem(KEY.ATTEMPTS) || "0") + 1;
      localStorage.setItem(KEY.ATTEMPTS, String(attempts));

      if(attempts >= MAX_ATTEMPTS){
        localStorage.setItem(KEY.LOCK, String(now() + mins(LOCK_MINUTES)));
        localStorage.setItem(KEY.ATTEMPTS, "0"); // zera após bloquear
        pErr.textContent = "Bloqueado temporariamente por tentativas inválidas.";
      } else {
        pErr.textContent = "Usuário ou senha inválidos.";
      }
      updateAttemptsUI();
      return;
    }

    // sucesso
    localStorage.setItem(KEY.ATTEMPTS, "0");
    localStorage.removeItem(KEY.LOCK);

    // Remember me
    const remember = document.getElementById("rememberMe").checked;
    if (remember) localStorage.setItem(KEY.REMEMBER, user.username);
    else localStorage.removeItem(KEY.REMEMBER);

    setSession(user);
    window.location.href = "./dashboard.html";
  });
})();

/* =========================
   FORGOT (redefinição)
   ========================= */
(function initForgot(){
  const form = document.getElementById("forgotForm");
  if(!form) return; // estamos em outra página

  attachToggleButtons();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const userRaw = document.getElementById("fUser").value;
    const pwd1 = document.getElementById("fPwd").value;
    const pwd2 = document.getElementById("fPwd2").value;

    const username = normalizeUsername(userRaw);
    const uErr = document.querySelector('[data-error-for="fUser"]');
    const p1Err = document.querySelector('[data-error-for="fPwd"]');
    const p2Err = document.querySelector('[data-error-for="fPwd2"]');
    const msg = document.getElementById("forgotMsg");
    uErr.textContent = ""; p1Err.textContent = ""; p2Err.textContent = "";
    msg.style.display = "none";

    if(!username){ uErr.textContent = "Informe o usuário."; return; }
    if(!pwd1){ p1Err.textContent = "Informe a nova senha."; return; }
    if(pwd1.length < 4){ p1Err.textContent = "A senha deve ter pelo menos 4 caracteres."; return; }
    if(pwd2 !== pwd1){ p2Err.textContent = "As senhas não coincidem."; return; }

    const user = USERS.find(u => u.username.toLowerCase() === username);
    if(!user){ uErr.textContent = "Usuário não encontrado."; return; }

    // salva override de senha no localStorage
    const overrides = readCredOverrides();
    overrides[user.username] = pwd1;
    writeCredOverrides(overrides);

    msg.textContent = "✅ Nova senha salva. Você já pode fazer login.";
    msg.style.display = "block";

    // opcional: redirecionar após alguns segundos
    setTimeout(() => { window.location.href = "./index.html"; }, 1200);
  });
})();

/* =========================
   DASHBOARD
   ========================= */
(function initDashboard(){
  const $title = document.getElementById("dashTitle");
  if(!$title) return; // estamos na página de login/forgot

  const session = getSession();
  if (!session){
    window.location.replace("./index.html");
    return;
  }

  // Header
  const $name = document.getElementById("userName");
  const $role = document.getElementById("userRole");
  $name.textContent = session.name;
  $role.textContent = session.role;
  $role.classList.add(`role-${session.role}`);

  // Cards por nível
  const $grid = document.getElementById("grid");
  const base = [
    { title: "Meus dados", descr: "Perfil e preferências." },
    { title: "Atalhos", descr: "Links rápidos para rotinas diárias." },
  ];
  const gestor = [
    { title: "Painel da Equipe", descr: "Tarefas e metas." },
    { title: "Relatórios", descr: "Exportar CSV/PDF de desempenho." },
  ];
  const admin = [
    { title: "Usuários e Permissões", descr: "Gerenciar níveis de acesso." },
    { title: "Configurações do Sistema", descr: "Parâmetros globais e auditoria." },
  ];

  const items = [...base];
  if (session.role === "gestor") items.push(...gestor);
  if (session.role === "admin") items.push(...gestor, ...admin);

  // exemplo dentro do seu loop atual que cria cada "card"
  for (const it of items) {
    const el = document.createElement("div");
    el.className = "card box";
    el.innerHTML = `<h3>${it.title}</h3><p class="muted">${it.descr}</p>`;

    // >>> torna o card "Relatórios" um link para reports.html
    if (it.title.toLowerCase() === "relatórios" || it.title.toLowerCase() === "relatorios") {
      el.classList.add("clickable");
      el.setAttribute("role", "button");
      el.tabIndex = 0;

      const go = () => { window.location.href = "./reports.html"; };
      el.addEventListener("click", go);
      el.addEventListener("keypress", (e) => { if (e.key === "Enter" || e.key === " ") go(); });
    }

    $grid.appendChild(el); // ou $grid.appendChild(el)
  }

  document.getElementById("logoutBtn").addEventListener("click", () => {
    clearSession();
    window.location.href = "./index.html";
  });
})();

/* =========================
   RELATÓRIOS (preview, salvar e listar)
   ========================= */
(function initReports(){
  const $file     = document.getElementById("csvFile");
  const $onlyPert = document.getElementById("onlyPert");
  const $preview  = document.getElementById("previewBtn");
  const $save     = document.getElementById("saveBtn");
  const $wrap     = document.getElementById("tableWrap");
  const $tbl      = document.getElementById("dataTable");
  const $status   = document.getElementById("statusMsg");

  const $pager    = document.getElementById("pager");
  const $prev     = document.getElementById("prevPage");
  const $next     = document.getElementById("nextPage");
  const $pageInfo = document.getElementById("pageInfo");

  if (!$file || !$preview || !$tbl) return; // não estamos na página de relatórios

  // --- estado do preview para poder salvar depois
  let previewColumns = [];
  let previewRows    = [];

  // --- estado dos dados salvos (paginação do backend)
  let curPage = 1;
  let pageSize = 50;
  let total = 0;

  // --- espelhamento (Admin <-> Gestor)
  let lastVersion = 0;
  let versionTimer = null;

  function setStatus(msg){ $status.textContent = msg || ""; }
  function clearTable(){ $tbl.innerHTML = ""; }

  function renderTable(columns, rows){
    if (!columns || columns.length === 0){
      clearTable();
      $tbl.innerHTML = `<thead><tr><th>Nenhuma coluna</th></tr></thead>`;
      return;
    }
    const thead = `<thead><tr>${columns.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
    const body  = `<tbody>${
      rows.map(r => `<tr>${
        columns.map(c => `<td>${r[c] ?? ""}</td>`).join("")
      }</tr>`).join("")
    }</tbody>`;
    $tbl.innerHTML = thead + body;
  }

  // ========== PREVIEW ==========
  async function doPreview(){
    if (!$file.files[0]){ setStatus("Escolha um arquivo CSV."); return; }
    setStatus("Enviando e gerando pré-visualização…");
    $save.disabled = true;
    clearTable();

    const fd = new FormData();
    fd.append("file", $file.files[0]);
    // você pode passar columns via JSON aqui se quiser customizar;
    // vamos usar apenas o onlyPertinentes do backend:
    const url = `/api/upload-csv?only_pertinentes=${$onlyPert.checked ? "true":"false"}`;

    try{
      const res = await fetch(url, { method: "POST", body: fd });
      if (!res.ok){
        const t = await res.text();
        throw new Error(t || `Falha ${res.status}`);
      }
      const data = await res.json(); // {columns, rows, total}
      previewColumns = data.columns || [];
      previewRows    = data.rows || [];

      renderTable(previewColumns, previewRows);
      setStatus(`Pré-visualização de ${previewRows.length} linha(s) (total no arquivo: ${data.total}).`);
      $save.disabled = previewRows.length === 0;

      // ao pré-visualizar, escondemos paginação (é só preview cliente)
      $pager.hidden = true;

    }catch(err){
      console.error(err);
      setStatus("Erro ao pré-visualizar: " + (err.message || err));
    }
  }

  // ========== SALVAR ==========
  async function doSave(){
    if (previewRows.length === 0){ setStatus("Nada para salvar."); return; }
    setStatus("Salvando no banco…");
    $save.disabled = true;

    try{
      const res = await fetch("/api/reports/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: previewRows })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || JSON.stringify(data));
      setStatus("✅ " + (data.message || "Salvo."));

      // após salvar, carrega do banco com paginação
      curPage = 1;
      await loadSaved(curPage);

      // inicia/atualiza o polling de version (espelho)
      startVersionPolling();

    }catch(err){
      console.error(err);
      setStatus("Erro ao salvar: " + (err.message || err));
    }finally{
      $save.disabled = false;
    }
  }

  // ========== LISTAR SALVO (PAGINADO) ==========
  async function loadSaved(page){
    setStatus("Carregando dados salvos…");
    clearTable();
    try{
      const res = await fetch(`/api/reports/data?page=${page}&page_size=${pageSize}`);
      const data = await res.json(); // {columns, rows, page, page_size, total, version}
      renderTable(data.columns, data.rows);
      total = data.total || 0;
      curPage = data.page || 1;
      lastVersion = data.version || 0;
      setStatus(`Mostrando página ${curPage} de ${Math.max(1, Math.ceil(total / pageSize))} (total ${total})`);
      // mostrar paginação se houver mais de 1 página
      $pager.hidden = total <= pageSize;
      $pageInfo.textContent = `Página ${curPage} / ${Math.max(1, Math.ceil(total / pageSize))}`;
    }catch(err){
      console.error(err);
      setStatus("Erro ao carregar dados: " + (err.message || err));
      $pager.hidden = true;
    }
  }

  $prev?.addEventListener("click", () => { if (curPage > 1) loadSaved(--curPage); });
  $next?.addEventListener("click", () => {
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (curPage < last) loadSaved(++curPage);
  });

  // ========== ESPELHO (polling do version) ==========
  function startVersionPolling(){
    if (versionTimer) clearInterval(versionTimer);
    versionTimer = setInterval(async () => {
      try{
        const res = await fetch(`/api/reports/data?page=1&page_size=1`);
        const data = await res.json();
        if ((data.version || 0) !== lastVersion){
          lastVersion = data.version || 0;
          // recarrega a página atual para refletir mudanças
          await loadSaved(curPage);
        }
      }catch(e){ /* silencioso */ }
    }, 5000); // a cada 5s — pode ajustar
  }

  // ========== BINDs ==========
  $preview.addEventListener("click", doPreview);
  $save.addEventListener("click", doSave);

  // se quiser: ao entrar na página já mostrar o que está no banco
  loadSaved(curPage).then(startVersionPolling);
})();
