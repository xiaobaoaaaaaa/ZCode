import type { ICodexSubscriptionService } from "./contract.js";
export async function connectExistingCodexAccount(service: ICodexSubscriptionService) {
  const account = (await service.listAccounts()).find((item) => !item.needsLogin);
  return account ? service.connectAccount(account.id) : undefined;
}
