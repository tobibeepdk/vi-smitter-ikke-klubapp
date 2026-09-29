(function () {
  "use strict";

  const root = document.querySelector("#vsi-auth-root");
  const config = window.VSI_AUTH_CONFIG || {};
  let client = null;
  let context = null;
  let readyResolved = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const api = {
    ready,
    get client() {
      return client;
    },
    getContext: () => context,
    signOut: async () => {
      if (client) await client.auth.signOut();
      window.location.reload();
    },
    openUsers: () => openUsersDialog(),
  };
  window.VSIAuth = api;

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toLocaleUpperCase("da-DK");
  }

  function appUrl(extra = {}) {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    Object.entries(extra).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    return url.toString();
  }

  function invitationToken() {
    const values = new Uint8Array(32);
    crypto.getRandomValues(values);
    return btoa(String.fromCharCode(...values))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }

  function logoUrl() {
    return document.querySelector(".brand img, .topbar__brand img")?.src || "";
  }

  function authFrame(body) {
    return `<div class="vsi-auth-screen">
      <section class="vsi-auth-card" aria-labelledby="vsi-auth-title">
        <header class="vsi-auth-brand">
          ${logoUrl() ? `<img class="vsi-auth-logo" src="${escapeHtml(logoUrl())}" alt="V.S.I logo" />` : ""}
          <div><p>Vi smitter ikke</p><h1 id="vsi-auth-title">Klubapp</h1></div>
        </header>
        <div class="vsi-auth-body">${body}</div>
      </section>
    </div>`;
  }

  function setAuthScreen(body) {
    document.body.classList.remove("auth-pending");
    document.body.classList.add("auth-locked");
    root.innerHTML = authFrame(body);
  }

  function renderLoading(text = "Kontrollerer din konto…") {
    setAuthScreen(`<div class="vsi-auth-state" role="status">
      <span class="vsi-auth-spinner" aria-hidden="true"></span>
      <h2>${escapeHtml(text)}</h2>
      <p>Et øjeblik – vi henter klubbens sikre data.</p>
    </div>`);
  }

  function renderConfigurationError() {
    setAuthScreen(`<div class="vsi-auth-state">
      <span class="vsi-auth-state-icon" aria-hidden="true">!</span>
      <h2>Login mangler at blive tilsluttet</h2>
      <p>Flerbrugerversionen er bygget, men klubbens databaseadresse og offentlige projektnøgle mangler endnu.</p>
      <p class="vsi-auth-message">Udfyld <strong>config.js</strong> med Supabase URL og publishable key. Brug aldrig en secret/service_role key.</p>
    </div>`);
  }

  function inviteFromUrl() {
    const url = new URL(window.location.href);
    return url.searchParams.get("invite") || sessionStorage.getItem("vsi-invite-token") || "";
  }

  function rememberInvite() {
    const token = new URL(window.location.href).searchParams.get("invite");
    if (token && token.length >= 32) sessionStorage.setItem("vsi-invite-token", token);
    return token || sessionStorage.getItem("vsi-invite-token") || "";
  }

  function clearInvite() {
    sessionStorage.removeItem("vsi-invite-token");
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    url.searchParams.delete("recovery");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function authErrorMessage(error, fallback = "Det lykkedes ikke. Prøv igen.") {
    const message = String(error?.message || "").toLocaleLowerCase("da-DK");
    if (message.includes("email not confirmed")) return "Bekræft først din e-mail via beskeden i din indbakke.";
    if (message.includes("password") && message.includes("weak")) return "Vælg et stærkere kodeord på mindst 8 tegn.";
    if (message.includes("already registered") || message.includes("already been registered")) return "Der findes allerede en konto til denne e-mail. Vælg Log ind.";
    if (message.includes("rate") || message.includes("too many")) return "Der er forsøgt for mange gange. Vent lidt og prøv igen.";
    if (message.includes("invalid") && message.includes("invite")) return "Invitationslinket er ugyldigt eller udløbet. Bed en administrator om et nyt.";
    return fallback;
  }

  function setFormMessage(form, message, kind = "error") {
    const output = form.querySelector("[data-auth-message]");
    if (!output) return;
    output.textContent = message;
    output.dataset.kind = kind;
    output.focus?.();
  }

  function setBusy(form, busy) {
    form.querySelectorAll("button, input").forEach((element) => {
      element.disabled = busy;
    });
    form.setAttribute("aria-busy", String(busy));
  }

  function renderLogin(defaultMode = inviteFromUrl() ? "signup" : "login") {
    const invite = Boolean(inviteFromUrl());
    setAuthScreen(`
      <p class="vsi-auth-intro">Log ind for at se klubbens fælles data på computer, tablet eller telefon.</p>
      ${invite ? `<div class="vsi-auth-tabs" role="tablist" aria-label="Konto">
        <button class="vsi-auth-tab" type="button" role="tab" data-auth-tab="login" aria-selected="${defaultMode === "login"}">Log ind</button>
        <button class="vsi-auth-tab" type="button" role="tab" data-auth-tab="signup" aria-selected="${defaultMode === "signup"}">Opret konto</button>
      </div>` : ""}
      <form class="vsi-auth-form" data-auth-form="login"${defaultMode === "login" ? "" : " hidden"} novalidate>
        <div class="vsi-auth-field"><label for="vsi-login-email">E-mail</label><input id="vsi-login-email" name="email" type="email" autocomplete="email" inputmode="email" required /></div>
        <div class="vsi-auth-field"><label for="vsi-login-password">Kodeord</label><input id="vsi-login-password" name="password" type="password" autocomplete="current-password" minlength="8" required /></div>
        <p class="vsi-auth-message" data-auth-message tabindex="-1"></p>
        <button class="vsi-auth-primary" type="submit">Log ind</button>
        <button class="vsi-auth-link-button" type="button" data-auth-action="forgot">Glemt kodeord?</button>
      </form>
      ${invite ? `<form class="vsi-auth-form" data-auth-form="signup"${defaultMode === "signup" ? "" : " hidden"} novalidate>
        <div class="vsi-auth-field"><label for="vsi-signup-name">Dit navn</label><input id="vsi-signup-name" name="name" type="text" autocomplete="name" maxlength="100" required /></div>
        <div class="vsi-auth-field"><label for="vsi-signup-email">E-mail</label><input id="vsi-signup-email" name="email" type="email" autocomplete="email" inputmode="email" required /></div>
        <div class="vsi-auth-field"><label for="vsi-signup-password">Vælg kodeord</label><input id="vsi-signup-password" name="password" type="password" autocomplete="new-password" minlength="8" required /></div>
        <div class="vsi-auth-field"><label for="vsi-signup-confirm">Gentag kodeord</label><input id="vsi-signup-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required /></div>
        <p class="vsi-auth-message" data-auth-message tabindex="-1"></p>
        <button class="vsi-auth-primary" type="submit">Opret min konto</button>
        <p class="vsi-auth-note">Kontoen knyttes automatisk til den personlige invitation.</p>
      </form>` : `<p class="vsi-auth-note">Nye konti oprettes via et personligt invitationslink fra klubbens administrator.</p>`}
    `);
  }

  function renderForgot() {
    setAuthScreen(`
      <p class="vsi-auth-intro">Skriv din e-mail, så sender vi et sikkert link til at vælge et nyt kodeord.</p>
      <form class="vsi-auth-form" data-auth-form="forgot" novalidate>
        <div class="vsi-auth-field"><label for="vsi-forgot-email">E-mail</label><input id="vsi-forgot-email" name="email" type="email" autocomplete="email" inputmode="email" required /></div>
        <p class="vsi-auth-message" data-auth-message tabindex="-1"></p>
        <button class="vsi-auth-primary" type="submit">Send nulstillingslink</button>
        <button class="vsi-auth-link-button" type="button" data-auth-action="back-login">Tilbage til login</button>
      </form>`);
  }

  function renderPasswordUpdate() {
    setAuthScreen(`
      <p class="vsi-auth-intro">Vælg et nyt kodeord til din V.S.I-konto.</p>
      <form class="vsi-auth-form" data-auth-form="update-password" novalidate>
        <div class="vsi-auth-field"><label for="vsi-new-password">Nyt kodeord</label><input id="vsi-new-password" name="password" type="password" autocomplete="new-password" minlength="8" required /></div>
        <div class="vsi-auth-field"><label for="vsi-new-password-confirm">Gentag kodeord</label><input id="vsi-new-password-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required /></div>
        <p class="vsi-auth-message" data-auth-message tabindex="-1"></p>
        <button class="vsi-auth-primary" type="submit">Gem nyt kodeord</button>
      </form>`);
  }

  function renderNoAccess(user) {
    setAuthScreen(`<div class="vsi-auth-state">
      <span class="vsi-auth-state-icon" aria-hidden="true">✓</span>
      <h2>Kontoen er oprettet</h2>
      <p><strong>${escapeHtml(user.email || "Din e-mail")}</strong> er logget ind, men kontoen har endnu ikke adgang til en klub.</p>
      <p class="vsi-auth-message">Åbn dit personlige invitationslink igen, eller bed administratoren om et nyt link.</p>
      <button class="vsi-auth-secondary" type="button" data-auth-action="logout">Log ud</button>
    </div>`);
  }

  function renderConfirmEmail(email) {
    setAuthScreen(`<div class="vsi-auth-state">
      <span class="vsi-auth-state-icon" aria-hidden="true">@</span>
      <h2>Bekræft din e-mail</h2>
      <p>Vi har sendt et bekræftelseslink til <strong>${escapeHtml(email)}</strong>. Åbn linket på samme enhed for at færdiggøre kontoen.</p>
      <button class="vsi-auth-secondary" type="button" data-auth-action="back-login">Tilbage til login</button>
    </div>`);
  }

  async function loadContext(user) {
    const token = rememberInvite();
    if (token) {
      const { error: claimError } = await client.rpc("claim_member_invite", { p_token: token });
      if (claimError) {
        const invalid = authErrorMessage(claimError, "Invitationslinket kunne ikke bruges. Bed administratoren om et nyt.");
        sessionStorage.removeItem("vsi-invite-token");
        renderNoAccess(user);
        const message = root.querySelector(".vsi-auth-message");
        if (message) {
          message.textContent = invalid;
          message.dataset.kind = "error";
        }
        return null;
      }
      clearInvite();
    }

    const [profileResult, membershipResult] = await Promise.all([
      client.from("profiles").select("id, display_name").eq("id", user.id).maybeSingle(),
      client
        .from("club_memberships")
        .select("club_id, user_id, role, status, clubs(id, name, slug)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
    ]);

    if (membershipResult.error) throw membershipResult.error;
    if (!membershipResult.data) {
      renderNoAccess(user);
      return null;
    }

    const membership = membershipResult.data;
    const club = Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs;
    return {
      client,
      user,
      profile: profileResult.data || {
        id: user.id,
        display_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Medlem",
      },
      membership: {
        club_id: membership.club_id,
        user_id: membership.user_id,
        role: membership.role,
        status: membership.status,
      },
      club,
    };
  }

  async function activate(user) {
    renderLoading("Henter din klub…");
    try {
      const nextContext = await loadContext(user);
      if (!nextContext) return;
      context = nextContext;
      document.body.dataset.vsiRole = context.membership.role;
      document.body.classList.remove("auth-pending", "auth-locked");
      root.replaceChildren();
      installAccountControls();
      window.dispatchEvent(new CustomEvent("vsi:auth-context", { detail: context }));
      if (!readyResolved) {
        readyResolved = true;
        resolveReady(context);
      }
    } catch (error) {
      setAuthScreen(`<div class="vsi-auth-state">
        <span class="vsi-auth-state-icon" aria-hidden="true">!</span>
        <h2>Klubdata kunne ikke hentes</h2>
        <p>${escapeHtml(authErrorMessage(error, error?.message || "Kontroller forbindelsen og prøv igen."))}</p>
        <button class="vsi-auth-secondary" type="button" data-auth-action="retry">Prøv igen</button>
      </div>`);
    }
  }

  function installAccountControls() {
    const actions = document.querySelector(".topbar__actions");
    if (!actions || actions.querySelector(".vsi-account-controls")) return;
    const isAdmin = context.membership.role === "admin";
    const displayName = context.profile.display_name || context.user.email || "Medlem";
    const roleLabel = isAdmin ? "Administrator" : "Medlem";
    const savedBadge = actions.querySelector(".saved-badge");
    if (savedBadge) {
      savedBadge.className = "saved-badge vsi-live-status";
      savedBadge.title = "Data synkroniseres sikkert mellem klubbens enheder";
      savedBadge.innerHTML = `<span class="vsi-sync-dot" data-state="ready" aria-hidden="true"></span><span class="saved-badge__desktop" data-sync-label>Synkroniseret</span>`;
    }
    const backup = actions.querySelector(".topbar-backup");
    if (backup && !isAdmin) backup.dataset.vsiRestricted = "true";
    actions.insertAdjacentHTML("beforeend", `<div class="vsi-account-controls">
      ${isAdmin ? `<button class="button button--ghost button--small" type="button" data-vsi-auth-action="users"><span>Brugere</span></button>` : ""}
      <div class="vsi-account-chip" aria-label="Logget ind som ${escapeHtml(displayName)}, ${roleLabel}">
        <span class="vsi-account-avatar" aria-hidden="true">${escapeHtml(initials(displayName))}</span>
        <span class="vsi-account-copy"><strong>${escapeHtml(displayName)}</strong><small>${roleLabel}</small></span>
      </div>
      <button class="button button--ghost button--small" type="button" data-vsi-auth-action="logout"><span>Log ud</span></button>
    </div>`);

    const dataLinks = document.querySelectorAll('[data-route="data"]');
    if (!isAdmin) dataLinks.forEach((element) => { element.dataset.vsiRestricted = "true"; });
  }

  function syncState(detail = {}) {
    const dot = document.querySelector(".vsi-sync-dot");
    const label = document.querySelector("[data-sync-label]");
    if (!dot || !label) return;
    const state = detail.state || "ready";
    dot.dataset.state = state;
    label.textContent = state === "syncing" ? "Synkroniserer…" : state === "error" ? "Synkronisering fejlede" : "Synkroniseret";
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  function showAuthToast(message, kind = "success") {
    document.querySelector(".vsi-auth-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "vsi-auth-toast";
    toast.dataset.kind = kind;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 5500);
  }

  async function openUsersDialog() {
    if (!context || context.membership.role !== "admin") return;
    document.querySelector("#vsi-user-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "vsi-user-dialog";
    dialog.className = "vsi-user-dialog";
    dialog.innerHTML = `<header class="vsi-user-dialog__header"><div><h2>Brugere & invitationer</h2><p>Opret medlemmet i medlemslisten, og lav derefter et personligt link.</p></div><button class="vsi-user-dialog__close" type="button" data-user-close aria-label="Luk">×</button></header><div class="vsi-user-dialog__body"><div class="vsi-auth-state" role="status"><span class="vsi-auth-spinner"></span><p>Henter brugere…</p></div></div>`;
    document.body.append(dialog);
    dialog.querySelector("[data-user-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();

    try {
      const clubId = context.membership.club_id;
      const [membersResult, membershipsResult, invitesResult] = await Promise.all([
        client.from("members").select("id, user_id, full_name, member_role, team, contact_email, active").eq("club_id", clubId).order("full_name"),
        client.from("club_memberships").select("club_id, user_id, role, status").eq("club_id", clubId),
        client.from("member_invite_status").select("id, member_id, expires_at, redeemed_at, revoked_at").eq("club_id", clubId),
      ]);
      const failure = membersResult.error || membershipsResult.error || invitesResult.error;
      if (failure) throw failure;
      const membershipByUser = new Map((membershipsResult.data || []).map((item) => [item.user_id, item]));
      const openInviteByMember = new Map((invitesResult.data || []).filter((item) => !item.redeemed_at && !item.revoked_at && Date.parse(item.expires_at) > Date.now()).map((item) => [item.member_id, item]));
      const rows = (membersResult.data || []).map((member) => {
        const membership = member.user_id ? membershipByUser.get(member.user_id) : null;
        const invite = openInviteByMember.get(member.id);
        const status = membership ? `${membership.role === "admin" ? "Administrator" : "Medlem"} · ${membership.status === "active" ? "Aktiv" : "Deaktiveret"}` : invite ? `Invitation gyldig til ${new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(invite.expires_at))}` : "Ingen konto";
        return `<article class="vsi-user-row" data-user-row data-member-id="${member.id}" data-user-id="${member.user_id || ""}">
          <div class="vsi-user-identity"><strong>${escapeHtml(member.full_name)}</strong><small>${escapeHtml([member.member_role, member.team].filter(Boolean).join(" · ") || "Medlem")} — ${escapeHtml(status)}</small></div>
          ${membership ? `<label class="vsi-user-field"><span>Adgang</span><select data-user-role><option value="member"${membership.role === "member" ? " selected" : ""}>Medlem</option><option value="admin"${membership.role === "admin" ? " selected" : ""}>Administrator</option></select></label><label class="vsi-user-field"><span>Status</span><select data-user-status><option value="active"${membership.status === "active" ? " selected" : ""}>Aktiv</option><option value="disabled"${membership.status === "disabled" ? " selected" : ""}>Deaktiveret</option></select></label><button class="vsi-user-save" type="button" data-user-save>Gem adgang</button>` : `<button class="vsi-user-save" type="button" data-user-invite>${invite ? "Lav nyt link" : "Kopiér invitationslink"}</button>`}
        </article>`;
      }).join("");
      dialog.querySelector(".vsi-user-dialog__body").innerHTML = `<p class="vsi-user-help">Invitationslinks er personlige og udløber efter 7 dage. Send linket privat, for eksempel via Messenger.</p><div class="vsi-user-list">${rows || "<p>Opret først et medlem i medlemslisten.</p>"}</div>`;
    } catch (error) {
      dialog.querySelector(".vsi-user-dialog__body").innerHTML = `<p class="vsi-auth-message" data-kind="error">${escapeHtml(error?.message || "Brugerne kunne ikke hentes.")}</p>`;
    }
  }

  async function handleUserDialogClick(event) {
    const row = event.target.closest("[data-user-row]");
    if (!row || !context) return;
    if (event.target.closest("[data-user-invite]")) {
      const button = event.target.closest("[data-user-invite]");
      button.disabled = true;
      try {
        const token = invitationToken();
        const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
        const { error } = await client.rpc("create_member_invite", { p_member_id: row.dataset.memberId, p_token: token, p_expires_at: expiry });
        if (error) throw error;
        const link = appUrl({ invite: token });
        const copied = await copyText(link);
        if (!copied) window.prompt("Kopiér invitationslinket:", link);
        showAuthToast(copied ? "Invitationslinket er kopieret og klar til Messenger." : "Invitationslinket er oprettet.");
        await openUsersDialog();
      } catch (error) {
        showAuthToast(error?.message || "Invitationslinket kunne ikke oprettes.", "error");
        button.disabled = false;
      }
    } else if (event.target.closest("[data-user-save]")) {
      const button = event.target.closest("[data-user-save]");
      button.disabled = true;
      try {
        const { error } = await client.from("club_memberships").update({ role: row.querySelector("[data-user-role]").value, status: row.querySelector("[data-user-status]").value }).eq("club_id", context.membership.club_id).eq("user_id", row.dataset.userId);
        if (error) throw error;
        showAuthToast("Brugerens adgang er opdateret.");
        await openUsersDialog();
      } catch (error) {
        showAuthToast(authErrorMessage(error, error?.message || "Adgangen kunne ikke gemmes."), "error");
        button.disabled = false;
      }
    }
  }

  async function handleSubmit(event) {
    const form = event.target.closest("[data-auth-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const kind = form.dataset.authForm;
    setBusy(form, true);
    setFormMessage(form, "");
    try {
      if (kind === "login") {
        const { data, error } = await client.auth.signInWithPassword({ email: String(values.get("email") || "").trim(), password: String(values.get("password") || "") });
        if (error) throw error;
        await activate(data.user);
      } else if (kind === "signup") {
        const password = String(values.get("password") || "");
        if (password !== String(values.get("confirm") || "")) throw new Error("Kodeordene er ikke ens.");
        const invite = rememberInvite();
        const email = String(values.get("email") || "").trim();
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: String(values.get("name") || "").trim() },
            emailRedirectTo: appUrl({ invite }),
          },
        });
        if (error) throw error;
        if (data.session && data.user) await activate(data.user);
        else renderConfirmEmail(email);
      } else if (kind === "forgot") {
        const email = String(values.get("email") || "").trim();
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appUrl({ recovery: "1" }) });
        if (error) throw error;
        setFormMessage(form, "Hvis e-mailen findes, er nulstillingslinket sendt.", "success");
      } else if (kind === "update-password") {
        const password = String(values.get("password") || "");
        if (password !== String(values.get("confirm") || "")) throw new Error("Kodeordene er ikke ens.");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        clearInvite();
        const { data } = await client.auth.getUser();
        if (data.user) await activate(data.user);
      }
    } catch (error) {
      const fallback = kind === "login"
        ? "E-mail eller kodeord er forkert."
        : error?.message || "Det lykkedes ikke. Prøv igen.";
      setFormMessage(form, authErrorMessage(error, fallback));
      setBusy(form, false);
    }
  }

  function handleClick(event) {
    const tab = event.target.closest("[data-auth-tab]");
    if (tab) {
      root.querySelectorAll("[data-auth-tab]").forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
      root.querySelectorAll("[data-auth-form]").forEach((form) => { form.hidden = form.dataset.authForm !== tab.dataset.authTab; });
      root.querySelector(`[data-auth-form="${tab.dataset.authTab}"] input`)?.focus();
      return;
    }
    const action = event.target.closest("[data-auth-action]")?.dataset.authAction;
    if (action === "forgot") renderForgot();
    else if (action === "back-login") renderLogin("login");
    else if (action === "logout") api.signOut();
    else if (action === "retry") window.location.reload();

    const shellAction = event.target.closest("[data-vsi-auth-action]")?.dataset.vsiAuthAction;
    if (shellAction === "logout") api.signOut();
    else if (shellAction === "users") openUsersDialog();
  }

  async function start() {
    rememberInvite();
    const validConfig = /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(String(config.supabaseUrl || ""))
      && String(config.publishableKey || "").length > 20
      && !String(config.publishableKey || "").toLocaleLowerCase("en-US").includes("service_role");
    if (!validConfig || !window.supabase?.createClient) {
      renderConfigurationError();
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    root.addEventListener("submit", handleSubmit);
    document.addEventListener("click", handleClick);
    document.addEventListener("click", handleUserDialogClick);
    window.addEventListener("vsi:sync-state", (event) => syncState(event.detail));

    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") renderPasswordUpdate();
      else if (event === "SIGNED_OUT") renderLogin("login");
      else if (event === "TOKEN_REFRESHED") syncState({ state: "ready" });
    });

    renderLoading();
    const { data, error } = await client.auth.getSession();
    if (error) {
      renderLogin("login");
      return;
    }
    if (new URL(window.location.href).searchParams.get("recovery") === "1" && data.session) {
      renderPasswordUpdate();
    } else if (data.session?.user) {
      await activate(data.session.user);
    } else {
      renderLogin();
    }
  }

  start();
})();
