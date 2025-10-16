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
      input.type = input.type === "password" ? "text" : "password"; // text baixo
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
   RELATÓRIOS (preview, salvar, carregar e edição inline)
   ========================= */
(function initReports(){
  // --- elementos da reports.html
  const $file       = document.getElementById("csvFile");
  const $onlyPert   = document.getElementById("onlyPert");
  const $btnPreview = document.getElementById("previewBtn");
  const $btnSave    = document.getElementById("saveBtn");
  const $status     = document.getElementById("statusMsg");

  // usamos o container que EXISTE no seu HTML
  const $mount      = document.getElementById("tableWrap");

  // paginação (opcional)
  const $pager      = document.getElementById("pager");
  const $prev       = document.getElementById("prevPage");
  const $next       = document.getElementById("nextPage");
  const $pageInfo   = document.getElementById("pageInfo");

  // se não estamos na página, sai
  if (!$mount) return;

  // header: nome/role + Sair
  try{
    const sess = JSON.parse(sessionStorage.getItem("app.session") || "null");
    if (!sess) { location.href = "./index.html"; return; }
    const $name = document.getElementById("userName");
    const $role = document.getElementById("userRole");
    if ($name) $name.textContent = sess.name || "";
    if ($role) { $role.textContent = sess.role || ""; $role.classList.add("role-" + String(sess.role||"").toLowerCase()); }
  }catch{}
  const $logout = document.getElementById("logoutBtn");
  if ($logout) $logout.onclick = () => { sessionStorage.removeItem("app.session"); location.href = "./index.html"; };

  // quem pode editar? (admin e gestor)
  let canEdit = false;
  try {
    const sess = JSON.parse(sessionStorage.getItem("app.session") || "null");
    const role = String(sess?.role || "").toLowerCase().trim();
    canEdit = role === "admin" || role === "gestor";
  } catch {}
  if (!canEdit) { // fallback via badge
    const badge = document.getElementById("userRole");
    if (badge && /role-(admin|gestor)/i.test(badge.className)) canEdit = true;
  }
  console.log("canEdit =", canEdit);

  // estado
  let previewRows = [];
  let curPage = 1, pageSize = 50, total = 0, lastVersion = 0, versionTimer = null;

  function setStatus(msg){ if ($status) $status.textContent = msg || ""; }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // renderização
  function renderTable(columns, rows){
    if (!columns?.length || !rows?.length){
      $mount.innerHTML = `<div class="muted" style="padding:16px">Sem dados.</div>`;
      return;
    }
    const thead = `<thead><tr>${canEdit ? `<th style="width:48px;">#</th>` : ""}${columns.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${
      rows.map((r, i) => `
        <tr data-rowid="${r.__id ?? ""}">
          ${canEdit ? `<td class="muted">${(i+1) + ((curPage-1)*pageSize)}</td>` : ""}
          ${columns.map(c => {
            const v = r[c] ?? "";
            const editable = (canEdit && c !== "__id") ? `contenteditable="true" class="editable" data-col="${c}"` : "";
            return `<td ${editable}>${escapeHtml(v)}</td>`;
          }).join("")}
        </tr>`
      ).join("")
    }</tbody>`;
    $mount.innerHTML = `<table class="tbl">${thead}${tbody}</table>`;
    if (canEdit) attachInlineHandlers();
  }

  function attachInlineHandlers(){
    $mount.querySelectorAll("td.editable").forEach(td => {
      let original = td.textContent;
      const save = async () => {
        const tr = td.closest("tr");
        const id = tr?.getAttribute("data-rowid");
        const col = td.getAttribute("data-col");
        if (!id || !col) return;         // preview não tem __id → não edita
        const newVal = td.textContent;
        if (newVal === original) return;

        td.classList.add("cell-saving");
        try{
          const res = await fetch("/api/reports/row", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, changes: { [col]: newVal } })
          });
          if (!res.ok) throw new Error(await res.text());
          original = newVal;
          td.classList.remove("cell-saving");
          td.classList.add("cell-ok");
          setTimeout(()=>td.classList.remove("cell-ok"), 600);
        }catch(e){
          td.classList.remove("cell-saving");
          td.classList.add("cell-error");
          td.textContent = original;  // rollback
          setTimeout(()=>td.classList.remove("cell-error"), 900);
          setStatus("Erro ao salvar: " + e.message);
        }
      };
      td.addEventListener("focus", () => original = td.textContent);
      td.addEventListener("blur", save);
      td.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){ e.preventDefault(); td.blur(); }
        if (e.key === "Escape"){ td.textContent = original; td.blur(); }
      });
      td.addEventListener("dblclick", () => { const r = document.createRange(); r.selectNodeContents(td); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    });
  }

  // preview
  async function doPreview(){
    if (!$file?.files?.[0]) { setStatus("Escolha um arquivo CSV."); return; }
    setStatus("Gerando pré-visualização…");
    $btnSave && ($btnSave.disabled = true);

    const fd = new FormData();
    fd.append("file", $file.files[0]);
    // seu backend lê "columns" quando quer filtrar as pertinentes
    if ($onlyPert?.checked){
      const PERTINENTES_DEFAULT = [
        "municipio","cnes","nome_fantasia","profissional_nome","profissional_cns",
        "profissional_atende_sus","profissional_cbo","carga_horaria_ambulatorial_sus",
        "carga_horaria_outros","profissional_vinculo","equipe_ine","tipo_equipe",
        "equipe_subtipo","equipe_nome","equipe_area","equipe_dt_ativacao",
        "equipe_dt_desativacao","equipe_dt_entrada","equipe_dt_desligamento",
        "natureza_juridica"
      ];
      fd.append("columns", JSON.stringify(PERTINENTES_DEFAULT));
    }

    try{
      const res = await fetch("/api/upload-csv", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Falha ao pré-visualizar");
      previewRows = data.rows || [];
      const columns = (data.columns && data.columns.length ? data.columns : (previewRows[0] ? Object.keys(previewRows[0]) : [])).filter(c => c !== "__id");
      renderTable(columns, previewRows);
      setStatus(`Pré-visualização: ${previewRows.length} linha(s).`);
      if ($btnSave) $btnSave.disabled = previewRows.length === 0;
      if ($pager) $pager.hidden = true;
    }catch(e){
      setStatus("Erro ao pré-visualizar: " + e.message);
    }
  }

  // salvar
  async function doSave(){
    if (!previewRows.length) { setStatus("Nada para salvar."); return; }
    setStatus("Salvando no banco…"); if ($btnSave) $btnSave.disabled = true;
    try{
      const res = await fetch("/api/reports/save", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ rows: previewRows })
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.detail || "Falha ao salvar");
      setStatus("✅ " + (out.message || "Salvo."));
      curPage = 1;
      await loadSaved(curPage);
      startVersionPolling();
    }catch(e){
      setStatus("Erro ao salvar: " + e.message);
    }finally{
      if ($btnSave) $btnSave.disabled = false;
    }
  }

  // listar dados salvos
  async function loadSaved(page){
    try{
      const res = await fetch(`/api/reports/data?page=${page}&page_size=${pageSize}`);
      const data = await res.json();

      const rows = data.rows || [];
      // tenta descobrir colunas se o backend não mandar "columns"
      const columns = (data.columns && data.columns.length ? data.columns : (rows[0] ? Object.keys(rows[0]) : [])).filter(c => c !== "__id");

      total   = data.total ?? (rows.length || 0);
      curPage = data.page  ?? page;
      lastVersion = data.version || 0;

      renderTable(columns, rows);

      const last = Math.max(1, Math.ceil((total || rows.length) / pageSize));
      if ($pageInfo) $pageInfo.textContent = `Página ${curPage} / ${last}`;
      if ($pager) $pager.hidden = rows.length === 0 || last <= 1;

      setStatus(rows.length ? `Mostrando página ${curPage} de ${last} (total ${total || rows.length})` : "Sem dados.");
    }catch(e){
      setStatus("Erro ao carregar dados: " + e.message);
      if ($pager) $pager.hidden = true;
    }
  }

  // espelho simples por versão (se o backend fornecer)
  function startVersionPolling(){
    if (versionTimer) clearInterval(versionTimer);
    versionTimer = setInterval(async () => {
      try{
        const r = await fetch(`/api/reports/data?page=1&page_size=1`);
        const d = await r.json();
        if ((d.version || 0) !== lastVersion){
          lastVersion = d.version || 0;
          await loadSaved(curPage);
        }
      }catch(_){}
    }, 5000);
  }

  // bind
  $btnPreview && $btnPreview.addEventListener("click", doPreview);
  $btnSave    && $btnSave.addEventListener("click", doSave);
  $prev       && $prev.addEventListener("click", () => { if (curPage > 1) loadSaved(--curPage); });
  $next       && $next.addEventListener("click", () => {
    const last = Math.max(1, Math.ceil((total || 0) / pageSize));
    if (curPage < last) loadSaved(++curPage);
  });

  // carga inicial
  loadSaved(curPage).then(startVersionPolling);
})();
