/* global console, fetch, Office */

import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "./authconfig";
import { buildSignatureHtml } from "../common/signature";

let pca;
let isPCAInitialized = false;

// ===== Init MSAL (NAA-friendly) =====
async function initializePCA() {
  if (isPCAInitialized) return;

  try {
    pca = await createNestablePublicClientApplication({
      auth, // { clientId, authority }
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
    });
    const acc = pca.getAllAccounts()[0];
    if (acc) pca.setActiveAccount(acc);
    isPCAInitialized = true;
  } catch (error) {
    console.log(`Error creating PCA: ${error}`);
  }
}

// ===== Helpers: notifications / platform =====
function notifyUserToSignIn() {
  Office.context.mailbox.item.notificationMessages.addAsync("sign_in_needed", {
    type: "insightMessage",
    message: "Zaloguj się w dodatku, aby automatycznie wstawić stopkę.",
    icon: "Icon.16x16",
    actions: [{ actionType: "showTaskPane", actionText: "Zaloguj się", commandId: getCommandId(), contextData: "{}" }],
  });
}

function getCommandId() {
  return Office.context.mailbox.item.itemType === Office.MailboxEnums.ItemType.Appointment
    ? "MRCS_TpBtn1"
    : "MRCS_TpBtn0";
}

function info(message, persistent = false, key = "eventInfo") {
  try {
    Office.context.mailbox.item.notificationMessages.replaceAsync(
      key,
      {
        type: "informationalMessage",
        message,
        icon: "Icon.16x16",
        persistent,
      },
      () => {}
    );
  } catch {}
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

// ===== Graph profile =====
async function getProfileFromGraph() {
  await initializePCA();

  const scopes = ["User.Read", "openid", "profile"];
  let account = pca.getAllAccounts()[0];

  if (!account) {
    // Spróbuj „obudzić” brokera bez promptu (czasem pomaga w Desktop)
    try {
      if (Office.auth?.getAccessToken) {
        await Office.auth.getAccessToken({ allowSignInPrompt: false, forMSGraphAccess: true });
      } else if (OfficeRuntime?.auth?.getAccessToken) {
        await OfficeRuntime.auth.getAccessToken({ allowSignInPrompt: false });
      }
      account = pca.getAllAccounts()[0];
    } catch {
      // brak cichego SSO – przejdziemy do fallbacku
    }
  }

  if (!account) {
    throw new Error("No MSAL account available for silent auth.");
  }

  const result = await pca.acquireTokenSilent({ scopes, account });
  const accessToken = result.accessToken;

  const resp = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,department,officeLocation,displayName",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Graph error ${resp.status}: ${text || resp.statusText}`);
  }
  const data = await resp.json();

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

// ===== Wstawienie stopki =====
function setSignatureHtmlIntoItem(html, event) {
  const item = Office.context.mailbox.item;
  const isMessage = item.itemType === Office.MailboxEnums.ItemType.Message;

  const canUseSetSignature =
    typeof Office?.context?.requirements?.isSetSupported === "function" &&
    Office.context.requirements.isSetSupported("Mailbox", "1.10") &&
    item.body?.setSignatureAsync;

  if (isMessage && canUseSetSignature) {
    item.body.setSignatureAsync(html, { coercionType: Office.CoercionType.Html, asyncContext: event }, (res) => {
      if (res.status === Office.AsyncResultStatus.Succeeded) {
        console.log("Signature inserted with setSignatureAsync.");
      } else {
        console.warn("setSignatureAsync failed, fallback to body.setAsync.", res.error);
        item.body.setAsync("<br/><br/>" + html, { coercionType: Office.CoercionType.Html }, () => {});
      }
      event.completed();
    });
  } else {
    item.body.setAsync("<br/><br/>" + html, { coercionType: Office.CoercionType.Html, asyncContext: event }, () =>
      event.completed()
    );
  }
}

// ===== Główna procedura eventu =====
// Fallback: jeden klucz z gotowym HTML zapisanym w taskpane
function getRoamingSignatureHtml() {
  return Office.context.roamingSettings.get("signature_html") || null;
}

// Fallback 2: dane użytkownika zapisane w taskpane (jeśli chcesz złożyć HTML lokalnie)

async function setSignature(event) {
  try {
    // 1) Idealnie: SSO (silent) + Graph + świeży HTML
    try {
      const profile = await getProfileFromGraph(); // Twoja funkcja silent+Graph
      const signatureHtml = buildSignatureHtml(profile); // generator z signature.js
      setSignatureHtmlIntoItem(signatureHtml, event); // wstaw do elementu
      return;
    } catch (silentErr) {
      console.log("Silent/Graph path not available:", silentErr?.message || silentErr);
      // przechodzimy do fallbacku bez SSO
    }

    // 2) Fallback: gotowy HTML z pamięci dodatku (zapisany wcześniej w taskpane)
    let html = getRoamingSignatureHtml();

    // 2a) Gdyby nie było gotowego HTML, spróbuj złożyć z user_info (też zapisane przez taskpane)
    if (!html) {
      const userInfo = getRoamingUserInfo();
      if (userInfo) {
        html = buildSignatureHtml(userInfo);
      }
    }

    if (html) {
      setSignatureHtmlIntoItem(html, event);
      return;
    }

    // 3) Brak jakichkolwiek danych → pokaż prośbę o konfigurację/logowanie w panelu
    notifyUserToSignIn();
    event.completed();
  } catch (e) {
    console.error("Event handler failed:", e);
    // Nie blokuj tworzenia wiadomości
    notifyUserToSignIn();
    event.completed();
  }
}

// ===== Hooki eventów z manifestu =====
function onNewMessageComposeHandler(event) {
  setSignature(event);
}
function onNewAppointmentComposeHandler(event) {
  setSignature(event);
}

Office.onReady(() => {});
Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
Office.actions.associate("onNewAppointmentComposeHandler", onNewAppointmentComposeHandler);
