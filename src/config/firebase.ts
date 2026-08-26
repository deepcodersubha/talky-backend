import fs from "fs";
import path from "path";
import { initializeApp, cert, applicationDefault, App } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";
import { logger } from "./logger";

let firebaseAdminApp: App | null = null;

export function initializeFirebaseAdmin(): App | null {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
      const parsed = JSON.parse(serviceAccountJson);
      firebaseAdminApp = initializeApp({
        credential: cert(parsed),
      });
      logger.info("✅ Firebase Admin SDK initialized with FIREBASE_SERVICE_ACCOUNT_JSON (FCM HTTP v1)");
      return firebaseAdminApp;
    }

    if (serviceAccountPath) {
      const resolvedPath = path.isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : path.resolve(process.cwd(), serviceAccountPath);

      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, "utf-8");
        const parsed = JSON.parse(fileContent);
        firebaseAdminApp = initializeApp({
          credential: cert(parsed),
        });
        logger.info(`✅ Firebase Admin SDK initialized with file: ${resolvedPath} (FCM HTTP v1)`);
        return firebaseAdminApp;
      } else {
        logger.warn(`⚠️ Firebase service account file not found at: ${resolvedPath}`);
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      firebaseAdminApp = initializeApp({
        credential: applicationDefault(),
      });
      logger.info("✅ Firebase Admin SDK initialized with applicationDefault credentials (FCM HTTP v1)");
      return firebaseAdminApp;
    }

    logger.warn("ℹ️ Firebase Admin SDK not configured (no service account JSON provided). Push notifications will run in simulation mode.");
    return null;
  } catch (err) {
    logger.error("❌ Failed to initialize Firebase Admin SDK:", err);
    return null;
  }
}

export function getFirebaseMessaging(): Messaging | null {
  const app = initializeFirebaseAdmin();
  if (!app) return null;
  return getMessaging(app);
}
