/* global console, fetch, Office */
import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "./authconfig"; // { clientId, authority }
import { buildSignatureHtml } from "../common/signature";

let pca;
let isPCAInitialized = false;

// ====== DEBUG helper ======
const LOG_PREFIX = "[EVT]";
const d = (msg, obj) => {
  const ts = new Date().toISOString();
  if (obj !== undefined) console.log(`${LOG_PREFIX} ${ts} ${msg}`, obj);
  else console.log(`${LOG_PREFIX} ${ts} ${msg}`);
};
function showPath(tag) {
  try {
    Office.context.mailbox.item.notificationMessages.replaceAsync(
      "sig_path",
      {
        type: "informationalMessage",
        message: `Signature path: ${tag}`,
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

// ====== Roaming storage helpers ======
function getRoamingSignatureHtml() {
  return Office.context.roamingSettings.get("signature_html") || null;
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

// ====== Graph profile (silent only) ======
async function getProfileFromGraph() {
  await initializePCA();

  const scopes = ["User.Read", "openid", "profile"];
  let account = pca.getAllAccounts()[0];
  d("getProfileFromGraph: accounts before", { count: pca.getAllAccounts().length });

  if (!account) {
    // try to bootstrap broker without prompt
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

  if (!account) {
    throw new Error("No MSAL account available for silent auth.");
  }

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

// ====== Insert signature into item ======
function setSignatureHtmlIntoItem(html, event) {
  const item = Office.context.mailbox.item;
  const isMessage = item.itemType === Office.MailboxEnums.ItemType.Message;

  const canUseSetSignature =
    typeof Office?.context?.requirements?.isSetSupported === "function" &&
    Office.context.requirements.isSetSupported("Mailbox", "1.10") &&
    item.body?.setSignatureAsync;

  d("setSignatureHtmlIntoItem: method", { isMessage, canUseSetSignature });

  if (isMessage && canUseSetSignature) {
    item.body.setSignatureAsync(html, { coercionType: Office.CoercionType.Html, asyncContext: event }, (res) => {
      if (res.status === Office.AsyncResultStatus.Succeeded) {
        d("setSignatureAsync succeeded");
        event.completed();
      } else {
        d("setSignatureAsync failed -> fallback to setAsync", res.error);
        item.body.setAsync("<br/><br/>" + html, { coercionType: Office.CoercionType.Html }, () => event.completed());
      }
    });
  } else {
    item.body.setAsync("<br/><br/>" + html, { coercionType: Office.CoercionType.Html }, () => event.completed());
  }
}

// ====== Main event handler ======
async function setSignature(event) {
  try {
    d("Event start", {
      platform: Office.context.platform,
      itemType: Office.context.mailbox.item?.itemType,
    });

    // 1) Preferred path: silent + Graph
    try {
      d("Trying silent Graph path...");
      const profile = await getProfileFromGraph();
      d("Silent Graph OK. Profile", profile);

      const signatureHtml = buildSignatureHtml(profile);
      d("Built signatureHtml from Graph", { len: signatureHtml?.length || 0 });

      showPath("silent-graph");
      setSignatureHtmlIntoItem(signatureHtml, event);
      return;
    } catch (silentErr) {
      d("Silent/Graph path failed", { msg: silentErr?.message, err: silentErr });
      // go to fallback
    }

    // 2) Fallback: pre-saved HTML from roamingSettings
    let html = getRoamingSignatureHtml();
    d("Read signature_html from roamingSettings", { found: !!html, len: html?.length || 0 });

    // 2a) If missing, try to build from user_info
    if (!html) {
      const userInfo = getRoamingUserInfo();
      d("Read user_info", { found: !!userInfo });
      if (userInfo) {
        html = buildSignatureHtml(userInfo);
        d("Built signatureHtml from user_info", { len: html?.length || 0 });
      }
    }

    if (html) {
      showPath("roaming-html");
      setSignatureHtmlIntoItem(html, event);
      return;
    }

    // 3) No data
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

// ====== Event hooks (must match manifest LaunchEvent) ======
function onNewMessageComposeHandler(event) {
  setSignature(event);
}
function onNewAppointmentComposeHandler(event) {
  setSignature(event);
}

Office.onReady(() => {});
Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
Office.actions.associate("onNewAppointmentComposeHandler", onNewAppointmentComposeHandler);
