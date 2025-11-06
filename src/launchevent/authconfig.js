import { createNestablePublicClientApplication } from "@azure/msal-browser";

export const auth = {
  auth: {
    clientId: "878d3b23-1c7b-436e-b6bd-6500251cb62d",
    authority: "https://login.microsoftonline.com/common",
    // Dla web/popup – wskazuje na Twoją stronę (np. taskpane)
    redirectUri: "https://kurzyna.github.io/SignatureAuto/dist/taskpane.html",
    postLogoutRedirectUri: "https://kurzyna.github.io/SignatureAuto/dist/",
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false, // true tylko gdy musisz wspierać bardzo stare WebView/IE
  },
};

export let pca;

export async function initMsal() {
  if (!pca) {
    pca = await createNestablePublicClientApplication(auth);
    // opcjonalnie: ustaw activeAccount, jeśli MSAL już coś ma w cache
    const acc = pca.getAllAccounts()[0];
    if (acc) pca.setActiveAccount(acc);
  }
  return pca;
}
