

  /* =========================
     SUPABASE
  ========================= */

  const SUPABASE_URL =
    "https://ymcvuwovcrqbhuhrjerd.supabase.co";

  const SUPABASE_KEY =
    "sb_publishable_Hu2aLWbK4YjkTPevo6TRtw_dRO4BIPc";

  const supabaseClient =
    window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_KEY
    );


  let currentTopupFilter = "pending";
  let topupsCache = [];

  /* =========================
     ADMIN SECURITY
  ========================= */

  async function checkAdmin() {

    const loadingText =
      document.getElementById("loadingText");

    try {

      const {
        data: { user },
        error: userError
      } = await supabaseClient.auth.getUser();


      if (userError || !user) {

        console.error("[SUBLY] No session:", userError);

        window.location.href = "../login.html";
        return;
      }


      console.log("[SUBLY] User:", user.id);


      const {
        data: profile,
        error: profileError
      } = await supabaseClient
        .from("profiles")
        .select("username, business_name, role, status, tier")
        .eq("id", user.id)
        .single();


      if (profileError || !profile) {

        console.error(
          "[SUBLY] Profile error:",
          profileError
        );

        loadingText.textContent =
          "Unable to load admin profile.";

        return;
      }


      console.log("[SUBLY] Profile:", profile);


      if (profile.status !== "active") {

        await supabaseClient.auth.signOut();

        window.location.href = "../login.html";
        return;
      }


      if (profile.role !== "admin") {

        console.warn(
          "[SUBLY] Unauthorized admin access"
        );

        window.location.href = "../login.html";
        return;
      }


      document.getElementById("adminName").textContent =
        profile.username || "Administrator";


      document.getElementById("loadingScreen").style.display =
        "none";

      document.getElementById("app").style.display =
        "block";


      console.log(
        "[SUBLY] ADMIN ACCESS GRANTED"
      );


      initializeCurrentPage();

    }

    catch (error) {

      console.error(
        "[SUBLY] Admin initialization error:",
        error
      );

      loadingText.textContent =
        "Something went wrong.";

    }

  }


  /* =========================
     DASHBOARD DATA
  ========================= */

  async function loadDashboard() {

    // Dashboard elements only exist on admin/index.html.
    if (!document.getElementById("resellerCount")) return;

    try {

      const {
        count: resellerCount,
        error: resellerError
      } = await supabaseClient
        .from("profiles")
        .select("*", {
          count: "exact",
          head: true
        })
        .eq("role", "reseller");


      if (!resellerError) {
        document.getElementById(
          "resellerCount"
        ).textContent = resellerCount ?? 0;
      }


      const {
        count: orderCount,
        error: orderError
      } = await supabaseClient
        .from("orders")
        .select("*", {
          count: "exact",
          head: true
        });


      if (!orderError) {
        document.getElementById(
          "orderCount"
        ).textContent = orderCount ?? 0;
      }


      const {
        count: topupCount,
        error: topupError
      } = await supabaseClient
        .from("topup_requests")
        .select("*", {
          count: "exact",
          head: true
        })
        .eq("status", "pending");


      if (!topupError) {
        document.getElementById(
          "topupCount"
        ).textContent = topupCount ?? 0;
      }


      const {
        data: wallets,
        error: walletError
      } = await supabaseClient
        .from("wallets")
        .select("balance");


      if (!walletError && wallets) {

        const total =
          wallets.reduce(
            (sum, wallet) =>
              sum + Number(wallet.balance || 0),
            0
          );

        document.getElementById(
          "walletTotal"
        ).textContent =
          "$" + total.toFixed(2);

      }


      console.log(
        "[SUBLY] Dashboard loaded"
      );

    }

    catch (error) {

      console.error(
        "[SUBLY] Dashboard error:",
        error
      );

    }

  }





  const CURRENT_ADMIN_PAGE = document.body?.dataset?.page || "dashboard";

  function initializeCurrentPage() {
    switch (CURRENT_ADMIN_PAGE) {
      case "resellers":
        loadResellers();
        break;
      case "topups":
        loadTopups();
        break;
      case "orders":
        loadOrders();
        break;
      case "dashboard":
        loadDashboard();
        break;
      default:
        break;
    }
  }

  /* =========================
     TOP-UP REQUESTS
  ========================= */

  function money(value) {
    return "$" + Number(value || 0).toFixed(2);
  }

  function formatDateTime(value) {
    if (!value) return "—";

    return new Date(value).toLocaleString(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function topupPaymentMethodLabel(value) {
    if (value === "whish_money") return "Whish Money";
    if (value === "cash") return "Cash";
    if (value === "crypto") return "Crypto";
    return value || "Unknown";
  }

  function setTopupFilter(filter) {
    currentTopupFilter = filter;

    document
      .querySelectorAll(".topup-tab")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.topupFilter === filter
        );
      });

    renderTopups();
  }

  async function loadTopups() {
    const container = document.getElementById("topupList");

    if (!container) {
      console.error("[SUBLY] topupList element not found");
      return;
    }

    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">💳</div>
        <div>Loading top-up requests...</div>
      </div>
    `;

    try {
      const {
        data: topups,
        error: topupError
      } = await supabaseClient
        .from("topup_requests")
        .select(`
          id,
          user_id,
          amount,
          currency,
          payment_method,
          payment_reference,
          note,
          status,
          reviewed_by,
          reviewed_at,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (topupError) {
        console.error("[SUBLY] Top-up load error:", topupError);

        container.innerHTML = `
          <div class="empty">
            <div class="empty-icon">⚠️</div>
            <div>Could not load top-up requests.</div>
          </div>
        `;
        return;
      }

      const userIds = [
        ...new Set(
          (topups || [])
            .map(item => item.user_id)
            .filter(Boolean)
        )
      ];

      let profiles = [];

      if (userIds.length) {
        const {
          data: profileRows,
          error: profileError
        } = await supabaseClient
          .from("profiles")
          .select(`
            id,
            username,
            business_name,
            reseller_code
          `)
          .in("id", userIds);

        if (profileError) {
          console.error("[SUBLY] Top-up reseller profile error:", profileError);
        } else {
          profiles = profileRows || [];
        }
      }

      topupsCache = (topups || []).map(item => {
        const reseller = profiles.find(
          profile => profile.id === item.user_id
        );

        return {
          ...item,
          reseller
        };
      });

      renderTopups();

      console.log(
        "[SUBLY] Top-ups loaded:",
        topupsCache.length
      );

    } catch (error) {
      console.error("[SUBLY] loadTopups crashed:", error);

      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <div>Something went wrong while loading top-ups.</div>
        </div>
      `;
    }
  }

  function renderTopups() {
    const container = document.getElementById("topupList");
    if (!container) return;

    const rows =
      currentTopupFilter === "all"
        ? topupsCache
        : topupsCache.filter(
            item => (item.status || "pending") === currentTopupFilter
          );

    if (!rows.length) {
      const label =
        currentTopupFilter === "all"
          ? "top-up requests"
          : `${currentTopupFilter} top-up requests`;

      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">💳</div>
          <div>No ${escapeHtml(label)}.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = rows.map(item => {
      const resellerName =
        item.reseller?.business_name ||
        item.reseller?.username ||
        "Unknown reseller";

      const paymentId =
        item.payment_reference ||
        item.reseller?.reseller_code ||
        "—";

      const status = item.status || "pending";

      return `
        <div class="topup-card">

          <div class="topup-card-head">
            <div>
              <div class="topup-reseller">
                ${escapeHtml(resellerName)}
              </div>

              <div class="topup-meta">
                ${escapeHtml(item.reseller?.username || "")}
                ${item.reseller?.username ? " • " : ""}
                Submitted ${escapeHtml(formatDateTime(item.created_at))}
              </div>
            </div>

            <span class="status-badge ${escapeHtml(status)}">
              ${escapeHtml(status)}
            </span>
          </div>

          <div class="topup-details">

            <div class="topup-detail">
              <div class="topup-detail-label">Amount</div>
              <div class="topup-detail-value">
                ${money(item.amount)}
              </div>
            </div>

            <div class="topup-detail">
              <div class="topup-detail-label">Payment Method</div>
              <div class="topup-detail-value">
                ${escapeHtml(topupPaymentMethodLabel(item.payment_method))}
              </div>
            </div>

            <div class="topup-detail">
              <div class="topup-detail-label">Payment ID</div>
              <div class="topup-detail-value topup-payment-id">
                ${escapeHtml(paymentId)}
              </div>
            </div>

            <div class="topup-detail">
              <div class="topup-detail-label">Request ID</div>
              <div class="topup-detail-value">
                ${escapeHtml(item.id.slice(0, 8))}
              </div>
            </div>

          </div>

          ${
            item.note
              ? `
                <div class="topup-note">
                  <strong>Note:</strong>
                  ${escapeHtml(item.note)}
                </div>
              `
              : ""
          }

          ${
            status === "pending"
              ? `
                <div class="topup-actions">
                  <button
                    class="topup-button approve"
                    type="button"
                    onclick="approveTopup('${item.id}', this)"
                  >
                    ✓ Approve
                  </button>

                  <button
                    class="topup-button reject"
                    type="button"
                    onclick="rejectTopup('${item.id}', this)"
                  >
                    ✕ Reject
                  </button>
                </div>
              `
              : `
                <div class="topup-meta" style="margin-top:12px;">
                  Reviewed:
                  ${escapeHtml(formatDateTime(item.reviewed_at))}
                </div>
              `
          }

        </div>
      `;
    }).join("");
  }

  async function approveTopup(topupId, button) {
    const request = topupsCache.find(
      item => item.id === topupId
    );

    if (!request) return;

    const resellerName =
      request.reseller?.business_name ||
      request.reseller?.username ||
      "this reseller";

    const confirmed = window.confirm(
      `Approve ${money(request.amount)} for ${resellerName}?\\n\\nOnly approve after verifying the payment.`
    );

    if (!confirmed) return;

    const card = button?.closest(".topup-card");
    const buttons = card?.querySelectorAll(".topup-button") || [];

    buttons.forEach(item => item.disabled = true);
    button.textContent = "Approving...";

    try {
      const {
        data,
        error
      } = await supabaseClient.rpc(
        "approve_topup",
        {
          p_topup_id: topupId
        }
      );

      if (error) {
        console.error("[SUBLY] Approve top-up error:", error);
        alert(error.message || "Could not approve top-up.");
        return;
      }

      if (!data?.success) {
        alert("Could not approve top-up.");
        return;
      }

      await Promise.all([
        loadTopups(),
        loadDashboard()
      ]);

    } catch (error) {
      console.error("[SUBLY] approveTopup crashed:", error);
      alert("Something went wrong while approving the top-up.");
    } finally {
      buttons.forEach(item => item.disabled = false);
    }
  }

  async function rejectTopup(topupId, button) {
    const request = topupsCache.find(
      item => item.id === topupId
    );

    if (!request) return;

    const resellerName =
      request.reseller?.business_name ||
      request.reseller?.username ||
      "this reseller";

    const confirmed = window.confirm(
      `Reject the ${money(request.amount)} top-up request from ${resellerName}?`
    );

    if (!confirmed) return;

    const card = button?.closest(".topup-card");
    const buttons = card?.querySelectorAll(".topup-button") || [];

    buttons.forEach(item => item.disabled = true);
    button.textContent = "Rejecting...";

    try {
      const {
        data,
        error
      } = await supabaseClient.rpc(
        "reject_topup",
        {
          p_topup_id: topupId
        }
      );

      if (error) {
        console.error("[SUBLY] Reject top-up error:", error);
        alert(error.message || "Could not reject top-up.");
        return;
      }

      if (!data?.success) {
        alert("Could not reject top-up.");
        return;
      }

      await Promise.all([
        loadTopups(),
        loadDashboard()
      ]);

    } catch (error) {
      console.error("[SUBLY] rejectTopup crashed:", error);
      alert("Something went wrong while rejecting the top-up.");
    } finally {
      buttons.forEach(item => item.disabled = false);
    }
  }


  /* =========================
     MOBILE NAVIGATION
  ========================= */

  function openMobileMenu() {
    if (window.innerWidth > 760) return;

    document.body.classList.add("menu-open");

    document
      .getElementById("menuToggle")
      ?.setAttribute("aria-expanded", "true");
  }

  function closeMobileMenu() {
    document.body.classList.remove("menu-open");

    document
      .getElementById("menuToggle")
      ?.setAttribute("aria-expanded", "false");
  }

  function toggleMobileMenu() {
    document.body.classList.contains("menu-open")
      ? closeMobileMenu()
      : openMobileMenu();
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeMobileMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      closeMobileMenu();
    }
  });


  /* =========================
     LOGOUT
  ========================= */

  async function logout() {

    await supabaseClient.auth.signOut();

    window.location.href =
      "../login.html";

  }
async function loadResellers() {
  const container = document.getElementById("resellerList");

  if (!container) {
    console.error("[SUBLY] resellerList element not found");
    return;
  }

  console.log("[SUBLY] Loading resellers...");

  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select(`
        id,
        username,
        business_name,
        tier,
        status,
        role,
        created_at
      `)
      .eq("role", "reseller")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[SUBLY] Reseller load error:", error);

      container.innerHTML = `
        <div class="empty">
          Could not load resellers.
        </div>
      `;
      return;
    }

    console.log("[SUBLY] Resellers:", data);

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">👥</div>
          <div>No reseller accounts yet.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(reseller => `
      <div class="reseller-row">

        <div>
          <div class="reseller-name">
            ${reseller.username || "No username"}
          </div>

          <div class="reseller-sub">
            ${reseller.business_name || "No business name"}
          </div>
        </div>

        <div>
          <span class="badge">
            ${reseller.tier || "bronze"}
          </span>
        </div>

        <div>
          <span class="badge ${reseller.status || "inactive"}">
            ${reseller.status || "inactive"}
          </span>
        </div>

        <div>
          <button
            class="action"
            style="padding:8px 12px;"
            type="button"
            onclick="openResellerManage('${reseller.id}')"
          >
            Manage
          </button>
        </div>

      </div>
    `).join("");

    console.log("[SUBLY] Resellers loaded:", data.length);

  } catch (error) {
    console.error("[SUBLY] Reseller page crashed:", error);

    container.innerHTML = `
      <div class="empty">
        Something went wrong.
      </div>
    `;
  }
}

let selectedManagedResellerId = null;

async function openResellerManage(resellerId) {
  selectedManagedResellerId = resellerId;

  const modal = document.getElementById("manageResellerModal");
  const message = document.getElementById("manageResellerMessage");

  if (!modal) return;

  message.textContent = "";
  message.className = "manage-message";

  modal.classList.add("show");

  document.getElementById("manageBusiness").textContent = "Loading...";
  document.getElementById("manageUsername").textContent = "Loading...";
  document.getElementById("managePaymentId").textContent = "Loading...";
  document.getElementById("manageWalletBalance").textContent = "Loading...";
  document.getElementById("manageOrderCount").textContent = "Loading...";
  document.getElementById("manageCreatedAt").textContent = "Loading...";
  document.getElementById("manageTransactions").innerHTML =
    `<div class="manage-list-item">Loading...</div>`;

  try {
    const [
      profileResult,
      walletResult,
      ordersResult,
      transactionsResult
    ] = await Promise.all([
      supabaseClient
        .from("profiles")
        .select(`
          id,
          username,
          business_name,
          reseller_code,
          tier,
          status,
          created_at
        `)
        .eq("id", resellerId)
        .single(),

      supabaseClient
        .from("wallets")
        .select("balance")
        .eq("user_id", resellerId)
        .maybeSingle(),

      supabaseClient
        .from("orders")
        .select("*", { count:"exact", head:true })
        .eq("user_id", resellerId),

      supabaseClient
        .from("wallet_transactions")
        .select(`
          id,
          amount,
          balance_after,
          type,
          description,
          created_at
        `)
        .eq("user_id", resellerId)
        .order("created_at", { ascending:false })
        .limit(8)
    ]);

    if (profileResult.error || !profileResult.data) {
      throw profileResult.error || new Error("Reseller not found");
    }

    const profile = profileResult.data;

    document.getElementById("manageBusiness").textContent =
      profile.business_name || "—";

    document.getElementById("manageUsername").textContent =
      profile.username || "—";

    document.getElementById("managePaymentId").textContent =
      profile.reseller_code || "—";

    document.getElementById("manageWalletBalance").textContent =
      money(walletResult.data?.balance || 0);

    document.getElementById("manageOrderCount").textContent =
      ordersResult.count ?? 0;

    document.getElementById("manageCreatedAt").textContent =
      formatDateTime(profile.created_at);

    document.getElementById("manageTier").value =
      profile.tier || "bronze";

    document.getElementById("manageStatus").value =
      profile.status || "inactive";

    const rows = transactionsResult.data || [];
    const txContainer = document.getElementById("manageTransactions");

    if (transactionsResult.error) {
      txContainer.innerHTML =
        `<div class="manage-list-item">Could not load wallet activity.</div>`;
    } else if (!rows.length) {
      txContainer.innerHTML =
        `<div class="manage-list-item">No wallet transactions yet.</div>`;
    } else {
      txContainer.innerHTML = rows.map(item => {
        const amount = Number(item.amount || 0);
        const sign = amount > 0 ? "+" : "";

        return `
          <div class="manage-list-item">
            <strong>${escapeHtml(item.type || "Transaction")}</strong>
            • ${sign}${money(amount)}
            • Balance: ${money(item.balance_after)}
            <br>
            <span style="color:var(--muted);">
              ${escapeHtml(item.description || "")}
              ${item.description ? " • " : ""}
              ${escapeHtml(formatDateTime(item.created_at))}
            </span>
          </div>
        `;
      }).join("");
    }

  } catch (error) {
    console.error("[SUBLY] openResellerManage error:", error);

    message.textContent =
      error?.message || "Could not load reseller details.";

    message.classList.add("error");
  }
}

function closeResellerManage() {
  document
    .getElementById("manageResellerModal")
    ?.classList.remove("show");

  selectedManagedResellerId = null;
}

async function saveResellerSettings() {
  if (!selectedManagedResellerId) return;

  const tier = document.getElementById("manageTier").value;
  const status = document.getElementById("manageStatus").value;
  const button = document.getElementById("saveResellerSettingsButton");
  const message = document.getElementById("manageResellerMessage");

  message.textContent = "";
  message.className = "manage-message";

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const { data, error } = await supabaseClient.rpc(
      "admin_update_reseller",
      {
        p_user_id: selectedManagedResellerId,
        p_tier: tier,
        p_status: status
      }
    );

    if (error) {
      console.error("[SUBLY] admin_update_reseller error:", error);
      message.textContent =
        error.message || "Could not update reseller.";
      message.classList.add("error");
      return;
    }

    if (!data?.success) {
      message.textContent = "Could not update reseller.";
      message.classList.add("error");
      return;
    }

    message.textContent = "Reseller settings updated successfully.";
    message.classList.add("success");

    await Promise.all([
      loadResellers(),
      loadDashboard()
    ]);

  } catch (error) {
    console.error("[SUBLY] saveResellerSettings crashed:", error);
    message.textContent = "Something went wrong.";
    message.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Save Account Settings";
  }
}

async function adjustResellerWallet() {
  if (!selectedManagedResellerId) return;

  const amountInput = document.getElementById("manageWalletAmount");
  const noteInput = document.getElementById("manageWalletNote");
  const button = document.getElementById("adjustWalletButton");
  const message = document.getElementById("manageResellerMessage");

  const amount = Number(amountInput.value || 0);
  const note = noteInput.value.trim();

  message.textContent = "";
  message.className = "manage-message";

  if (!Number.isFinite(amount) || amount === 0) {
    message.textContent =
      "Enter a positive amount to add funds or a negative amount to deduct funds.";
    message.classList.add("error");
    return;
  }

  if (!note) {
    message.textContent = "Enter a reason for the wallet adjustment.";
    message.classList.add("error");
    return;
  }

  const confirmed = window.confirm(
    `Apply ${amount > 0 ? "+" : ""}${money(amount)} to this reseller's wallet?`
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Applying...";

  try {
    const { data, error } = await supabaseClient.rpc(
      "admin_adjust_wallet",
      {
        p_user_id: selectedManagedResellerId,
        p_amount: amount,
        p_note: note
      }
    );

    if (error) {
      console.error("[SUBLY] admin_adjust_wallet error:", error);
      message.textContent =
        error.message || "Could not adjust wallet.";
      message.classList.add("error");
      return;
    }

    if (!data?.success) {
      message.textContent = "Could not adjust wallet.";
      message.classList.add("error");
      return;
    }

    message.textContent =
      `Wallet updated. New balance: ${money(data.new_balance)}`;
    message.classList.add("success");

    amountInput.value = "";
    noteInput.value = "";

    await Promise.all([
      openResellerManage(selectedManagedResellerId),
      loadDashboard()
    ]);

  } catch (error) {
    console.error("[SUBLY] adjustResellerWallet crashed:", error);
    message.textContent = "Something went wrong.";
    message.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Apply Wallet Adjustment";
  }
}


  /* =========================
   RESELLER MODAL
========================= */

function openResellerModal() {
  document
    .getElementById("resellerModal")
    .classList.add("show");

  document.getElementById(
    "resellerModalMessage"
  ).textContent = "";
}


function closeResellerModal() {
  document
    .getElementById("resellerModal")
    .classList.remove("show");
}


/* =========================
   CREATE RESELLER
========================= */

async function createReseller() {

  const username =
    document
      .getElementById("newResellerUsername")
      .value
      .trim()
      .toLowerCase();

  const businessName =
    document
      .getElementById("newResellerBusiness")
      .value
      .trim();

  const password =
    document
      .getElementById("newResellerPassword")
      .value;

  const tier =
    document
      .getElementById("newResellerTier")
      .value;

  const message =
    document.getElementById(
      "resellerModalMessage"
    );

  const button =
    document.getElementById(
      "createResellerButton"
    );


  message.textContent = "";


  if (!username || !businessName || !password) {
    message.textContent =
      "Please fill in all fields.";
    return;
  }


  button.disabled = true;
  button.textContent = "Creating...";


  console.log(
    "[SUBLY] Creating reseller:",
    {
      username,
      business_name: businessName,
      tier
    }
  );


  try {

    const {
      data,
      error
    } =
      await supabaseClient.functions.invoke(
        "create-reseller",
        {
          body: {
            username: username,
            password: password,
            business_name: businessName,
            tier: tier
          }
        }
      );


    console.log(
      "[SUBLY] create-reseller response:",
      data
    );


    if (error) {

      console.error(
        "[SUBLY] Edge Function error:",
        error
      );

      message.textContent =
        "Could not create reseller.";

      return;
    }


    if (!data || data.error) {

      console.error(
        "[SUBLY] Reseller creation failed:",
        data
      );

      message.textContent =
        data?.error ||
        "Could not create reseller.";

      return;
    }


    console.log(
      "[SUBLY] Reseller created:",
      data.reseller
    );


    message.style.color =
      "var(--green)";

    message.textContent =
      "Reseller created successfully ✓";


    document.getElementById(
      "newResellerUsername"
    ).value = "";

    document.getElementById(
      "newResellerBusiness"
    ).value = "";

    document.getElementById(
      "newResellerPassword"
    ).value = "";

    document.getElementById(
      "newResellerTier"
    ).value = "bronze";


    await loadResellers();
    await loadDashboard();


    setTimeout(() => {

      closeResellerModal();

      message.style.color =
        "var(--red)";

    }, 900);

  }

  catch (error) {

    console.error(
      "[SUBLY] createReseller crashed:",
      error
    );

    message.textContent =
      "Something went wrong.";

  }

  finally {

    button.disabled = false;
    button.textContent =
      "Create Reseller";

  }
}
  /* =========================
   ORDERS
========================= */

function formatDate(value) {

  if (!value) return "—";

  return new Date(value).toLocaleDateString(
    undefined,
    {
      year: "numeric",
      month: "short",
      day: "numeric"
    }
  );
}


async function loadOrders() {

  const ordersContainer =
    document.getElementById("ordersList");

  const renewalsContainer =
    document.getElementById("renewalsList");


  if (!ordersContainer || !renewalsContainer) {
    console.error("[SUBLY] Orders containers missing");
    return;
  }


  ordersContainer.innerHTML = `
    <div class="empty">
      <div class="empty-icon">🛒</div>
      <div>Loading orders...</div>
    </div>
  `;


  renewalsContainer.innerHTML = `
    <div class="empty">
      <div class="empty-icon">🔁</div>
      <div>Loading renewals...</div>
    </div>
  `;


  console.log("[SUBLY] Loading orders...");


  try {

    /* =========================
       SUBSCRIPTION ORDERS
    ========================= */

    const {
      data: orders,
      error: ordersError
    } =
      await supabaseClient
        .from("orders")
        .select(`
          id,
          user_id,
          product_id,
          status,
          created_at,
          activated_at,
          expires_at,
          delivery_url,
          delivery_text
        `)
        .order("created_at", {
          ascending: false
        });


    if (ordersError) {

      console.error(
        "[SUBLY] Orders error:",
        ordersError
      );

      ordersContainer.innerHTML = `
        <div class="empty">
          Could not load orders.
        </div>
      `;

    } else {

      const orderUserIds =
        [...new Set(
          (orders || [])
            .map(order => order.user_id)
            .filter(Boolean)
        )];

      const orderProductIds =
        [...new Set(
          (orders || [])
            .map(order => order.product_id)
            .filter(Boolean)
        )];


      let profiles = [];
      let products = [];


      if (orderUserIds.length) {

        const { data } =
          await supabaseClient
            .from("profiles")
            .select(
              "id,username,business_name"
            )
            .in("id", orderUserIds);

        profiles = data || [];
      }


      if (orderProductIds.length) {

        const { data } =
          await supabaseClient
            .from("products")
            .select(
              "id,app_name,account_type,duration"
            )
            .in("id", orderProductIds);

        products = data || [];
      }


      if (!orders || orders.length === 0) {

        ordersContainer.innerHTML = `
          <div class="empty">
            <div class="empty-icon">🛒</div>
            <div>No subscription orders yet.</div>
          </div>
        `;

      } else {

        ordersContainer.innerHTML =
          orders.map(order => {

            const reseller =
              profiles.find(
                profile =>
                  profile.id === order.user_id
              );

            const product =
              products.find(
                item =>
                  item.id === order.product_id
              );


            const productName =
              product?.app_name ||
              "Unknown product";

            const type =
              product?.account_type ||
              "—";

            const duration =
              product?.duration ||
              "—";

            const resellerName =
              reseller?.business_name ||
              reseller?.username ||
              "Unknown reseller";


            return `
              <div class="order-card">

                <div class="order-top">

                  <div>

                    <div class="order-number">
                      Order • ${order.id.slice(0, 8)}
                    </div>

                    <div class="order-name">
                      ${productName}
                    </div>

                    <div class="order-reseller">
                      ${resellerName}
                    </div>

                  </div>

                  <span class="status-badge ${order.status}">
                    ${order.status || "unknown"}
                  </span>

                </div>


                <div class="order-details">

                  <div class="order-detail">
                    <div class="order-detail-label">
                      Account Type
                    </div>

                    <div class="order-detail-value">
                      ${type}
                    </div>
                  </div>


                  <div class="order-detail">
                    <div class="order-detail-label">
                      Duration
                    </div>

                    <div class="order-detail-value">
                      ${duration}
                    </div>
                  </div>


                  <div class="order-detail">
                    <div class="order-detail-label">
                      Activated
                    </div>

                    <div class="order-detail-value">
                      ${formatDate(order.activated_at)}
                    </div>
                  </div>


                  <div class="order-detail">
                    <div class="order-detail-label">
                      Expires
                    </div>

                    <div class="order-detail-value">
                      ${formatDate(order.expires_at)}
                    </div>
                  </div>

                </div>


                <div class="order-actions">

                  ${
                    order.status === "processing"
                    ? `
                      <button
                        class="order-button primary"
                        onclick="openDeliverOrder('${order.id}')"
                      >
                        Deliver Order
                      </button>
                    `
                    : ""
                  }

                  ${
                    order.status === "delivered"
                    ? `
                      <button
                        class="order-button"
                        onclick="manageSubscription('${order.id}')"
                      >
                        Manage
                      </button>
                    `
                    : ""
                  }

                </div>

              </div>
            `;

          }).join("");

      }

    }


    /* =========================
       RENEWALS
    ========================= */

    const {
      data: renewals,
      error: renewalsError
    } =
      await supabaseClient
        .from("renewals")
        .select(`
          id,
          renewal_number,
          order_id,
          user_id,
          renewal_product_id,
          price_paid,
          old_expires_at,
          new_expires_at,
          status,
          created_at,
          completed_at
        `)
        .order("created_at", {
          ascending: false
        });


    if (renewalsError) {

      console.error(
        "[SUBLY] Renewals error:",
        renewalsError
      );

      renewalsContainer.innerHTML = `
        <div class="empty">
          Could not load renewals.
        </div>
      `;

    } else {

      const renewalUserIds =
        [...new Set(
          (renewals || [])
            .map(item => item.user_id)
            .filter(Boolean)
        )];


      const renewalProductIds =
        [...new Set(
          (renewals || [])
            .map(item =>
              item.renewal_product_id
            )
            .filter(Boolean)
        )];


      let renewalProfiles = [];
      let renewalProducts = [];


      if (renewalUserIds.length) {

        const { data } =
          await supabaseClient
            .from("profiles")
            .select(
              "id,username,business_name"
            )
            .in("id", renewalUserIds);

        renewalProfiles = data || [];
      }


      if (renewalProductIds.length) {

        const { data } =
          await supabaseClient
            .from("products")
            .select(
              "id,app_name,account_type,duration"
            )
            .in("id", renewalProductIds);

        renewalProducts = data || [];
      }


      if (!renewals || renewals.length === 0) {

        renewalsContainer.innerHTML = `
          <div class="empty">
            <div class="empty-icon">🔁</div>
            <div>No renewal requests yet.</div>
          </div>
        `;

      } else {

        renewalsContainer.innerHTML =
          renewals.map(renewal => {

            const reseller =
              renewalProfiles.find(
                profile =>
                  profile.id === renewal.user_id
              );

            const product =
              renewalProducts.find(
                item =>
                  item.id === renewal.renewal_product_id
              );


            return `
              <div class="order-card">

                <div class="order-top">

                  <div>

                    <div class="order-number">
                      Renewal #${renewal.renewal_number}
                    </div>

                    <div class="order-name">
                      ${product?.app_name || "Subscription"}
                    </div>

                    <div class="order-reseller">
                      ${
                        reseller?.business_name ||
                        reseller?.username ||
                        "Unknown reseller"
                      }
                    </div>

                  </div>

                  <span class="status-badge ${renewal.status}">
                    ${renewal.status}
                  </span>

                </div>


                <div class="order-details">

                  <div class="order-detail">

                    <div class="order-detail-label">
                      Renewal
                    </div>

                    <div class="order-detail-value">
                      ${product?.duration || "—"}
                    </div>

                  </div>


                  <div class="order-detail">

                    <div class="order-detail-label">
                      Price Paid
                    </div>

                    <div class="order-detail-value">
                      $${Number(
                        renewal.price_paid || 0
                      ).toFixed(2)}
                    </div>

                  </div>


                  <div class="order-detail">

                    <div class="order-detail-label">
                      Current Expiry
                    </div>

                    <div class="order-detail-value">
                      ${formatDate(
                        renewal.old_expires_at
                      )}
                    </div>

                  </div>


                  <div class="order-detail">

                    <div class="order-detail-label">
                      New Expiry
                    </div>

                    <div class="order-detail-value">
                      ${formatDate(
                        renewal.new_expires_at
                      )}
                    </div>

                  </div>

                </div>


                ${
                  renewal.status === "pending"
                  ? `
                    <div class="order-actions">

                      <button
                        class="order-button success"
                        onclick="openCompleteRenewal('${renewal.id}')"
                      >
                        Complete Renewal
                      </button>

                      <button
                        class="order-button danger"
                        onclick="openCancelRenewal('${renewal.id}')"
                      >
                        Cancel & Refund
                      </button>

                    </div>
                  `
                  : ""
                }

              </div>
            `;

          }).join("");

      }

    }


    console.log(
      "[SUBLY] Orders + renewals loaded"
    );

  }

  catch (error) {

    console.error(
      "[SUBLY] loadOrders crashed:",
      error
    );

  }

}


/* TEMPORARY BUTTON HANDLERS
   We'll replace these with proper confirmation
   modals next.
*/

function openDeliverOrder(orderId) {

  console.log(
    "[SUBLY] Deliver order:",
    orderId
  );

  alert(
    "Delivery popup is the next step."
  );
}


function manageSubscription(orderId) {

  console.log(
    "[SUBLY] Manage subscription:",
    orderId
  );

  alert(
    "Subscription management is the next step."
  );
}


function openCompleteRenewal(renewalId) {

  console.log(
    "[SUBLY] Complete renewal:",
    renewalId
  );

  alert(
    "Renewal confirmation popup is the next step."
  );
}


function openCancelRenewal(renewalId) {

  console.log(
    "[SUBLY] Cancel renewal:",
    renewalId
  );

  alert(
    "Cancel + refund confirmation is the next step."
  );
}
  function switchOrderView(view){

  document
    .querySelectorAll(".order-view")
    .forEach(el =>
      el.classList.remove("active")
    );

  document
    .querySelectorAll(".order-tab")
    .forEach(el =>
      el.classList.remove("active")
    );


  if(view === "renewals"){

    document
      .getElementById("renewalOrdersView")
      .classList.add("active");

    document
      .querySelector(
        '[data-order-view="renewals"]'
      )
      .classList.add("active");

  }else{

    document
      .getElementById("subscriptionOrdersView")
      .classList.add("active");

    document
      .querySelector(
        '[data-order-view="subscriptions"]'
      )
      .classList.add("active");

  }

}

  checkAdmin();

