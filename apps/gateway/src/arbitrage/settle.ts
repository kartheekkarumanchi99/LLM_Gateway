import { capacityLoans, creditLedger, getDb } from '@llmgw/db';

// Tenant-isolated settlement for a cross-tenant borrow. The borrower pays the transfer price
// (provider cost + the lender's margin); the lender is credited it (their real provider bill
// is provider_cost_usd, so they net the margin). Idempotent per requestId.
export async function recordLoan(p: {
  borrowerOrgId: string;
  lenderOrgId: string;
  provider: string;
  model: string;
  requestId: string;
  promptTokens: number;
  completionTokens: number;
  providerCostUsd: number;
  marginPct: number;
}): Promise<{ transferPriceUsd: number; marginUsd: number } | null> {
  const transferPrice = p.providerCostUsd * (1 + p.marginPct / 100);
  const marginUsd = transferPrice - p.providerCostUsd;
  try {
    const db = getDb();
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(capacityLoans)
        .values({
          borrowerOrgId: p.borrowerOrgId,
          lenderOrgId: p.lenderOrgId,
          provider: p.provider,
          model: p.model,
          requestId: p.requestId,
          promptTokens: p.promptTokens,
          completionTokens: p.completionTokens,
          providerCostUsd: p.providerCostUsd.toFixed(10),
          transferPriceUsd: transferPrice.toFixed(10),
          marginUsd: marginUsd.toFixed(10),
        })
        .onConflictDoNothing({ target: capacityLoans.requestId })
        .returning({ id: capacityLoans.id });
      if (inserted.length === 0) return null; // already settled

      const loanId = inserted[0]!.id;
      if (transferPrice > 0) {
        await tx.insert(creditLedger).values([
          { orgId: p.borrowerOrgId, entryType: 'arbitrage_debit', amountUsd: (-transferPrice).toFixed(10), ref: `loan:${loanId}` },
          { orgId: p.lenderOrgId, entryType: 'arbitrage_credit', amountUsd: transferPrice.toFixed(10), ref: `loan:${loanId}` },
        ]);
      }
      return { transferPriceUsd: transferPrice, marginUsd };
    });
  } catch (e) {
    console.error('[arbitrage] loan settlement failed:', (e as Error).message);
    return null;
  }
}
