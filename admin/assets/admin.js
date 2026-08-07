

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
      case "products":
        loadAdminProducts();
        break;
      case "transactions":
        loadTransactionsPage();
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
      closeServiceEditor();
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




/* =========================
   PRODUCT MANAGER
========================= */
let adminProductsCache = [];
let adminProductPricesCache = [];
const PRODUCT_TIERS = ["bronze", "silver", "gold", "diamond"];

async function loadAdminProducts() {
  const container = document.getElementById("adminProductsList");
  if (!container) return;
  container.innerHTML = `<div class="empty"><div class="empty-icon">📦</div><div>Loading products...</div></div>`;

  const { data: products, error: productsError } = await supabaseClient
    .from("products")
    .select("id,app_name,account_type,duration,supplier_cost,supplier,active,sort_order,logo_url")
    .order("app_name", { ascending: true })
    .order("sort_order", { ascending: true });

  if (productsError) {
    console.error("[SUBLY] Product manager load error:", productsError);
    container.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div>${escapeHtml(productsError.message || "Could not load products.")}</div></div>`;
    return;
  }

  const { data: prices, error: pricesError } = await supabaseClient
    .from("product_prices")
    .select("product_id,tier,price,minimum_price");

  if (pricesError) {
    console.error("[SUBLY] Product prices load error:", pricesError);
  }

  adminProductsCache = products || [];
  adminProductPricesCache = prices || [];
  updateProductSummary();
  renderAdminProducts();
}

function pricesForProduct(productId) {
  const rows = adminProductPricesCache.filter(row => row.product_id === productId);
  const map = {};
  rows.forEach(row => { map[String(row.tier || "").toLowerCase()] = row; });
  return map;
}

function updateProductSummary() {
  const services = new Set(adminProductsCache.map(p => p.app_name).filter(Boolean));
  const unpriced = adminProductsCache.filter(p => PRODUCT_TIERS.some(t => !pricesForProduct(p.id)[t])).length;
  document.getElementById("productVariantCount").textContent = adminProductsCache.length;
  document.getElementById("productActiveCount").textContent = adminProductsCache.filter(p => p.active).length;
  document.getElementById("productServiceCount").textContent = services.size;
  document.getElementById("productUnpricedCount").textContent = unpriced;
}

function renderAdminProducts() {
  const container = document.getElementById("adminProductsList");
  if (!container) return;
  const search = (document.getElementById("productSearch")?.value || "").trim().toLowerCase();
  const filter = document.getElementById("productStatusFilter")?.value || "all";

  const rows = adminProductsCache.filter(product => {
    const priceMap = pricesForProduct(product.id);
    const haystack = `${product.app_name || ""} ${product.account_type || ""} ${product.duration || ""} ${product.supplier || ""}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (filter === "active" && !product.active) return false;
    if (filter === "inactive" && product.active) return false;
    if (filter === "unpriced" && !PRODUCT_TIERS.some(t => !priceMap[t])) return false;
    return true;
  });

  if (!rows.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">📦</div><div>No matching products.</div></div>`;
    return;
  }

  const groups = {};
  rows.forEach(product => { (groups[product.app_name || "Other"] ||= []).push(product); });

  container.innerHTML = Object.entries(groups).map(([name, variants]) => {
    const logoUrl = variants.find(item => item.logo_url)?.logo_url || "";
    return `
    <section class="service-group">
      <div class="service-group-head">
        <div class="service-group-identity">
          <div class="service-group-logo">
            ${logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name)} logo">`
              : `<span>${escapeHtml((name || "?").slice(0, 1).toUpperCase())}</span>`}
          </div>
          <div>
            <h3>${escapeHtml(name)}</h3>
            <span>${variants.length} variant${variants.length === 1 ? "" : "s"}</span>
          </div>
        </div>

        <button class="product-edit-btn service-edit-btn" type="button" onclick='openServiceEditor(${JSON.stringify(name)})'>
          ✎ Edit App
        </button>
      </div>
      <div class="variant-table-wrap"><table class="variant-table">
        <thead><tr><th>Variant</th><th>Cost</th><th>Bronze</th><th>Silver</th><th>Gold</th><th>Diamond</th><th>Status</th><th></th></tr></thead>
        <tbody>${variants.map(product => {
          const pm = pricesForProduct(product.id);
          return `<tr>
            <td><strong>${escapeHtml(product.account_type || "Standard")}</strong><small>${escapeHtml(product.duration || "—")}</small></td>
            <td>${product.supplier_cost == null ? '<span class="price-missing">Not set</span>' : money(product.supplier_cost)}<small>${escapeHtml(product.supplier || "")}</small></td>
            ${PRODUCT_TIERS.map(t => `<td>${pm[t] ? money(pm[t].price) : '<span class="price-missing">—</span>'}</td>`).join("")}
            <td><span class="product-state ${product.active ? "on" : "off"}">${product.active ? "Active" : "Disabled"}</span></td>
            <td><button class="product-edit-btn" type="button" onclick="openProductEditor('${product.id}')">Edit</button></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </section>`;
  }).join("");
}

function openProductEditor(productId = "") {
  const modal = document.getElementById("productEditorModal");
  const product = adminProductsCache.find(p => p.id === productId);
  const pm = product ? pricesForProduct(product.id) : {};
  document.getElementById("editProductId").value = product?.id || "";
  document.getElementById("editAppName").value = product?.app_name || "";
  document.getElementById("editAccountType").value = product?.account_type || "";
  document.getElementById("editDuration").value = product?.duration || "";
  document.getElementById("editSupplier").value = product?.supplier || "";
  document.getElementById("editSupplierCost").value = product?.supplier_cost ?? "";
  document.getElementById("editSortOrder").value = product?.sort_order ?? 0;
  document.getElementById("editActive").checked = product ? !!product.active : true;
  PRODUCT_TIERS.forEach(t => { document.getElementById(`edit${t[0].toUpperCase()+t.slice(1)}`).value = pm[t]?.price ?? ""; });
  document.getElementById("editMinimum").value = pm.diamond?.minimum_price ?? pm.bronze?.minimum_price ?? "";
  document.getElementById("productEditorTitle").textContent = product ? "Edit Product Variant" : "Add Product Variant";
  document.getElementById("productEditorMessage").textContent = "";

  const deleteButton = document.getElementById("deleteVariantButton");
  if (deleteButton) deleteButton.hidden = !product;

  const logoInput = document.getElementById("editLogoFile");
  if (logoInput) logoInput.value = "";

  setLogoPreview("variantLogoPreview", product?.logo_url || "");
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeProductEditor() {
  const modal = document.getElementById("productEditorModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function numberOrNull(id) {
  const value = document.getElementById(id).value.trim();
  return value === "" ? null : Number(value);
}

async function saveProductEditor(event) {
  event.preventDefault();
  const button = document.getElementById("saveProductButton");
  const message = document.getElementById("productEditorMessage");
  const productId = document.getElementById("editProductId").value;
  const prices = { bronze:numberOrNull("editBronze"), silver:numberOrNull("editSilver"), gold:numberOrNull("editGold"), diamond:numberOrNull("editDiamond") };
  const minimum = numberOrNull("editMinimum");

  const suppliedPrices = Object.values(prices).filter(v => v != null);
  if (minimum != null && suppliedPrices.some(v => v < minimum)) {
    message.textContent = "Minimum floor cannot be higher than any tier price.";
    message.className = "product-editor-message error";
    return;
  }
  if (prices.bronze != null && prices.silver != null && prices.bronze < prices.silver ||
      prices.silver != null && prices.gold != null && prices.silver < prices.gold ||
      prices.gold != null && prices.diamond != null && prices.gold < prices.diamond) {
    message.textContent = "Tier order must be Bronze ≥ Silver ≥ Gold ≥ Diamond.";
    message.className = "product-editor-message error";
    return;
  }

  button.disabled = true; button.textContent = "Saving..."; message.textContent = "";
  try {
    const payload = {
      app_name: document.getElementById("editAppName").value.trim(),
      account_type: document.getElementById("editAccountType").value.trim() || null,
      duration: document.getElementById("editDuration").value.trim(),
      supplier: document.getElementById("editSupplier").value.trim() || null,
      supplier_cost: numberOrNull("editSupplierCost"),
      sort_order: Number(document.getElementById("editSortOrder").value || 0),
      active: document.getElementById("editActive").checked
    };

    const logoFile = document.getElementById("editLogoFile")?.files?.[0] || null;
    if (logoFile) {
      payload.logo_url = await uploadProductLogo(logoFile, payload.app_name);
    }

    let savedId = productId;
    if (productId) {
      const { error } = await supabaseClient.from("products").update(payload).eq("id", productId);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient.from("products").insert(payload).select("id").single();
      if (error) throw error;
      savedId = data.id;
    }

    if (payload.logo_url) {
      await applyLogoToService(payload.app_name, payload.logo_url);
    }

    const priceRows = PRODUCT_TIERS.filter(t => prices[t] != null).map(t => ({
      product_id: savedId, tier: t, price: prices[t], minimum_price: minimum
    }));
    if (priceRows.length) {
      const { error } = await supabaseClient.from("product_prices").upsert(priceRows, { onConflict: "product_id,tier" });
      if (error) throw error;
    }

    message.textContent = "Saved successfully.";
    message.className = "product-editor-message success";
    await loadAdminProducts();
    setTimeout(closeProductEditor, 450);
  } catch (error) {
    console.error("[SUBLY] Product save error:", error);
    message.textContent = error.message || "Could not save product.";
    message.className = "product-editor-message error";
  } finally {
    button.disabled = false; button.textContent = "Save Product";
  }
}



/* =========================
   PRODUCT / APP MANAGEMENT
========================= */

const PRODUCT_LOGO_BUCKET = "product-logos";

function setLogoPreview(elementId, url) {
  const box = document.getElementById(elementId);
  if (!box) return;

  if (url) {
    box.innerHTML = `<img src="${escapeHtml(url)}" alt="Product logo preview">`;
  } else {
    box.innerHTML = `<span>LOGO</span>`;
  }
}

async function uploadProductLogo(file, serviceName) {
  if (!file) return null;

  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Logo must be PNG, JPG or WEBP.");
  }

  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Logo must be smaller than 4 MB.");
  }

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeName = String(serviceName || "service")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "service";

  const path = `${safeName}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabaseClient
    .storage
    .from(PRODUCT_LOGO_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (uploadError) throw uploadError;

  const { data } = supabaseClient
    .storage
    .from(PRODUCT_LOGO_BUCKET)
    .getPublicUrl(path);

  return data?.publicUrl || null;
}

async function applyLogoToService(serviceName, logoUrl) {
  if (!serviceName || !logoUrl) return;

  const { error } = await supabaseClient
    .from("products")
    .update({ logo_url: logoUrl })
    .eq("app_name", serviceName);

  if (error) throw error;
}

async function deleteCurrentProductVariant() {
  const productId = document.getElementById("editProductId")?.value;
  const product = adminProductsCache.find(item => item.id === productId);
  if (!product) return;

  const confirmed = window.confirm(
    `Delete ${product.app_name} • ${product.account_type || "Standard"} • ${product.duration}?\\n\\nThis removes this variant and its reseller prices.`
  );

  if (!confirmed) return;

  const button = document.getElementById("deleteVariantButton");
  const message = document.getElementById("productEditorMessage");

  button.disabled = true;
  button.textContent = "Deleting...";
  message.textContent = "";
  message.className = "product-editor-message";

  try {
    const { count: orderCount, error: countError } = await supabaseClient
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productId);

    if (countError) throw countError;

    if ((orderCount || 0) > 0) {
      throw new Error("This variant has order history, so it cannot be permanently deleted. Disable it instead to keep old orders safe.");
    }

    const { error: priceDeleteError } = await supabaseClient
      .from("product_prices")
      .delete()
      .eq("product_id", productId);

    if (priceDeleteError) throw priceDeleteError;

    const { error: productDeleteError } = await supabaseClient
      .from("products")
      .delete()
      .eq("id", productId);

    if (productDeleteError) throw productDeleteError;

    closeProductEditor();
    await loadAdminProducts();

  } catch (error) {
    console.error("[SUBLY] Variant delete error:", error);
    message.textContent = error.message || "Could not delete this variant.";
    message.className = "product-editor-message error";
  } finally {
    button.disabled = false;
    button.textContent = "🗑 Delete Variant";
  }
}

function openServiceEditor(serviceName) {
  const modal = document.getElementById("serviceEditorModal");
  const variants = adminProductsCache.filter(item => item.app_name === serviceName);
  const logoUrl = variants.find(item => item.logo_url)?.logo_url || "";

  document.getElementById("serviceOriginalName").value = serviceName;
  document.getElementById("serviceNameInput").value = serviceName;
  document.getElementById("serviceLogoFile").value = "";
  document.getElementById("serviceEditorMessage").textContent = "";
  document.getElementById("serviceEditorMessage").className = "product-editor-message";

  setLogoPreview("serviceLogoPreview", logoUrl);

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeServiceEditor() {
  const modal = document.getElementById("serviceEditorModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

async function saveServiceEditor(event) {
  event.preventDefault();

  const originalName = document.getElementById("serviceOriginalName").value.trim();
  const newName = document.getElementById("serviceNameInput").value.trim();
  const logoFile = document.getElementById("serviceLogoFile").files?.[0] || null;
  const button = document.getElementById("saveServiceButton");
  const message = document.getElementById("serviceEditorMessage");

  if (!originalName || !newName) return;

  button.disabled = true;
  button.textContent = "Saving...";
  message.textContent = "";

  try {
    let logoUrl = null;

    if (logoFile) {
      logoUrl = await uploadProductLogo(logoFile, newName);
    }

    const payload = { app_name: newName };
    if (logoUrl) payload.logo_url = logoUrl;

    const { error } = await supabaseClient
      .from("products")
      .update(payload)
      .eq("app_name", originalName);

    if (error) throw error;

    message.textContent = "App updated successfully.";
    message.className = "product-editor-message success";

    await loadAdminProducts();
    setTimeout(closeServiceEditor, 450);

  } catch (error) {
    console.error("[SUBLY] App update error:", error);
    message.textContent = error.message || "Could not update app.";
    message.className = "product-editor-message error";
  } finally {
    button.disabled = false;
    button.textContent = "Save App";
  }
}

async function deleteCurrentService() {
  const serviceName = document.getElementById("serviceOriginalName")?.value.trim();
  if (!serviceName) return;

  const variants = adminProductsCache.filter(item => item.app_name === serviceName);
  const productIds = variants.map(item => item.id);

  const confirmed = window.confirm(
    `Delete the entire ${serviceName} app and all ${variants.length} variant${variants.length === 1 ? "" : "s"}?\\n\\nThis cannot be undone.`
  );

  if (!confirmed) return;

  const message = document.getElementById("serviceEditorMessage");
  message.textContent = "Checking order history...";
  message.className = "product-editor-message";

  try {
    if (productIds.length) {
      const { count: orderCount, error: countError } = await supabaseClient
        .from("orders")
        .select("*", { count: "exact", head: true })
        .in("product_id", productIds);

      if (countError) throw countError;

      if ((orderCount || 0) > 0) {
        throw new Error("This app has order history, so it cannot be permanently deleted. Disable its variants instead so old orders stay valid.");
      }

      const { error: pricesError } = await supabaseClient
        .from("product_prices")
        .delete()
        .in("product_id", productIds);

      if (pricesError) throw pricesError;

      const { error: productsError } = await supabaseClient
        .from("products")
        .delete()
        .in("id", productIds);

      if (productsError) throw productsError;
    }

    closeServiceEditor();
    await loadAdminProducts();

  } catch (error) {
    console.error("[SUBLY] App delete error:", error);
    message.textContent = error.message || "Could not delete this app.";
    message.className = "product-editor-message error";
  }
}

document.getElementById("editLogoFile")?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  setLogoPreview("variantLogoPreview", URL.createObjectURL(file));
});

document.getElementById("serviceLogoFile")?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  setLogoPreview("serviceLogoPreview", URL.createObjectURL(file));
});



/* =========================
   ADMIN TRANSACTION CENTER
========================= */

const TRANSACTION_PAGE_SIZE = 25;

const transactionState = {
  tab: "wallet",
  page: 1,
  total: 0,
  rows: [],
  profiles: [],
  products: [],
  searchTimer: null
};

function transactionProfile(userId) {
  return transactionState.profiles.find(profile => profile.id === userId) || null;
}

function transactionProduct(productId) {
  return transactionState.products.find(product => product.id === productId) || null;
}

function transactionResellerName(userId) {
  const profile = transactionProfile(userId);
  return profile?.business_name || profile?.username || "Unknown reseller";
}

function transactionPaymentMethodLabel(value) {
  if (value === "whish_money") return "Whish Money";
  if (value === "cash") return "Cash";
  if (value === "crypto") return "Crypto";
  return value || "—";
}

function transactionAmountClass(value) {
  const amount = Number(value || 0);
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "";
}

function transactionShortId(value) {
  if (!value) return "—";
  return String(value).slice(0, 8);
}

function transactionDateStart() {
  const value = document.getElementById("transactionDateFilter")?.value || "all";
  if (value === "all") return null;

  const now = new Date();

  if (value === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }

  const days = Number(value);
  if (!Number.isFinite(days)) return null;

  return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString();
}

async function loadTransactionLookups() {
  const [profilesResult, productsResult] = await Promise.all([
    supabaseClient
      .from("profiles")
      .select("id,username,business_name,reseller_code")
      .eq("role", "reseller")
      .order("business_name", { ascending: true }),

    supabaseClient
      .from("products")
      .select("id,app_name,account_type,duration")
      .order("app_name", { ascending: true })
  ]);

  if (profilesResult.error) {
    console.error("[SUBLY] Transaction reseller lookup error:", profilesResult.error);
  }

  if (productsResult.error) {
    console.error("[SUBLY] Transaction product lookup error:", productsResult.error);
  }

  transactionState.profiles = profilesResult.data || [];
  transactionState.products = productsResult.data || [];

  const resellerSelect = document.getElementById("transactionResellerFilter");

  if (resellerSelect) {
    const current = resellerSelect.value;

    resellerSelect.innerHTML = `
      <option value="">All resellers</option>
      ${transactionState.profiles.map(profile => `
        <option value="${escapeHtml(profile.id)}">
          ${escapeHtml(profile.business_name || profile.username || "Unnamed reseller")}
          ${profile.reseller_code ? ` • ${escapeHtml(profile.reseller_code)}` : ""}
        </option>
      `).join("")}
    `;

    resellerSelect.value = current;
  }
}

async function loadTransactionSummary() {
  const [
    walletResult,
    orderResult,
    topupResult,
    pendingResult
  ] = await Promise.all([
    supabaseClient
      .from("wallet_transactions")
      .select("*", { count: "exact", head: true }),

    supabaseClient
      .from("orders")
      .select("*", { count: "exact", head: true }),

    supabaseClient
      .from("topup_requests")
      .select("*", { count: "exact", head: true }),

    supabaseClient
      .from("topup_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
  ]);

  const setCount = (id, result) => {
    const el = document.getElementById(id);
    if (el) el.textContent = result.error ? "—" : (result.count ?? 0);
  };

  setCount("txWalletCount", walletResult);
  setCount("txOrderCount", orderResult);
  setCount("txTopupCount", topupResult);
  setCount("txPendingCount", pendingResult);
}

function configureTransactionStatusFilter() {
  const select = document.getElementById("transactionStatusFilter");
  if (!select) return;

  const current = select.value;

  if (transactionState.tab === "wallet") {
    select.innerHTML = `
      <option value="">All transaction types</option>
      <option value="credit">Credit</option>
      <option value="debit">Debit</option>
      <option value="purchase">Purchase</option>
      <option value="topup">Top-up</option>
      <option value="adjustment">Adjustment</option>
      <option value="refund">Refund</option>
    `;
  } else if (transactionState.tab === "purchases") {
    select.innerHTML = `
      <option value="">All order statuses</option>
      <option value="processing">Processing</option>
      <option value="pending">Pending</option>
      <option value="delivered">Delivered</option>
      <option value="completed">Completed</option>
      <option value="cancelled">Cancelled</option>
      <option value="refunded">Refunded</option>
      <option value="expired">Expired</option>
    `;
  } else {
    select.innerHTML = `
      <option value="">All top-up statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    `;
  }

  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  }
}

async function loadTransactionsPage() {
  if (!document.getElementById("transactionTableBody")) return;

  await Promise.all([
    loadTransactionLookups(),
    loadTransactionSummary()
  ]);

  configureTransactionStatusFilter();
  await loadTransactionRows();
}

async function refreshTransactionsPage() {
  await Promise.all([
    loadTransactionLookups(),
    loadTransactionSummary()
  ]);

  await loadTransactionRows();
}

function switchTransactionTab(tab) {
  if (!["wallet", "purchases", "topups"].includes(tab)) return;

  transactionState.tab = tab;
  transactionState.page = 1;

  document.querySelectorAll(".transaction-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.txTab === tab);
  });

  document.getElementById("transactionSearch").value = "";
  document.getElementById("transactionStatusFilter").value = "";

  configureTransactionStatusFilter();
  loadTransactionRows();
}

function transactionFilterChanged() {
  transactionState.page = 1;
  loadTransactionRows();
}

function queueTransactionSearch() {
  clearTimeout(transactionState.searchTimer);

  transactionState.searchTimer = setTimeout(() => {
    transactionState.page = 1;
    loadTransactionRows();
  }, 300);
}

async function transactionMatchingUserIds(search) {
  if (!search) return [];

  const needle = search.toLowerCase();

  return transactionState.profiles
    .filter(profile => {
      const haystack = `${profile.username || ""} ${profile.business_name || ""} ${profile.reseller_code || ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .map(profile => profile.id);
}

async function transactionMatchingProductIds(search) {
  if (!search) return [];

  const needle = search.toLowerCase();

  return transactionState.products
    .filter(product => {
      const haystack = `${product.app_name || ""} ${product.account_type || ""} ${product.duration || ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .map(product => product.id);
}

function transactionApplyDate(query) {
  const start = transactionDateStart();
  return start ? query.gte("created_at", start) : query;
}

async function loadTransactionRows() {
  const body = document.getElementById("transactionTableBody");
  const mobile = document.getElementById("transactionMobileList");

  if (!body || !mobile) return;

  body.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="empty">
          <div class="empty-icon">📜</div>
          <div>Loading transactions...</div>
        </div>
      </td>
    </tr>
  `;

  mobile.innerHTML = `
    <div class="empty">
      <div class="empty-icon">📜</div>
      <div>Loading transactions...</div>
    </div>
  `;

  try {
    const search = (document.getElementById("transactionSearch")?.value || "").trim();
    const resellerId = document.getElementById("transactionResellerFilter")?.value || "";
    const status = document.getElementById("transactionStatusFilter")?.value || "";

    const from = (transactionState.page - 1) * TRANSACTION_PAGE_SIZE;
    const to = from + TRANSACTION_PAGE_SIZE - 1;

    let result;

    if (transactionState.tab === "wallet") {
      let query = supabaseClient
        .from("wallet_transactions")
        .select("id,user_id,amount,balance_after,type,description,created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (resellerId) query = query.eq("user_id", resellerId);
      if (status) query = query.eq("type", status);
      query = transactionApplyDate(query);

      if (search) {
        const matchingUsers = await transactionMatchingUserIds(search);
        const safeSearch = search.replaceAll(",", " ").replaceAll("(", " ").replaceAll(")", " ");

        const parts = [
          `description.ilike.%${safeSearch}%`,
          `type.ilike.%${safeSearch}%`
        ];

        if (matchingUsers.length) {
          parts.push(`user_id.in.(${matchingUsers.join(",")})`);
        }

        query = query.or(parts.join(","));
      }

      result = await query;

    } else if (transactionState.tab === "purchases") {
      let query = supabaseClient
        .from("orders")
        .select("id,user_id,product_id,status,created_at,activated_at,expires_at,delivery_url,delivery_text", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (resellerId) query = query.eq("user_id", resellerId);
      if (status) query = query.eq("status", status);
      query = transactionApplyDate(query);

      if (search) {
        const matchingUsers = await transactionMatchingUserIds(search);
        const matchingProducts = await transactionMatchingProductIds(search);
        const safeSearch = search.replaceAll(",", " ").replaceAll("(", " ").replaceAll(")", " ");

        const parts = [
          `status.ilike.%${safeSearch}%`
        ];

        if (matchingUsers.length) {
          parts.push(`user_id.in.(${matchingUsers.join(",")})`);
        }

        if (matchingProducts.length) {
          parts.push(`product_id.in.(${matchingProducts.join(",")})`);
        }

        query = query.or(parts.join(","));
      }

      result = await query;

    } else {
      let query = supabaseClient
        .from("topup_requests")
        .select("id,user_id,amount,currency,payment_method,payment_reference,note,status,reviewed_at,created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (resellerId) query = query.eq("user_id", resellerId);
      if (status) query = query.eq("status", status);
      query = transactionApplyDate(query);

      if (search) {
        const matchingUsers = await transactionMatchingUserIds(search);
        const safeSearch = search.replaceAll(",", " ").replaceAll("(", " ").replaceAll(")", " ");

        const parts = [
          `payment_reference.ilike.%${safeSearch}%`,
          `note.ilike.%${safeSearch}%`,
          `status.ilike.%${safeSearch}%`,
          `payment_method.ilike.%${safeSearch}%`
        ];

        if (matchingUsers.length) {
          parts.push(`user_id.in.(${matchingUsers.join(",")})`);
        }

        query = query.or(parts.join(","));
      }

      result = await query;
    }

    if (result.error) {
      throw result.error;
    }

    transactionState.rows = result.data || [];
    transactionState.total = result.count || 0;

    renderTransactionRows();
    renderTransactionPagination();

  } catch (error) {
    console.error("[SUBLY] Transaction center error:", error);

    const message = escapeHtml(error.message || "Could not load transactions.");

    body.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty">
            <div class="empty-icon">⚠️</div>
            <div>${message}</div>
          </div>
        </td>
      </tr>
    `;

    mobile.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div>${message}</div>
      </div>
    `;
  }
}

function renderTransactionRows() {
  const head = document.getElementById("transactionTableHead");
  const body = document.getElementById("transactionTableBody");
  const mobile = document.getElementById("transactionMobileList");

  if (!head || !body || !mobile) return;

  const rows = transactionState.rows;

  if (transactionState.tab === "wallet") {
    head.innerHTML = `
      <tr>
        <th>Date</th>
        <th>Reseller</th>
        <th>Type</th>
        <th>Description</th>
        <th>Amount</th>
        <th>Balance After</th>
        <th>ID</th>
      </tr>
    `;

    body.innerHTML = rows.length ? rows.map(item => `
      <tr>
        <td>${escapeHtml(formatDateTime(item.created_at))}</td>
        <td>
          <strong>${escapeHtml(transactionResellerName(item.user_id))}</strong>
          <small>${escapeHtml(transactionProfile(item.user_id)?.reseller_code || "")}</small>
        </td>
        <td><span class="transaction-badge">${escapeHtml(item.type || "transaction")}</span></td>
        <td class="transaction-description">${escapeHtml(item.description || "—")}</td>
        <td class="transaction-amount ${transactionAmountClass(item.amount)}">
          ${Number(item.amount || 0) > 0 ? "+" : ""}${money(item.amount)}
        </td>
        <td>${money(item.balance_after)}</td>
        <td><code>${escapeHtml(transactionShortId(item.id))}</code></td>
      </tr>
    `).join("") : transactionEmptyRow();

    mobile.innerHTML = rows.length ? rows.map(item => `
      <article class="transaction-card">
        <div class="transaction-card-top">
          <div>
            <strong>${escapeHtml(transactionResellerName(item.user_id))}</strong>
            <span>${escapeHtml(formatDateTime(item.created_at))}</span>
          </div>
          <span class="transaction-amount ${transactionAmountClass(item.amount)}">
            ${Number(item.amount || 0) > 0 ? "+" : ""}${money(item.amount)}
          </span>
        </div>
        <div class="transaction-card-grid">
          <div><span>Type</span><strong>${escapeHtml(item.type || "transaction")}</strong></div>
          <div><span>Balance After</span><strong>${money(item.balance_after)}</strong></div>
          <div class="wide"><span>Description</span><strong>${escapeHtml(item.description || "—")}</strong></div>
          <div><span>ID</span><strong>${escapeHtml(transactionShortId(item.id))}</strong></div>
        </div>
      </article>
    `).join("") : transactionEmptyMobile();

  } else if (transactionState.tab === "purchases") {
    head.innerHTML = `
      <tr>
        <th>Date</th>
        <th>Reseller</th>
        <th>Product</th>
        <th>Variant</th>
        <th>Status</th>
        <th>Activated</th>
        <th>Expires</th>
        <th>Order ID</th>
      </tr>
    `;

    body.innerHTML = rows.length ? rows.map(order => {
      const product = transactionProduct(order.product_id);
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(order.created_at))}</td>
          <td>
            <strong>${escapeHtml(transactionResellerName(order.user_id))}</strong>
            <small>${escapeHtml(transactionProfile(order.user_id)?.reseller_code || "")}</small>
          </td>
          <td><strong>${escapeHtml(product?.app_name || "Unknown product")}</strong></td>
          <td>${escapeHtml(product?.account_type || "Standard")}<small>${escapeHtml(product?.duration || "—")}</small></td>
          <td><span class="status-badge ${escapeHtml(order.status || "")}">${escapeHtml(order.status || "unknown")}</span></td>
          <td>${escapeHtml(formatDateTime(order.activated_at))}</td>
          <td>${escapeHtml(formatDateTime(order.expires_at))}</td>
          <td><code>${escapeHtml(transactionShortId(order.id))}</code></td>
        </tr>
      `;
    }).join("") : transactionEmptyRow();

    mobile.innerHTML = rows.length ? rows.map(order => {
      const product = transactionProduct(order.product_id);
      return `
        <article class="transaction-card">
          <div class="transaction-card-top">
            <div>
              <strong>${escapeHtml(product?.app_name || "Unknown product")}</strong>
              <span>${escapeHtml(formatDateTime(order.created_at))}</span>
            </div>
            <span class="status-badge ${escapeHtml(order.status || "")}">${escapeHtml(order.status || "unknown")}</span>
          </div>
          <div class="transaction-card-grid">
            <div class="wide"><span>Reseller</span><strong>${escapeHtml(transactionResellerName(order.user_id))}</strong></div>
            <div><span>Account</span><strong>${escapeHtml(product?.account_type || "Standard")}</strong></div>
            <div><span>Duration</span><strong>${escapeHtml(product?.duration || "—")}</strong></div>
            <div><span>Activated</span><strong>${escapeHtml(formatDateTime(order.activated_at))}</strong></div>
            <div><span>Expires</span><strong>${escapeHtml(formatDateTime(order.expires_at))}</strong></div>
            <div><span>Order ID</span><strong>${escapeHtml(transactionShortId(order.id))}</strong></div>
          </div>
        </article>
      `;
    }).join("") : transactionEmptyMobile();

  } else {
    head.innerHTML = `
      <tr>
        <th>Date</th>
        <th>Reseller</th>
        <th>Amount</th>
        <th>Method</th>
        <th>Payment ID</th>
        <th>Status</th>
        <th>Reviewed</th>
        <th>Request ID</th>
      </tr>
    `;

    body.innerHTML = rows.length ? rows.map(item => `
      <tr>
        <td>${escapeHtml(formatDateTime(item.created_at))}</td>
        <td>
          <strong>${escapeHtml(transactionResellerName(item.user_id))}</strong>
          <small>${escapeHtml(transactionProfile(item.user_id)?.reseller_code || "")}</small>
        </td>
        <td><strong>${money(item.amount)}</strong></td>
        <td>${escapeHtml(transactionPaymentMethodLabel(item.payment_method))}</td>
        <td><code>${escapeHtml(item.payment_reference || "—")}</code></td>
        <td><span class="status-badge ${escapeHtml(item.status || "")}">${escapeHtml(item.status || "unknown")}</span></td>
        <td>${escapeHtml(formatDateTime(item.reviewed_at))}</td>
        <td><code>${escapeHtml(transactionShortId(item.id))}</code></td>
      </tr>
    `).join("") : transactionEmptyRow();

    mobile.innerHTML = rows.length ? rows.map(item => `
      <article class="transaction-card">
        <div class="transaction-card-top">
          <div>
            <strong>${escapeHtml(transactionResellerName(item.user_id))}</strong>
            <span>${escapeHtml(formatDateTime(item.created_at))}</span>
          </div>
          <strong>${money(item.amount)}</strong>
        </div>
        <div class="transaction-card-grid">
          <div><span>Method</span><strong>${escapeHtml(transactionPaymentMethodLabel(item.payment_method))}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(item.status || "unknown")}</strong></div>
          <div><span>Payment ID</span><strong>${escapeHtml(item.payment_reference || "—")}</strong></div>
          <div><span>Reviewed</span><strong>${escapeHtml(formatDateTime(item.reviewed_at))}</strong></div>
          ${item.note ? `<div class="wide"><span>Note</span><strong>${escapeHtml(item.note)}</strong></div>` : ""}
          <div><span>Request ID</span><strong>${escapeHtml(transactionShortId(item.id))}</strong></div>
        </div>
      </article>
    `).join("") : transactionEmptyMobile();
  }
}

function transactionEmptyRow() {
  return `
    <tr>
      <td colspan="8">
        <div class="empty">
          <div class="empty-icon">📭</div>
          <div>No matching records.</div>
        </div>
      </td>
    </tr>
  `;
}

function transactionEmptyMobile() {
  return `
    <div class="empty">
      <div class="empty-icon">📭</div>
      <div>No matching records.</div>
    </div>
  `;
}

function renderTransactionPagination() {
  const totalPages = Math.max(1, Math.ceil(transactionState.total / TRANSACTION_PAGE_SIZE));
  const page = Math.min(transactionState.page, totalPages);

  transactionState.page = page;

  const first = transactionState.total === 0
    ? 0
    : ((page - 1) * TRANSACTION_PAGE_SIZE) + 1;

  const last = Math.min(page * TRANSACTION_PAGE_SIZE, transactionState.total);

  document.getElementById("transactionPageInfo").textContent =
    transactionState.total
      ? `Showing ${first}–${last} of ${transactionState.total}`
      : "0 records";

  document.getElementById("transactionPageNumber").textContent =
    `Page ${page} of ${totalPages}`;

  const prev = document.getElementById("transactionPrev");
  const next = document.getElementById("transactionNext");

  prev.disabled = page <= 1;
  next.disabled = page >= totalPages;
}

function changeTransactionPage(direction) {
  const totalPages = Math.max(1, Math.ceil(transactionState.total / TRANSACTION_PAGE_SIZE));
  const nextPage = transactionState.page + direction;

  if (nextPage < 1 || nextPage > totalPages) return;

  transactionState.page = nextPage;
  loadTransactionRows();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
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

