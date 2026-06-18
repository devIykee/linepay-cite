/**
 * Circle User-Controlled Wallets — server side.
 *
 * Non-custodial embedded wallets: Circle generates an MPC-secured wallet the
 * USER custodies via a PIN they set on the device (no app download). We use our
 * own `users.id` as the Circle `userId`, so every account maps 1:1 to a Circle
 * user. The backend never holds the key; it can only read addresses and create
 * *challenges* that the frontend Web SDK executes with the user's PIN.
 *
 * Only CIRCLE_API_KEY is needed here (no entity secret — that's for
 * developer-controlled wallets). The public App ID lives on the client.
 *
 * Admins are NEVER provisioned an embedded wallet — they sign with an external
 * wallet. Enforcement lives in the route handlers, not here.
 */
import {
  initiateUserControlledWalletsClient,
  type CircleUserControlledWalletsClient,
} from "@circle-fin/user-controlled-wallets";

/** Arc testnet identifier in Circle's blockchain enum. */
export const CIRCLE_ARC = "ARC-TESTNET";

let client: CircleUserControlledWalletsClient | null = null;

/** Lazily build the Circle client. Throws a clear error if the key is missing. */
export function circle(): CircleUserControlledWalletsClient {
  if (client) return client;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not set — required for embedded wallets.");
  client = initiateUserControlledWalletsClient({ apiKey });
  return client;
}

/** True when embedded wallets are configured (key + public App ID present). */
export function embeddedWalletsEnabled(): boolean {
  return !!process.env.CIRCLE_API_KEY && !!process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
}

/**
 * Ensure a Circle user exists for our userId. `createUser` is effectively
 * idempotent for our purposes — a duplicate returns a 409 we can ignore.
 */
export async function ensureCircleUser(userId: string): Promise<void> {
  try {
    await circle().createUser({ userId });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    // Already exists → fine. Re-throw anything else.
    if (!/already exist|409|duplicate/i.test(msg)) throw e;
  }
}

/** A short-lived (60-min) session token + encryption key for the Web SDK. */
export async function issueUserToken(
  userId: string
): Promise<{ userToken: string; encryptionKey: string }> {
  const res = await circle().createUserToken({ userId });
  const userToken = res.data?.userToken;
  const encryptionKey = res.data?.encryptionKey;
  if (!userToken || !encryptionKey) throw new Error("circle_token_failed");
  return { userToken, encryptionKey };
}

/**
 * Create the initialize-PIN + create-wallet challenge. The frontend Web SDK
 * executes the returned challengeId; the user sets a PIN and the SCA wallet is
 * created on Arc.
 */
export async function createWalletChallenge(userToken: string): Promise<string> {
  const res = await circle().createUserPinWithWallets({
    userToken,
    blockchains: [CIRCLE_ARC as never],
    accountType: "SCA",
  });
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error("circle_wallet_challenge_failed");
  return challengeId;
}

export interface EmbeddedWallet {
  id: string;
  address: string;
}

/** Read the user's first Arc wallet (id + address) — available server-side. */
export async function getEmbeddedWallet(userToken: string): Promise<EmbeddedWallet | null> {
  const res = await circle().listWallets({ userToken });
  const wallet = res.data?.wallets?.find((w) => !!w.address) ?? res.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) return null;
  return { id: wallet.id, address: wallet.address };
}

/**
 * Create a contract-execution challenge (approve / deposit / addDelegate). The
 * frontend executes it with the PIN; the SCA broadcasts the tx. Returns the
 * challengeId. ABI values come from the caller (Gateway/USDC constants).
 */
export async function createContractExecChallenge(input: {
  userToken: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number>;
}): Promise<string> {
  const res = await circle().createUserTransactionContractExecutionChallenge({
    userToken: input.userToken,
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    abiFunctionSignature: input.abiFunctionSignature,
    abiParameters: input.abiParameters,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error("circle_contract_challenge_failed");
  return challengeId;
}
