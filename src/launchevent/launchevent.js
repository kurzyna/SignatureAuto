/* global console, fetch, Office */
import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "./authconfig"; // { clientId, authority }
import { buildSignatureHtml } from "../common/signature"; // Twój generator HTML

let pca;
let isPCAInitialized = false;

// ====== DEBUG helper ======
const LOG_PREFIX = "[EVT]";
const d = (msg, obj) => {
  const ts = new Date().toISOString();
  if (obj !== undefined) console.log(`${LOG_PREFIX} ${ts} ${msg}`, obj);
  else console.log(`${LOG_PREFIX} ${ts} ${msg}`);
};

// Mały baner w UI (łatwiej diagnozować w Classic)
function showPath(tag, extra = "") {
  try {
    Office.context.mailbox.item.notificationMessages.replaceAsync(
      "sig_path",
      {
        type: "informationalMessage",
        message: `evt: ${tag}${extra ? ` (${extra})` : ""}`,
        icon: "Icon.16x16",
        persistent: false,
      },
      () => {}
    );
  } catch {}
}

// ====== Init MSAL (NAA-friendly) ======
async function initializePCA() {
  if (isPCAInitialized) return;
  try {
    pca = await createNestablePublicClientApplication({
      auth,
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
    });
    const acc = pca.getAllAccounts()[0];
    if (acc) pca.setActiveAccount(acc);
    isPCAInitialized = true;
    d("PCA initialized.", { accounts: pca.getAllAccounts() });
  } catch (error) {
    d("Error creating PCA", error);
  }
}

// ====== Czekamy aż edytor jest gotowy (ważne dla Classic) ======
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureComposeReady(maxTries = 30, delayMs = 200) {
  const item = Office?.context?.mailbox?.item;
  for (let i = 0; i < maxTries; i++) {
    if (item?.body?.getTypeAsync) {
      try {
        await new Promise((resolve) => item.body.getTypeAsync(() => resolve()));
        d("Compose editor ready.");
        return;
      } catch {}
    }
    await wait(delayMs);
  }
  throw new Error("Compose body is not ready.");
}

// ====== UI helpers ======
function getCommandId() {
  return Office.context.mailbox.item.itemType === Office.MailboxEnums.ItemType.Appointment
    ? "MRCS_TpBtn1"
    : "MRCS_TpBtn0";
}
function notifyUserToSignIn() {
  Office.context.mailbox.item.notificationMessages.addAsync("sign_in_needed", {
    type: "insightMessage",
    message: "Zaloguj się w dodatku, aby automatycznie wstawić stopkę.",
    icon: "Icon.16x16",
    actions: [{ actionType: "showTaskPane", actionText: "Zaloguj się", commandId: getCommandId(), contextData: "{}" }],
  });
}

// ====== Odczyty z cache ======
async function getSignatureHtmlPreferSession() {
  // sessionData u Ciebie nieobecne – zostawiamy na przyszłość
  if (Office.context.platform === Office.PlatformType.PC && Office.sessionData?.getAsync) {
    const sessionHtml = await new Promise((resolve) =>
      Office.sessionData.getAsync("signature_html", (r) => resolve(r?.value || null))
    );
    d("sessionData signature_html", { found: !!sessionHtml, len: sessionHtml?.length || 0 });
    if (sessionHtml) return sessionHtml;
  }
  const rsHtml = Office.context.roamingSettings.get("signature_html") || null;
  d("roamingSettings signature_html", { found: !!rsHtml, len: rsHtml?.length || 0 });
  return rsHtml;
}
function getRoamingUserInfo() {
  const raw = Office.context.roamingSettings.get("user_info");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ====== Graph profile (silent) ======
async function getProfileFromGraph() {
  await initializePCA();

  const scopes = ["User.Read", "openid", "profile"];
  let account = pca.getAllAccounts()[0];
  d("getProfileFromGraph: accounts before", { count: pca.getAllAccounts().length });

  if (!account) {
    // spróbuj „obudzić” brokera bez promptu (czasem pomaga)
    try {
      if (Office.auth?.getAccessToken) {
        await Office.auth.getAccessToken({ allowSignInPrompt: false, forMSGraphAccess: true });
      } else if (OfficeRuntime?.auth?.getAccessToken) {
        await OfficeRuntime.auth.getAccessToken({ allowSignInPrompt: false });
      }
      account = pca.getAllAccounts()[0];
      d("getProfileFromGraph: accounts after bootstrap", { count: pca.getAllAccounts().length });
    } catch (e) {
      d("Bootstrap getAccessToken failed (no prompt)", e);
    }
  }

  if (!account) throw new Error("No MSAL account available for silent auth.");

  const result = await pca.acquireTokenSilent({ scopes, account });
  d("acquireTokenSilent OK");

  const accessToken = result.accessToken;
  const resp = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,department,officeLocation,displayName",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Graph error ${resp.status}: ${txt || resp.statusText}`);
  }
  const data = await resp.json();
  d("Graph /me OK");

  return {
    firstName: data.givenName || "",
    lastName: data.surname || "",
    email: data.mail || data.userPrincipalName || "",
    phone: (Array.isArray(data.businessPhones) && data.businessPhones[0]) || data.mobilePhone || "",
    jobTitle: data.jobTitle || "",
    team: data.department || "",
    office: data.officeLocation || "",
    displayName: data.displayName || `${data.givenName || ""} ${data.surname || ""}`.trim(),
  };
}

// ====== Wstawienie HTML (z retry) ======
async function insertHtmlSignatureWithRetry(html, event) {
  await ensureComposeReady(); // ważne dla Classic

  const item = Office.context.mailbox.item;
  const isMessage = item.itemType === Office.MailboxEnums.ItemType.Message;
  const canUseSetSignature =
    typeof Office?.context?.requirements?.isSetSupported === "function" &&
    Office.context.requirements.isSetSupported("Mailbox", "1.10") &&
    item.body?.setSignatureAsync;

  d("insertHtmlSignatureWithRetry: method", { isMessage, canUseSetSignature });

  const insertViaSignatureApi = () =>
    new Promise((resolve, reject) => {
      item.body.setSignatureAsync(html, { coercionType: Office.CoercionType.Html, asyncContext: event }, (res) =>
        res.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(res.error)
      );
    });

  const insertViaBodySet = () =>
    new Promise((resolve, reject) => {
      item.body.setAsync("<br/><br/>" + html, { coercionType: Office.CoercionType.Html }, (res) =>
        res.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(res.error)
      );
    });

  try {
    if (isMessage && canUseSetSignature) {
      await insertViaSignatureApi();
      d("setSignatureAsync succeeded");
    } else {
      await insertViaBodySet();
      d("body.setAsync succeeded");
    }
  } catch (e1) {
    d("1st insert attempt failed, retrying…", e1);
    await wait(300);
    try {
      if (isMessage && canUseSetSignature) {
        await insertViaSignatureApi();
        d("setSignatureAsync succeeded (retry)");
      } else {
        await insertViaBodySet();
        d("body.setAsync succeeded (retry)");
      }
    } catch (e2) {
      d("2nd insert attempt failed", e2);
    }
  }

  event.completed();
}

// ====== Główny handler: CACHE → GRAPH → USER_INFO ======
async function setSignature(event) {
  try {
    showPath("evt-start");
    d("Event start", {
      platform: Office.context.platform,
      itemType: Office.context.mailbox.item?.itemType,
    });

    // 1) CACHE FIRST — na Classic daje natychmiastowy efekt
    let cachedHtml = await getSignatureHtmlPreferSession();
    if (cachedHtml) {
      showPath("cached-html", `len=${cachedHtml.length}`);
      await insertHtmlSignatureWithRetry(cachedHtml, event);
      return;
    }

    // 2) Silent Graph → świeży HTML
    try {
      d("Trying silent Graph path…");
      const profile = await getProfileFromGraph();
      d("Silent Graph OK. Profile", profile);

      const freshHtml = buildSignatureHtml(profile);
      d("Built signatureHtml from Graph", { len: freshHtml?.length || 0 });

      showPath("silent-graph", `len=${freshHtml?.length || 0}`);
      await insertHtmlSignatureWithRetry(freshHtml, event);
      return;
    } catch (silentErr) {
      d("Silent/Graph path failed", { msg: silentErr?.message, err: silentErr });
      // przechodzimy do user_info
    }

    // 3) Ostateczny fallback — z user_info (też zapisuje taskpane)
    const userInfo = getRoamingUserInfo();
    d("Read user_info", { found: !!userInfo });
    if (userInfo) {
      const built = buildSignatureHtml(userInfo);
      d("Built signatureHtml from user_info", { len: built?.length || 0 });
      if (built) {
        showPath("built-from-user-info", `len=${built.length}`);
        await insertHtmlSignatureWithRetry(built, event);
        return;
      }
    }

    // 4) Brak danych → poproś o logowanie
    d("No HTML and no user_info. Asking user to sign in.");
    showPath("no-data");
    notifyUserToSignIn();
    event.completed();
  } catch (e) {
    d("Event handler failed (outer catch)", e);
    notifyUserToSignIn();
    event.completed();
  }
}

// ====== Event hooks (muszą pasować do manifestu) ======
function onNewMessageComposeHandler(event) {
  setSignature(event);
}
function onNewAppointmentComposeHandler(event) {
  setSignature(event);
}

Office.onReady(() => {});
Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
Office.actions.associate("onNewAppointmentComposeHandler", onNewAppointmentComposeHandler);
