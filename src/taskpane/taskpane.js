/* global document, console, fetch, Office */
import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "../launchevent/authconfig";
import { buildSignatureHtml } from "../common/signature"; // generator HTML stopki

// Elementy UI
const sideloadMsg = document.getElementById("sideload-msg");
const signInButton = document.getElementById("btnSignIn");
const itemSubject = document.getElementById("item-subject");
const signaturePreview = document.getElementById("signature-preview");

let pca = undefined;
let isPCAInitialized = false;

// Inicjalizacja po starcie dodatku
Office.onReady(async (info) => {
  if (info.host === Office.HostType.Outlook) {
    if (sideloadMsg) sideloadMsg.style.display = "none";
    const appBody = document.getElementById("app-body");
    if (appBody) appBody.style.display = "flex";

    if (signInButton) signInButton.onclick = signInUser;

    try {
      pca = await createNestablePublicClientApplication({ auth });
      isPCAInitialized = true;
    } catch (error) {
      console.log(`Błąd podczas tworzenia instancji PCA: ${error}`);
    }
  }
});

/**
 * Logowanie SSO, pobranie profilu z Graph, podgląd w iframe
 * oraz jednorazowe dodanie stopki do aktualnej wiadomości.
 */
async function signInUser() {
  if (!isPCAInitialized) {
    if (itemSubject) {
      itemSubject.innerText =
        "Nie można się zalogować, ponieważ aplikacja uwierzytelniająca (PCA) nie została poprawnie zainicjalizowana. Sprawdź logi konsoli.";
    }
    return;
  }

  const tokenRequest = { scopes: ["User.Read"] };
  let accessToken = null;

  // 1) Silent
  try {
    const authResult = await pca.acquireTokenSilent(tokenRequest);
    const account = pca.getAllAccounts()[0];
    if (account) {
      localStorage.setItem("msalAccountId", account.homeAccountId);
    }
    accessToken = authResult.accessToken;
    console.log("Token został pobrany w trybie cichym.");
  } catch (error) {
    console.log(`Nie udało się pobrać tokenu w trybie cichym: ${error}`);
  }

  // 2) Popup
  if (!accessToken) {
    try {
      const authResult = await pca.acquireTokenPopup(tokenRequest);
      const account = pca.getAllAccounts()[0];
      if (account) {
        localStorage.setItem("msalAccountId", account.homeAccountId);
      }

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

  // 3) Graph: pobierz potrzebne pola do stopki
  const resp = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,department,officeLocation",
    { headers: { Authorization: accessToken } } // nie zmieniamy schematu zgodnie z Twoją prośbą
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    console.log("Wywołanie Microsoft Graph zakończone błędem: " + errorText);
    if (itemSubject) itemSubject.innerText = "Nie udało się pobrać danych użytkownika z Microsoft Graph.";
    return;
  }

  const data = await resp.json();

  // 4) Zbuduj profil pod generator HTML
  const profile = {
    firstName: data.givenName || "",
    lastName: data.surname || "",
    email: data.mail || data.userPrincipalName || "",
    phone: (Array.isArray(data.businessPhones) && data.businessPhones[0]) || data.mobilePhone || "",
    jobTitle: data.jobTitle || "",
    team: data.department || "",
    office: data.officeLocation || "",
  };

  // 5) Podgląd w iframe w taskpane
  if (signaturePreview) {
    try {
      signaturePreview.srcdoc = buildSignatureHtml(profile);
      console.log("Podgląd stopki został wygenerowany.");
    } catch (e) {
      console.log("Nie udało się wyrenderować podglądu stopki:", e);
    }
  }

  // 6) Komunikat o zalogowanym użytkowniku
  if (itemSubject) {
    const name = [data.givenName, data.surname].filter(Boolean).join(" ") || data.displayName || "";
    itemSubject.innerHTML = `Jesteś zalogowany jako <b>${name}</b>.`;
  }

  // 7) **Jednorazowo** dodaj stopkę do aktualnie otwartej wiadomości (jak w launchevent)
  try {
    await insertSignatureFromTaskpane(profile);
    console.log("Stopka została dodana po zalogowaniu (taskpane).");
  } catch (e) {
    console.error("Błąd podczas dodawania stopki po zalogowaniu:", e);
  }
}

/** Pomocnicze — poczekaj aż body będzie gotowe (czasem w klasycznym kliencie potrzeba chwili) */
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
async function insertSignatureFromTaskpane(profile) {
  await ensureBodyReady();
  const item = Office.context.mailbox.item;
  const sigHtml = buildSignatureHtml(profile);

  const isMessage = item.itemType === Office.MailboxEnums.ItemType.Message;
  const canUseSetSignature =
    typeof Office?.context?.requirements?.isSetSupported === "function" &&
    Office.context.requirements.isSetSupported("Mailbox", "1.10");

  // Preferuj wstawienie jako "stopka" (podmienia sekcję podpisu użytkownika)
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

  // Fallback: zwykłe wstawienie HTML do treści (np. spotkania/klasyczny Outlook)
  await new Promise((resolve, reject) => {
    item.body.setAsync("<br/><br/>" + sigHtml, { coercionType: Office.CoercionType.Html }, (res) =>
      res.status === Office.AsyncResultStatus.Succeeded
        ? resolve()
        : reject(res.error || new Error("body.setAsync failed"))
    );
  });
}
