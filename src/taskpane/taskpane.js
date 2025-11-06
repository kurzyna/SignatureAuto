/* global document, console, fetch, Office */
import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "../launchevent/authconfig";
import { buildSignatureHtml } from "../common/signature"; // generator HTML stopki

// Elementy UI
const sideloadMsg = document.getElementById("sideload-msg");
const signInButton = document.getElementById("btnSignIn");
const itemSubject = document.getElementById("item-subject");
const signaturePreview = document.getElementById("signature-preview");

// (opcjonalnie) checkbox w UI, jeśli chcesz wyłączać natywną stopkę Outlooka
const chkOverrideClientSig = document.getElementById("chkOverrideClientSignature");

let pca;
let isPCAInitialized = false;

const MSAL_CONFIG = {
  auth, // importujesz { clientId, authority } z authconfig
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

Office.onReady(async (info) => {
  if (info.host === Office.HostType.Outlook) {
    if (sideloadMsg) sideloadMsg.style.display = "none";
    const appBody = document.getElementById("app-body");
    if (appBody) appBody.style.display = "flex";

    if (signInButton) signInButton.onclick = signInUser;

    try {
      pca = await createNestablePublicClientApplication(MSAL_CONFIG);
      // Ustaw activeAccount, jeżeli coś już jest w cache
      const acc = pca.getAllAccounts()[0];
      if (acc) pca.setActiveAccount(acc);
      isPCAInitialized = true;
    } catch (error) {
      console.log(`Błąd podczas tworzenia instancji PCA: ${error}`);
    }
  }
});

/**
 * Główna ścieżka: logowanie → Graph → profil → podgląd → zapis do pamięci → (opcjonalnie) jednorazowe wstawienie stopki.
 */
async function signInUser() {
  if (!isPCAInitialized) {
    if (itemSubject) {
      itemSubject.innerText =
        "Nie można się zalogować, ponieważ aplikacja uwierzytelniająca (PCA) nie została poprawnie zainicjalizowana. Sprawdź logi konsoli.";
    }
    return;
  }

  const tokenRequest = { scopes: ["User.Read", "openid", "profile"] };
  let accessToken = null;

  // 1) Silent (jeśli konto jest już w cache)
  try {
    const acc = pca.getAllAccounts()[0];
    if (acc) {
      const silentRes = await pca.acquireTokenSilent({ ...tokenRequest, account: acc });
      accessToken = silentRes.accessToken;
      console.log("Token został pobrany w trybie cichym.");
    }
  } catch (error) {
    console.log(`Nie udało się pobrać tokenu w trybie cichym: ${error}`);
  }

  // 2) Popup (interaktywne logowanie w taskpane)
  if (!accessToken) {
    try {
      const authResult = await pca.acquireTokenPopup(tokenRequest);
      accessToken = authResult.accessToken;
      console.log("Token został pobrany po interaktywnym logowaniu.");
    } catch (popupError) {
      console.log(`Nie udało się pobrać tokenu po interaktywnym logowaniu: ${popupError}`);
    }
  }

  if (!accessToken) {
    console.error("Nie udało się uzyskać tokenu dostępu.");
    if (itemSubject) itemSubject.innerText = "Nie udało się zalogować. Spróbuj ponownie.";
    return;
  }

  // 3) Pobierz profil z Graph
  const resp = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,department,officeLocation",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    console.log("Wywołanie Microsoft Graph zakończone błędem: " + errorText);
    if (itemSubject) itemSubject.innerText = "Nie udało się pobrać danych użytkownika z Microsoft Graph.";
    return;
  }

  const data = await resp.json();

  // 4) Zbuduj obiekt profilu dla generatora HTML
  const profile = {
    firstName: data.givenName || "",
    lastName: data.surname || "",
    email: data.mail || data.userPrincipalName || "",
    phone: (Array.isArray(data.businessPhones) && data.businessPhones[0]) || data.mobilePhone || "",
    jobTitle: data.jobTitle || "",
    team: data.department || "",
    office: data.officeLocation || "",
  };

  // 5) Budowa HTML (jeśli masz różne szablony dla reply/forward – podmień generatory odpowiednio)
  const html = buildSignatureHtml(profile);

  // 6) Podgląd w taskpane
  if (signaturePreview) {
    try {
      signaturePreview.srcdoc = html;
      console.log("Podgląd stopki został wygenerowany.");
    } catch (e) {
      console.log("Nie udało się wyrenderować podglądu stopki:", e);
    }
  }

  // 7) Komunikat o zalogowanym użytkowniku
  if (itemSubject) {
    const name = [data.givenName, data.surname].filter(Boolean).join(" ") || data.displayName || "";
    itemSubject.innerHTML = `Jesteś zalogowany jako <b>${name}</b>.`;
  }

  // 8) Zapisz dane i gotowe HTML-e do pamięci (roamingSettings + localStorage) → Fallback dla event-runtime
  const disableClientSig = !!(chkOverrideClientSig && chkOverrideClientSig.checked);
  await saveSignatureToStorage(profile, { html }, disableClientSig);

  // 9) Jednorazowo dodaj stopkę do aktualnie otwartej wiadomości (opcjonalnie)
  try {
    await insertSignatureFromTaskpane(profile, html);
    console.log("Stopka została dodana po zalogowaniu (taskpane).");
  } catch (e) {
    console.error("Błąd podczas dodawania stopki po zalogowaniu:", e);
  }
}

/* ===================== PAMIĘĆ / STORAGE ===================== */

async function saveSignatureToStorage(profile, htmlSet, disableClientSig) {
  try {
    // localStorage – dla Twojej wygody/podglądu (nie jest używane w evencie)
    localStorage.setItem("user_info", JSON.stringify(profile));

    // roamingSettings – kluczowe: to czyta event-runtime (Desktop/OWA/Mac)
    Office.context.roamingSettings.set("user_info", JSON.stringify(profile));
    // GOTOWE HTML-e – event weźmie je, gdy nie ma tokenu albo nie wolno robić interakcji
    Office.context.roamingSettings.set("signature_html", htmlSet.htmlNew);

    // Wyłącz natywną stopkę klienta, jeśli chcesz (Desktop)
    Office.context.roamingSettings.set("override_olk_signature", disableClientSig ? "1" : "0");

    await new Promise((resolve) => {
      Office.context.roamingSettings.saveAsync(() => resolve());
    });

    // Mostek dla Desktop – zasygnalizuj event-runtime, że user jest „zalogowany/ustawiony”
    if (Office.context.platform === Office.PlatformType.PC && Office.sessionData?.setAsync) {
      await new Promise((resolve) => {
        Office.sessionData.setAsync("isAuthenticated", "1", () => resolve());
      });
    }

    // Jeśli checkbox zaznaczony, spróbuj wyłączyć natywną stopkę dla bieżącego elementu
    if (disableClientSig && Office.context.mailbox.item?.disableClientSignatureAsync) {
      Office.context.mailbox.item.disableClientSignatureAsync(() => {});
    }
  } catch (e) {
    console.warn("Nie udało się zapisać danych do pamięci dodatku:", e);
  }
}

/* ===================== WSTAWIENIE STOPKI (taskpane) ===================== */

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

/** Dodaj stopkę z panelu taskpane do aktualnie otwartego elementu */
async function insertSignatureFromTaskpane(profile, htmlNew) {
  await ensureBodyReady();
  const item = Office.context.mailbox.item;
  const sigHtml = htmlNew || buildSignatureHtml(profile);

  const isMessage = item.itemType === Office.MailboxEnums.ItemType.Message;
  const canUseSetSignature =
    typeof Office?.context?.requirements?.isSetSupported === "function" &&
    Office.context.requirements.isSetSupported("Mailbox", "1.10");

  // Preferuj wstawienie jako „Signature” (podmienia dedykowaną sekcję podpisu)
  if (isMessage && canUseSetSignature && item.body && item.body.setSignatureAsync) {
    await new Promise((resolve, reject) => {
      item.body.setSignatureAsync(sigHtml, { coercionType: Office.CoercionType.Html }, (res) =>
        res.status === Office.AsyncResultStatus.Succeeded
          ? resolve()
          : reject(res.error || new Error("setSignatureAsync failed"))
      );
    });
    return;
  }

  // Fallback: wstaw HTML do treści (np. spotkania / starsze scenariusze)
  await new Promise((resolve, reject) => {
    item.body.setAsync("<br/><br/>" + sigHtml, { coercionType: Office.CoercionType.Html }, (res) =>
      res.status === Office.AsyncResultStatus.Succeeded
        ? resolve()
        : reject(res.error || new Error("body.setAsync failed"))
    );
  });
}
