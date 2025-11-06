/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global console, fetch, Office */

import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { auth } from "./authconfig";
import { buildSignatureHtml } from "../common/signature";

let pca = undefined;
let isPCAInitialized = false;

// Called when loaded into Outlook on the web.
Office.onReady(() => {});

/**
 * Initialize the public client application to work with SSO through NAA.
 */
async function initializePCA() {
  if (isPCAInitialized) {
    return;
  }

  // Initialize the public client application.
  try {
    pca = await createNestablePublicClientApplication({
      auth: auth,
    });
    isPCAInitialized = true;
  } catch (error) {
    // All console.log statements write to the runtime log. For more information, see https://learn.microsoft.com/office/dev/add-ins/testing/runtime-logging
    console.log(`Error creating pca: ${error}`);
  }
}

/**
 * Gets the user name from Microsoft Graph. Uses an access token acquired through NAA and SSO.
 * @returns the user name (display name).
 */
async function getUserName() {
  await initializePCA();
  // Scopes potrzebne do pobrania danych profilu
  const tokenRequest = {
    scopes: ["User.Read", "openid", "profile"],
  };
  let accessToken = null;

  try {
    console.log("Trying to acquire token silently...");
    const userAccount = await pca.acquireTokenSilent(tokenRequest);
    console.log("Acquired token silently.");
    accessToken = userAccount.accessToken;
  } catch (error) {
    console.log(`Unable to acquire token silently: ${error}`);
    throw error;
  }

  if (accessToken === null) {
    console.log(`Unable to acquire access token. Access token is null.`);
    throw new Error("Unable to acquire access token. Access token is null.");
  }

  // 🔹 Pobranie szczegółowych danych użytkownika
  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,userPrincipalName,businessPhones,mobilePhone,jobTitle,department,officeLocation",
    {
      headers: { Authorization: accessToken },
    }
  );

  if (response.ok) {
    const data = await response.json();

    // Zwracamy pełny obiekt z wszystkimi polami, zamiast tylko displayName
    return {
      firstName: data.givenName || "",
      lastName: data.surname || "",
      email: data.mail || data.userPrincipalName || "",
      phone: (data.businessPhones && data.businessPhones[0]) || data.mobilePhone || "",
      jobTitle: data.jobTitle || "",
      team: data.department || "",
      office: data.officeLocation || "",
      displayName: data.displayName || `${data.givenName || ""} ${data.surname || ""}`.trim(),
    };
  } else {
    const errorText = await response.text();
    console.log("Microsoft Graph call failed - error text: " + errorText);
    throw new Error(errorText);
  }
}

/**
 * Called when the user creates a new email. Will set the signature using the signed-in user's name.
 * @param {*} event The event context from Office.
 */
function onNewMessageComposeHandler(event) {
  setSignature(event);
}

/**
 * Called when the user creates a new appointment. Will set the signature using the signed-in user's name.
 * @param {*} event The event context from Office.
 */
function onNewAppointmentComposeHandler(event) {
  setSignature(event);
}

/**
 * Sets the signature in the email item to indicate it is from the signed-in user.
 * @param {*} event The event context from Office.
 */
async function setSignature(event) {
  const item = Office.context.mailbox.item;

  try {
    const profile = await getUserName(); // Twoja funkcja pobierająca dane z Graph
    const signatureHtml = buildSignatureHtml(profile);

    item.body.setSignatureAsync(
      signatureHtml,
      { asyncContext: event, coercionType: Office.CoercionType.Html },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Failed) {
          console.error("Błąd dodania stopki:", result.error.message);
        } else {
          console.log("Stopka dodana poprawnie.");
        }
        event.completed();
      }
    );
  } catch (error) {
    console.error("Nie udało się ustawić stopki:", error);
    notifyUserToSignIn();
    event.completed();
  }
}

/**
 * Callback function to handle the result of adding a signature to the mail item.
 * @param {*} result The result from attemting to set the signature
 */
function addSignatureCallback(result) {
  if (result.status === Office.AsyncResultStatus.Failed) {
    console.log(result.error.message);
  } else {
    console.log("Successfully added signature.");
    result.asyncContext.completed();
  }
}

/**
 * Gets correct command id to match to item type (appointment or message).
 * @returns The command id.
 */
function get_command_id() {
  if (Office.context.mailbox.item.itemType == "appointment") {
    return "MRCS_TpBtn1";
  }
  return "MRCS_TpBtn0";
}

/**
 * Adds a notification to the email item requesting the user to sign in using the task pane.
 */
function notifyUserToSignIn() {
  Office.context.mailbox.item.notificationMessages.addAsync("16c028c6_sign_in_notification", {
    type: "insightMessage",
    message: "Zaloguj się w dodatku AKMF, aby automatycznie wstawić swoją stopkę e-mail",
    icon: "Icon.16x16",
    actions: [
      {
        actionType: "showTaskPane",
        actionText: "Zaloguj się",
        commandId: get_command_id(),
        contextData: "{''}",
      },
    ],
  });
}

Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
Office.actions.associate("onNewAppointmentComposeHandler", onNewAppointmentComposeHandler);
