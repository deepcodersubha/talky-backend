import { prisma } from "../config/database";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { getFirebaseMessaging } from "../config/firebase";

export interface PTTAlertPayload {
  pairingId: string;
  sessionId: string;
  speakerUserId: string;
  speakerDisplayName: string;
  agoraChannelName: string;
}

export class PushService {
  /**
   * Dispatches a high-priority FCM data message or APNs push to wake the paired receiver device.
   */
  static async sendPTTAlert(receiverUserId: string, payload: PTTAlertPayload): Promise<void> {
    try {
      // Find receiver's active registered devices
      const devices = await prisma.device.findMany({
        where: {
          userId: receiverUserId,
          isActive: true,
          pushToken: { not: null },
        },
        select: {
          id: true,
          platform: true,
          pushToken: true,
        },
      });

      if (devices.length === 0) {
        logger.debug(`No active push tokens found for receiver ${receiverUserId}`);
        return;
      }

      for (const device of devices) {
        if (!device.pushToken) continue;

        if (device.platform === "ANDROID") {
          await this.sendAndroidFCMDataMessage(device.pushToken, payload);
        } else if (device.platform === "IOS") {
          await this.sendIOSPushToTalkPush(device.pushToken, payload);
        }
      }
    } catch (err) {
      logger.warn(`Failed to dispatch PTT push alerts for receiver ${receiverUserId}:`, err);
    }
  }

  private static async sendAndroidFCMDataMessage(
    pushToken: string,
    payload: PTTAlertPayload
  ): Promise<void> {
    logger.info(`[FCM v1] Dispatching High-Priority PTT Data Message to Android token: ${pushToken.substring(0, 15)}...`);

    const dataPayload = {
      type: "ptt_started",
      pairingId: payload.pairingId,
      sessionId: payload.sessionId,
      speakerUserId: payload.speakerUserId,
      speakerDisplayName: payload.speakerDisplayName,
      agoraChannelName: payload.agoraChannelName,
      timestamp: String(Date.now()),
    };

    const messaging = getFirebaseMessaging();

    if (messaging) {
      try {
        const response = await messaging.send({
          token: pushToken,
          data: dataPayload,
          android: {
            priority: "high",
            ttl: 0,
            directBootOk: true,
          },
        });
        logger.info(`[FCM v1] Push notification dispatched successfully. Message ID: ${response}`);
      } catch (err: any) {
        logger.warn(`[FCM v1] Failed to send push notification to token ${pushToken.substring(0, 15)}:`, err?.message || err);
      }
    } else {
      logger.debug("[FCM Simulation] Firebase Admin not configured. Message payload prepared:", dataPayload);
    }
  }

  private static async sendIOSPushToTalkPush(
    pushToken: string,
    payload: PTTAlertPayload
  ): Promise<void> {
    logger.info(`[APNs] Dispatching PushToTalk push to iOS token: ${pushToken.substring(0, 15)}...`);
    // When APNS is configured, sends APNs push with `apns-push-type: pushtotalk` and topic `<bundle_id>.pushtotalk`
  }
}

