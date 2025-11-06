/* global document, console, fetch, Office */
import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "../launchevent/authconfig"; // { clientId, authority }
import { buildSignatureHtml } from "../common/signature"; // Twój generator HTML z signature.js

// ====== UI ======
const sideloadMsg = document.getElementById("sideload-msg");
const signInButton = document.getElementById("btnSignIn");
const itemSubject = document.getElementById("item-subject");
const signaturePreview = document.getElementById("signature-preview");
const chkOverrideClientSig = document.getElementById("chkOverrideClientSignature");

// ====== DEBUG helper ======
const LOG_PREFIX = "[TP]";
const d = (msg, obj) => {
  const ts = new Date().toISOString();
  if (obj !== undefined) console.log(`${LOG_PREFIX} ${ts} ${msg}`, obj);
  else console.log(`${LOG_PREFIX} ${ts} ${msg}`);
};

// ====== MSAL ======
let pca;
let isPCAInitialized = false;

const MSAL_CONFIG = {
  auth, // { clientId, authority }
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
};

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Outlook) return;

  if (sideloadMsg) sideloadMsg.style.display = "none";
  const appBody = document.getElementById("app-body");
  if (appBody) appBody.style.display = "flex";

  if (signInButton) signInButton.onclick = signInUser;

  try {
    pca = await createNestablePublicClientApplication(MSAL_CONFIG);
    const acc = pca.getAllAccounts()[0];
    if (acc) pca.setActiveAccount(acc);
    isPCAInitialized = true;
    d("PCA initialized.", { accounts: pca.getAllAccounts() });
  } catch (error) {
    d("Error creating PCA", error);
  }
});

// ====== Main: login -> fetch profile -> preview -> save -> (optional) insert once ======
async function signInUser() {
  if (!isPCAInitialized) {
    if (itemSubject) itemSubject.innerText = "PCA nie zostało zainicjalizowane. Sprawdź logi.";
    return;
  }

  const tokenRequest = { scopes: ["User.Read", "openid", "profile"] };
  let accessToken = null;

  // 1) Silent
  try {
    const acc = pca.getAllAccounts()[0];
    if (acc) {
      const silentRes = await pca.acquireTokenSilent({ ...tokenRequest, account: acc });
      accessToken = silentRes.accessToken;
      d("Got access token (silent).");
    }
  } catch (error) {
    d("Silent token failed", error);
  }

  // 2) Popup
  if (!accessToken) {
    try {
      const popupRes = await pca.acquireTokenPopup(tokenRequest);
      accessToken = popupRes.accessToken;
      d("Got access token (popup).");
    } catch (error) {
      d("Popup token failed", error);
    }
  }

  if (!accessToken) {
    if (itemSubject) itemSubject.innerText = "Nie udało się zalogować. Spróbuj ponownie.";
    return;
  }

  // 3) Graph /me
  const resp = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,department,officeLocation,displayName",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    d("Graph /me failed", { status: resp.status, txt });
    if (itemSubject) itemSubject.innerText = "Nie udało się pobrać danych z Microsoft Graph.";
    return;
  }
  const data = await resp.json();
  d("Graph /me fetched", data);

  // 4) Build profile & HTML (jeden szablon — Twój buildSignatureHtml)
  const profile = {
    firstName: data.givenName || "",
    lastName: data.surname || "",
    email: data.mail || data.userPrincipalName || "",
    phone: (Array.isArray(data.businessPhones) && data.businessPhones[0]) || data.mobilePhone || "",
    jobTitle: data.jobTitle || "",
    team: data.department || "",
    office: data.officeLocation || "",
    displayName: data.displayName || `${data.givenName || ""} ${data.surname || ""}`.trim(),
  };
  const html = buildSignatureHtml(profile);
  d("Built signature HTML", { len: html?.length || 0 });

  // 5) Preview (ostrzeżenie about:srcdoc w konsoli jest OK)
  if (signaturePreview) {
    try {
      signaturePreview.srcdoc = html;
      d("Preview updated.");
    } catch (e) {
      d("Preview failed", e);
    }
  }

  // 6) UI info
  if (itemSubject) {
    const name = profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    itemSubject.innerHTML = `Jesteś zalogowany jako <b>${name}</b>.<br> Stopka została zapisana w pamięci dodatku.`;
  }

  // 7) Save to roamingSettings (+ ewentualny bridge do sessionData, jeśli dostępne)
  const disableClientSig = !!(chkOverrideClientSig && chkOverrideClientSig.checked);
  await saveSignatureToStorage(profile, html, disableClientSig);

  // 8) Optional: wstaw do bieżącej wiadomości (jednorazowo po zalogowaniu)
  try {
    await insertSignatureFromTaskpane(html);
    d("Signature inserted from taskpane.");
  } catch (e) {
    d("Insert from taskpane failed", e);
  }
}

// ====== Storage save (roamingSettings + localStorage + sessionData flag) ======
async function saveSignatureToStorage(profile, html, disableClientSig) {
  try {
    d("Saving to roamingSettings...", { hasHtml: !!html, htmlLen: html?.length || 0, profile });

    // convenience (niekrytyczne)
    try {
      localStorage.setItem("user_info", JSON.stringify(profile));
    } catch (e) {
      d("localStorage set error (non-fatal)", e);
    }

    // kluczowe dla event-runtime
    Office.context.roamingSettings.set("user_info", JSON.stringify(profile));
    Office.context.roamingSettings.set("signature_html", html);
    Office.context.roamingSettings.set("override_olk_signature", disableClientSig ? "1" : "0");

    await new Promise((resolve) => {
      Office.context.roamingSettings.saveAsync(async (res) => {
        d("roamingSettings.saveAsync", { status: res?.status, error: res?.error });

        // potwierdzenie odczytem z roamingSettings
        try {
          const readBack = Office.context.roamingSettings.get("signature_html");
          d("roamingSettings read-back signature_html len", readBack?.length || 0);
        } catch (e) {
          d("roamingSettings read-back error", e);
        }

        // DIAG: dostępność sessionData (u Ciebie: false — i to jest OK)
        console.log("[TP] platform:", Office.context.platform);
        console.log("[TP] has sessionData:", !!Office.sessionData);
        console.log("[TP] has setAsync:", !!(Office.sessionData && Office.sessionData.setAsync));
        console.log("[TP] has getAsync:", !!(Office.sessionData && Office.sessionData.getAsync));

        // mostek sessionData (Classic/Windows) — tylko jeśli API istnieje
        try {
          if (Office.context.platform === Office.PlatformType.PC && Office.sessionData?.setAsync) {
            await new Promise((r) => Office.sessionData.setAsync("signature_html", html, () => r()));
            await new Promise((r) => Office.sessionData.setAsync("isAuthenticated", "1", () => r()));
            console.log("[TP] sessionData set: signature_html + isAuthenticated=1");

            const back = await new Promise((r) => Office.sessionData.getAsync("signature_html", (x) => r(x?.value)));
            console.log("[TP] sessionData read-back len:", back ? back.length : 0);
          }
        } catch (e) {
          console.log("[TP] sessionData set/get error:", e);
        }

        // lekkie potwierdzenie w UI
        // zamiast wcześniejszego notificationMessages.replaceAsync(... informationalMessage ...)
        try {
          Office.context.mailbox.item?.notificationMessages?.replaceAsync(
            "sig_saved",
            {
              type: "insightMessage",
              message: "Podpis zapisany w pamięci dodatku.",
              icon: "Icon.16x16", // ID z manifestu
              actions: [], // brak przycisków – tylko info z ikoną
            },
            () => {}
          );
        } catch {
          /* no-op */
        }

        resolve();
      });
    });

    // opcjonalnie: wyłącz natywną stopkę klienta na bieżącym elemencie
    try {
      if (disableClientSig && Office.context.mailbox.item?.disableClientSignatureAsync) {
        Office.context.mailbox.item.disableClientSignatureAsync(() => {});
        d("Client signature disabled on current item.");
      }
    } catch (e) {
      d("disableClientSignatureAsync error (non-fatal)", e);
    }
  } catch (e) {
    d("Error saving signature to storage", e);
  }
}

// ====== Insert signature into current compose (taskpane action) ======
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function ensureBodyReady(maxTries = 10, delayMs = 150) {
  for (let i = 0; i < maxTries; i++) {
    if (Office?.context?.mailbox?.item?.body) return;
    await wait(delayMs);
  }
  throw new Error("Body nie jest gotowe do edycji.");
}

async function insertSignatureFromTaskpane(html) {
  await ensureBodyReady();
  const item = Office.context.mailbox.item;

  const isMessage = item.itemType === Office.MailboxEnums.ItemType.Message;
  const canUseSetSignature =
    typeof Office?.context?.requirements?.isSetSupported === "function" &&
    Office.context.requirements.isSetSupported("Mailbox", "1.10") &&
    item.body?.setSignatureAsync;

  d("insertSignatureFromTaskpane method", { isMessage, canUseSetSignature });

  if (isMessage && canUseSetSignature) {
    await new Promise((resolve, reject) => {
      item.body.setSignatureAsync(html, { coercionType: Office.CoercionType.Html }, (res) =>
        res.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(res.error)
      );
    });
    return;
  }

  await new Promise((resolve, reject) => {
    item.body.setAsync("<br/><br/>" + html, { coercionType: Office.CoercionType.Html }, (res) =>
      res.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(res.error)
    );
  });
}
