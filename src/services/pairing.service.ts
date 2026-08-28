import { randomUUID } from "crypto";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { AppError } from "../middlewares/error.middleware";
import { CryptoUtils } from "../utils/crypto";

export class PairingService {
  /**
   * Generates a single-use cryptographically secure pairing code for a user.
   */
  static async generatePairingCode(userId: string) {
    // 1. Verify user does not already have an active pairing
    const existingPairing = await prisma.pairing.findFirst({
      where: {
        OR: [{ userOneId: userId }, { userTwoId: userId }],
        status: "ACTIVE",
      },
    });

    if (existingPairing) {
      throw new AppError(
        "You already have an active pairing. You must unpair before creating a new pairing code.",
        400
      );
    }

    // 2. Invalidate previous active unconsumed codes for this user
    await prisma.pairingCode.updateMany({
      where: {
        creatorUserId: userId,
        isConsumed: false,
      },
      data: {
        isConsumed: true,
      },
    });

    // 3. Generate secure code and store SHA-256 hash
    const rawCode = CryptoUtils.generatePairingCode(6);
    const codeHash = CryptoUtils.hashCode(rawCode);
    const expiresAt = new Date(Date.now() + env.PAIRING_CODE_EXPIRATION_MINUTES * 60 * 1000);

    await prisma.pairingCode.create({
      data: {
        creatorUserId: userId,
        codeHash,
        expiresAt,
        isConsumed: false,
      },
    });

    return {
      code: rawCode,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: env.PAIRING_CODE_EXPIRATION_MINUTES * 60,
    };
  }

  /**
   * Validates pairing code and creates an atomic permanent pairing between exactly two users.
   */
  static async joinPairing(userId: string, rawCode: string) {
    // 1. Verify joiner does not already have an active pairing
    const joinerExistingPairing = await prisma.pairing.findFirst({
      where: {
        OR: [{ userOneId: userId }, { userTwoId: userId }],
        status: "ACTIVE",
      },
    });

    if (joinerExistingPairing) {
      throw new AppError(
        "You already have an active pairing. You must unpair before joining another pairing.",
        400
      );
    }

    // 2. Verify pairing code hash and expiration
    const codeHash = CryptoUtils.hashCode(rawCode);
    const codeRecord = await prisma.pairingCode.findUnique({
      where: { codeHash },
      include: {
        creatorUser: {
          select: { id: true, displayName: true, authIdentifier: true },
        },
      },
    });

    if (!codeRecord || codeRecord.isConsumed || codeRecord.expiresAt < new Date()) {
      throw new AppError("Invalid, expired, or already used pairing code.", 400);
    }

    // 3. Prevent self-pairing
    if (codeRecord.creatorUserId === userId) {
      throw new AppError("You cannot pair with yourself.", 400);
    }

    // 4. Verify code creator does not already have another active pairing
    const creatorActivePairing = await prisma.pairing.findFirst({
      where: {
        OR: [{ userOneId: codeRecord.creatorUserId }, { userTwoId: codeRecord.creatorUserId }],
        status: "ACTIVE",
      },
    });

    if (creatorActivePairing) {
      throw new AppError("The creator of this pairing code is already paired with another device.", 400);
    }

    // 5. Execute atomic transaction to consume code and create pairing
    const agoraChannelName = `talky_pair_${randomUUID().replace(/-/g, "")}`;

    const pairing = await prisma.$transaction(async (tx) => {
      // Mark code as consumed
      await tx.pairingCode.update({
        where: { id: codeRecord.id },
        data: {
          isConsumed: true,
          consumedAt: new Date(),
        },
      });

      // Check if a previous pairing between these two users already exists
      const existingPairingRecord = await tx.pairing.findFirst({
        where: {
          OR: [
            { userOneId: codeRecord.creatorUserId, userTwoId: userId },
            { userOneId: userId, userTwoId: codeRecord.creatorUserId },
          ],
        },
      });

      let newPairing;
      if (existingPairingRecord) {
        // Reactivate existing pairing
        newPairing = await tx.pairing.update({
          where: { id: existingPairingRecord.id },
          data: {
            status: "ACTIVE",
            agoraChannelName,
            pairedAt: new Date(),
            unpairedAt: null,
          },
          include: {
            userOne: { select: { id: true, displayName: true, authIdentifier: true } },
            userTwo: { select: { id: true, displayName: true, authIdentifier: true } },
          },
        });
      } else {
        // Create new permanent 1-to-1 pairing
        newPairing = await tx.pairing.create({
          data: {
            userOneId: codeRecord.creatorUserId,
            userTwoId: userId,
            status: "ACTIVE",
            agoraChannelName,
            pairedAt: new Date(),
          },
          include: {
            userOne: { select: { id: true, displayName: true, authIdentifier: true } },
            userTwo: { select: { id: true, displayName: true, authIdentifier: true } },
          },
        });
      }

      // Initialize or reset default user settings (unmuted)
      await tx.userSetting.upsert({
        where: {
          userId_pairingId: { userId: codeRecord.creatorUserId, pairingId: newPairing.id },
        },
        create: {
          userId: codeRecord.creatorUserId,
          pairingId: newPairing.id,
          silenced: false,
        },
        update: {
          silenced: false,
        },
      });

      await tx.userSetting.upsert({
        where: {
          userId_pairingId: { userId, pairingId: newPairing.id },
        },
        create: {
          userId,
          pairingId: newPairing.id,
          silenced: false,
        },
        update: {
          silenced: false,
        },
      });

      return newPairing;
    });

    const peer = pairing.userOneId === userId ? pairing.userTwo : pairing.userOne;

    return {
      pairing: {
        id: pairing.id,
        status: pairing.status,
        agoraChannelName: pairing.agoraChannelName,
        pairedAt: pairing.pairedAt,
        peer,
      },
    };
  }

  /**
   * Retrieves active pairing information for authenticated user.
   */
  static async getCurrentPairing(userId: string) {
    const pairing = await prisma.pairing.findFirst({
      where: {
        OR: [{ userOneId: userId }, { userTwoId: userId }],
        status: "ACTIVE",
      },
      include: {
        userOne: {
          select: {
            id: true,
            displayName: true,
            authIdentifier: true,
            devices: {
              select: { platform: true, lastSeenAt: true, isActive: true },
              take: 1,
              orderBy: { lastSeenAt: "desc" },
            },
          },
        },
        userTwo: {
          select: {
            id: true,
            displayName: true,
            authIdentifier: true,
            devices: {
              select: { platform: true, lastSeenAt: true, isActive: true },
              take: 1,
              orderBy: { lastSeenAt: "desc" },
            },
          },
        },
        settings: {
          where: { userId },
        },
      },
    });

    if (!pairing) {
      return { hasActivePairing: false, pairing: null };
    }

    const peer = pairing.userOneId === userId ? pairing.userTwo : pairing.userOne;
    const userSetting = pairing.settings[0] || { silenced: false };

    return {
      hasActivePairing: true,
      pairing: {
        id: pairing.id,
        status: pairing.status,
        agoraChannelName: pairing.agoraChannelName,
        pairedAt: pairing.pairedAt,
        isSilenced: userSetting.silenced,
        peer: {
          id: peer.id,
          displayName: peer.displayName,
          authIdentifier: peer.authIdentifier,
          platform: peer.devices[0]?.platform || "UNKNOWN",
          lastSeenAt: peer.devices[0]?.lastSeenAt || null,
        },
      },
    };
  }

  /**
   * Explicitly unpairs the relationship. Either participant can initiate.
   */
  static async unpair(userId: string, pairingId: string) {
    const pairing = await prisma.pairing.findUnique({
      where: { id: pairingId },
    });

    if (!pairing) {
      throw new AppError("Pairing not found.", 404);
    }

    if (pairing.userOneId !== userId && pairing.userTwoId !== userId) {
      throw new AppError("You are not authorized to modify this pairing.", 403);
    }

    if (pairing.status === "UNPAIRED") {
      return { success: true, unpairedAt: pairing.unpairedAt };
    }

    const updated = await prisma.pairing.update({
      where: { id: pairingId },
      data: {
        status: "UNPAIRED",
        unpairedAt: new Date(),
      },
    });

    return {
      success: true,
      unpairedAt: updated.unpairedAt,
    };
  }

  /**
   * Toggles silence/mute mode for the caller in a pairing (indefinite or temporary).
   */
  static async toggleSilence(
    userId: string,
    pairingId: string,
    silenced: boolean,
    durationMinutes?: number
  ) {
    const pairing = await prisma.pairing.findUnique({
      where: { id: pairingId },
    });

    if (!pairing || (pairing.userOneId !== userId && pairing.userTwoId !== userId)) {
      throw new AppError("Pairing not found or access unauthorized.", 403);
    }

    const setting = await prisma.userSetting.upsert({
      where: {
        userId_pairingId: { userId, pairingId },
      },
      create: {
        userId,
        pairingId,
        silenced,
      },
      update: {
        silenced,
      },
    });

    return {
      success: true,
      pairingId,
      silenced: setting.silenced,
      durationMinutes: durationMinutes || null,
    };
  }

  /**
   * Retrieves status for a specific pairing ID.
   */
  static async getPairingStatus(userId: string, pairingId: string) {
    const pairing = await prisma.pairing.findUnique({
      where: { id: pairingId },
      include: {
        userOne: { select: { id: true, displayName: true, authIdentifier: true } },
        userTwo: { select: { id: true, displayName: true, authIdentifier: true } },
        settings: { where: { userId } },
      },
    });

    if (!pairing || (pairing.userOneId !== userId && pairing.userTwoId !== userId)) {
      throw new AppError("Pairing not found or access unauthorized.", 403);
    }

    const peer = pairing.userOneId === userId ? pairing.userTwo : pairing.userOne;
    const userSetting = pairing.settings[0] || { silenced: false };

    return {
      id: pairing.id,
      status: pairing.status,
      agoraChannelName: pairing.agoraChannelName,
      pairedAt: pairing.pairedAt,
      unpairedAt: pairing.unpairedAt,
      isSilenced: userSetting.silenced,
      peer,
    };
  }
}
