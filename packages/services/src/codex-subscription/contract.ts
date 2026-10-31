import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface CodexQuotaWindow {
  remainingPercent: number;
  windowSeconds?: number;
  resetsAt?: number;
}

export interface CodexAccount {
  id: string;
  email: string;
  workspaceId: string;
  plan?: string;
  needsLogin: boolean;
  models: string[];
  quota?: {
    windows: CodexQuotaWindow[];
    credits?: string;
    unlimitedCredits?: boolean;
    updatedAt: number;
  };
  stale: boolean;
  error?: string;
}

export interface CodexDeviceLogin {
  id: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  intervalMs: number;
}

/** Commands target the current Host. No method exposes bearer or refresh tokens. */
export interface ICodexSubscriptionService {
  listAccounts(): Promise<CodexAccount[]>;
  startLogin(accountId?: string): Promise<CodexDeviceLogin>;
  pollLogin(
    loginId: string,
  ): Promise<{ status: "pending" } | { status: "complete"; account: CodexAccount }>;
  cancelLogin(loginId: string): Promise<void>;
  removeAccount(accountId: string): Promise<void>;
  refreshAccount(accountId: string): Promise<CodexAccount>;
  /** Creates/updates this account's provider; does not change running sessions. */
  connectAccount(accountId: string): Promise<{ providerId: string }>;
}

export const ICodexSubscriptionService = createServiceDescriptor<ICodexSubscriptionService>(
  ServiceChannels.CodexSubscription,
);
