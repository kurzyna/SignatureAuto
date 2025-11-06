export function buildSignatureHtml(profile) {
  const {
    firstName = "",
    lastName = "",
    email = "",
    phone = "",
    jobTitle = "",
    team = "",
    office = "",
  } = profile || {};

  let linkedin =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFQAAABUCAYAAAAcaxDBAAAACXBIWXMAACxLAAAsSwGlPZapAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAS/SURBVHgB7Z1fTFtVHMe/59a4h24dW3Qs2UgK7GUbcbxp0GQ1oejeHJKgJho1WdxexETmkwQWEl+GD+iD6B7Q+DBJlGGi8Q8Y4YXoi4Jh6MtKzfbQ6ZKVQh+2ZL07v8vaFFa6c3t+LLnc3ycplNtD03z6u+f3O+f09ihU4bF4e0LBfUFBHVcKcX2oDuEkCxdzBbjzLtTEjfTU9GYNVaWDJDIC9OtHExAq4KYLrnPy//Tk3MZHIhsP7Iu39zsKn2MtIoWKqDp9xp6O1jUhn03NlD+yTui+puSoDtl3IBihpSaiexvj+ZtL3xaPlYRSZIpM/+j80loeqV4f+ng82eoo908INaNcPJvRycqhPxxVuATBClfpJK5RXkZX+BWCNRSlTkTXmRBYuKNd6lNeHYPAgoJz3NE/WyHwoNw4JaWwDifZ0SVTnQOBFRHKjAhlRoQy8wiYaDhQj1NvnMSJjmfQcLAeudwqFhavYOybn71bWGAR2v1iBwb7ziAW21k6Rvfbnjrm3Uj20EdfIgxEdu5pGoAFJGv84ofYsePRTduQ1GUdsX/M/YPtjnUf2tvzqlG7l3QUhwFroRR9Jhw9csjrW7c71kIbDu43b3tAhD4QyuamLK/ksd2xFrrw9xWjdlevXcflRbO2QcZa6NCwWTk09vVPCAPWZRNFHs2zVEtOVOCf7vkAYcBaKDH7+7wntkVn8t1lxX0ul8fHI2N4r28Yt27dRhhQ9Y3tLhhpOdLsjZKKQ8+wwTaWLxJGieXIbBMzIpQZ61O+7cknjNsuLKaQW1nd0uchYrui3jC3mCBpYoaSZu4hDCysk1ImNWnctvPld3VF8NeWPA+9Ic8n20rzsZW4ei2D2d/mvfnZzV6HLexJ6WFD8wPD588aTdLQvEN3F92e8+TSoIR78jvQfWjL4Wb88v2I8YxXOSSX3ojB98+Ak8AKJZnjF4fWrRLUwqk3OzH13Yjud+2ep0gghVJ0jX46YC2zCA1GaAmHg0AK7e15zdc8rAndXR3eIqMtAY3QrZmopjfK9tSXwr4Mqlu7u5KwQYRu4ETyadgQ+DqUpgg/Gx3HZb1ysHxvOYYqAOoTj+rffvE+R6C7lLV5Xv8EWuiPk7N4++z5+9a1aDREkit9AMMEGnFdGK3tsoPAnvIk8/W3+qsuEtIoqPOVXviFyqhaCazQvsFPjNrR/KzpuleRlsOHUCuBFEqRR2NxUy7o09/PcncsFkWtBFOozxVUSlY/6C7CFJsRWGjKJj+fCdgtQh9MrWWQX0IjdHnFvA+1QUZKzIhQZkQoMyKUGRHKjAhlRoQyI0KZEaHMiFBmRCgzIpQZEcqMCGVGhDIjQpkRocyIUGZEKDMilBn2SxPDjkQoMyKUGRKahcCC7juzJDQNgQUFzDtw3RkILBRcd85RUBMQWIhol9732OvSib4lPAHBApW+vjTZ6GV55eIcBCsKLryrxrytK1azqfSuvU0UrQkIvlEK5/5bmvqK7pf2Alm9mZqO7mlu1FblW8N9oHPQF5mlqdIeKut2q8lnUxMSqeZQZJbL9I5Vari22Qou6VI1DqESMzrvDGQq7Pylqv3X/nh7wtuOQSnqBugq//BuoQb3X514pqk0ylTZQu0uOTdo2VpJWRYAAAAASUVORK5CYII=";
  let stronaWWW =
    "data:image/png;base64,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";
  let kariera =
    "data:image/png;base64,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";
  let rodo =
    "data:image/png;base64,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";
  let logoAK =
    "data:image/png;base64,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";

  return `

<!--[if mso]>
<style>
  /* Outlook (Word) – wyłącz podkreślenia i wymuś kolor */
  #akmf-sig a,
  #akmf-sig span.MsoHyperlink,
  #akmf-sig span.MsoHyperlinkFollowed {
    text-decoration: none !important;
    color: #000000 !important;
    border: none !important;
  }
</style>
<![endif]-->
<style>
  /* iOS/macOS Mail – nie maluj auto-linków na niebiesko */
  #akmf-sig a[x-apple-data-detectors]{
    color: inherit !important;
    text-decoration: none !important;
    border-bottom: 0 !important;
  }
</style>
<!--[if mso]>
<style>
  /* Word/Outlook – zamień Poppins na Segoe UI/Arial */
  .use-poppins { font-family: 'Segoe UI', Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
<div id="akmf-sig" class="use-poppins" style="font-family:'Poppins','Segoe UI',Arial,Helvetica,sans-serif;">
  <!-- JEDNA TABELA NA CAŁĄ STOPKĘ -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="mso-table-lspace:0;mso-table-rspace:0;">
    <tr>
      <td align="left" style="padding:0;">

        <!-- Szerokość logiczna 600px (skalowanie do 100%) -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:600px;max-width:100%;mso-table-lspace:0;mso-table-rspace:0;">
          <!-- Imię i nazwisko -->
          <tr>
            <td style="padding:0 0 0 0; font-size:14pt; line-height:1.5; font-weight:700;display:block; text-decoration:none; text-underline:none;
            color:#000000 !important; border:0; outline:0;
            -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
            mso-line-height-rule:exactly; font-family:'Poppins',Arial,Helvetica,sans-serif; ">
              ${firstName} ${lastName}
            </td>
          </tr>

          <!-- Stanowisko -->
          <tr>
            <td style="padding:0; font-size:8pt; line-height:1.5;display:block; text-decoration:none; text-underline:none;
            color:#000000 !important; border:0; outline:0;
            -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
            mso-line-height-rule:exactly; font-family:'Poppins',Arial,Helvetica,sans-serif;">
              ${jobTitle}
          </tr>

          <!-- Zespół -->
          <tr>
            <td style="padding:0; font-size:8pt; line-height:1.5;display:block; text-decoration:none; text-underline:none;
            color:#000000 !important; border:0; outline:0;
            -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
            mso-line-height-rule:exactly; font-family:'Poppins',Arial,Helvetica,sans-serif;">
              ${team}
            </td>
          </tr>

          <!-- Departament -->
          <tr>
            <td style="padding:0; font-size:8pt; line-height:1.5;display:block; text-decoration:none; text-underline:none;
            color:#000000 !important; border:0; outline:0;
            -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
            mso-line-height-rule:exactly; font-family:'Poppins',Arial,Helvetica,sans-serif;">
              ${office}
            </td>
          </tr>

          <!-- odstęp -->
          <tr><td style="height:10pt; line-height:10pt; font-size:0;">&nbsp;</td></tr>

          <!-- Telefon -->
          <tr>
            <td style="padding:0; font-size:12pt; line-height:1.5;">
              <a href="tel:${phone}" x-apple-data-detectors="true"
                 style="display:block; text-decoration:none; text-underline:none;
                        color:#000000 !important; border:0; outline:0;
                        -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
                        mso-line-height-rule:exactly; font-family:'Poppins', Arial, Helvetica, sans-serif;">
                <b style="font-weight:700; color:#000000 !important; text-decoration:none !important;">
                  <font color="#000000" style="text-decoration:none; font-weight:700;">
                    ${phone}
                  </font>
                </b>
              </a>
            </td>
          </tr>

          <!-- E-mail -->
          <tr>
            <td style="padding:0; font-size:12pt; line-height:1.5;">
              <a href="mailto:${email}" x-apple-data-detectors="true"
                 style="display:block; text-decoration:none; text-underline:none;
                        color:#000000 !important; border:0; outline:0;
                        -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
                        mso-line-height-rule:exactly; font-family:'Poppins', Arial, Helvetica, sans-serif;">
                <b style="font-weight:700; color:#000000 !important; text-decoration:none !important;">
                  <font color="#000000" style="text-decoration:none; font-weight:700;">
                    ${email}
                  </font>
                </b>
              </a>
            </td>
          </tr>

          <!-- odstęp -->
          <tr><td style="height:8pt; line-height:8pt; font-size:0;">&nbsp;</td></tr>

          <!-- Firma -->
          <tr>
            <td style="padding:0; font-size:8pt; line-height:1.5;display:block; text-decoration:none; text-underline:none;
            color:#000000 !important; border:0; outline:0;
            -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
            mso-line-height-rule:exactly; font-family:'Poppins',Arial,Helvetica,sans-serif;">
              Aplikacje Krytyczne Sp. z o.o.
            </td>
          </tr>

          <!-- Adres -->
          <tr>
            <td style="padding:0; font-size:8pt; line-height:1.5;display:block; text-decoration:none; text-underline:none;
            color:#000000 !important; border:0; outline:0;
            -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;
            mso-line-height-rule:exactly; font-family:'Poppins',Arial,Helvetica,sans-serif;">
              ul. Chmielna 132/134, 00-805 Warszawa
            </td>
          </tr>

          <!-- odstęp -->
          <tr><td style="height:10pt; line-height:10pt; font-size:0;">&nbsp;</td></tr>

<!-- ===== IKONY i LOGO (tabela odporna na Outlook + font Poppins) ===== -->
<tr>
  <td style="padding:0; line-height:0; font-size:0; mso-line-height-rule:exactly;
             font-family:'Poppins', Arial, Helvetica, sans-serif;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="font-family:'Poppins', Arial, Helvetica, sans-serif;">
      <tr>
        <!-- LinkedIn -->
        <td valign="middle" style="padding:0; mso-line-height-rule:exactly;">
          <a href="https://www.linkedin.com/company/akmf/" target="_blank"
             style="display:block; text-decoration:none !important; text-underline:none;
                    color:inherit !important; border:0 !important; outline:0 !important;
                    font-family:'Poppins', Arial, Helvetica, sans-serif;">
            <img src="${linkedin}" width="28" height="28" alt="LinkedIn"
                 style="display:block; border:0; outline:0; -ms-interpolation-mode:bicubic;">
          </a>
        </td>

        <td width="11" style="font-size:0; line-height:0;">&nbsp;</td>

        <!-- Strona WWW -->
        <td valign="middle" style="padding:0; mso-line-height-rule:exactly;">
          <a href="https://www.akmf.pl/" target="_blank"
             style="display:block; text-decoration:none !important; text-underline:none;
                    color:inherit !important; border:0 !important; outline:0 !important;
                    font-family:'Poppins', Arial, Helvetica, sans-serif;">
            <img src="${stronaWWW}" width="44" height="28" alt="Strona WWW"
                 style="display:block; border:0; outline:0; -ms-interpolation-mode:bicubic;">
          </a>
        </td>

        <td width="11" style="font-size:0; line-height:0;">&nbsp;</td>

        <!-- Kariera -->
        <td valign="middle" style="padding:0; mso-line-height-rule:exactly;">
          <a href="https://www.akmf.pl/kariera" target="_blank"
             style="display:block; text-decoration:none !important; text-underline:none;
                    color:inherit !important; border:0 !important; outline:0 !important;
                    font-family:'Poppins', Arial, Helvetica, sans-serif;">
            <img src="${kariera}" width="44" height="28" alt="Kariera"
                 style="display:block; border:0; outline:0; -ms-interpolation-mode:bicubic;">
          </a>
        </td>

        <td width="11" style="font-size:0; line-height:0;">&nbsp;</td>

        <!-- RODO -->
        <td valign="middle" style="padding:0; mso-line-height-rule:exactly;">
          <a href="https://www.akmf.pl/polityka-prywatnosci/" target="_blank"
             style="display:block; text-decoration:none !important; text-underline:none;
                    color:inherit !important; border:0 !important; outline:0 !important;
                    font-family:'Poppins', Arial, Helvetica, sans-serif;">
            <img src="${rodo}" width="44" height="28" alt="RODO"
                 style="display:block; border:0; outline:0; -ms-interpolation-mode:bicubic;">
          </a>
        </td>
      </tr>
    </table>

    <!-- odstęp pionowy -->
    <div style="height:14px; line-height:14px; font-size:0;">&nbsp;</div>
<!-- LOGO dolne -->
<div style="line-height:1; mso-line-height-rule:at-least;">
  <a href="https://www.akmf.pl/" target="_blank"
     style="display:inline-block; text-decoration:none !important; text-underline:none;
            border:0 !important; outline:0 !important; color:inherit !important;
            font-family:'Poppins', Arial, Helvetica, sans-serif;">
    <img src="${logoAK}" width="187" alt="Aplikacje Krytyczne"
         style="display:block; height:auto; border:0; outline:0; -ms-interpolation-mode:bicubic;">
  </a>
</div>

  </td>
</tr>



        </table>
      </td>
    </tr>
  </table>
</div>


`;
}
