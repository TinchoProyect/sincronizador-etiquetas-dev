// src/google/gsheetsClient.js
const { google } = require("googleapis");
require("dotenv").config();

let sheetsSingleton = null;

async function getSheets() {
  if (sheetsSingleton) return sheetsSingleton;

  if (!process.env.GOOGLE_SA_KEY_FILE) {
    throw new Error("Falta GOOGLE_SA_KEY_FILE en .env");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SA_KEY_FILE,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  const authClient = await auth.getClient();
  sheetsSingleton = google.sheets({ version: "v4", auth: authClient });

  return sheetsSingleton;
}

module.exports = { getSheets };
