import { randomUUID } from "node:crypto";
import type { Prisma } from "@pickly/database";
import type { DomainEventName, EventEnvelope } from "@pickly/contracts";

/**
 * Outbox — docs/12§3-1: الحدث يُكتب في نفس معاملة DB مع التغيير
 * (background_jobs بـjob_type='domain_event' — قرار D5)، والـworker ينشره.
 */
export async function emitEvent(
  tx: Prisma.TransactionClient,
  input: {
    name: DomainEventName;
    aggregate_type: string;
    aggregate_id: string;
    merchant_id?: string | null;
    branch_id?: string | null;
    payload?: Record<string, unknown>;
    idempotency_key?: string;
  }
): Promise<EventEnvelope> {
  const envelope: EventEnvelope = {
    event_id: randomUUID(),
    name: input.name,
    version: 1,
    timestamp: new Date().toISOString(),
    aggregate_type: input.aggregate_type,
    aggregate_id: input.aggregate_id,
    merchant_id: input.merchant_id ?? null,
    branch_id: input.branch_id ?? null,
    payload: input.payload ?? {},
    idempotency_key: input.idempotency_key ?? randomUUID()
  };
  await tx.backgroundJob.create({
    data: {
      job_type: "domain_event",
      payload: envelope as never,
      dedupe_key: envelope.event_id
    }
  });
  return envelope;
}

/** جدولة Job مؤجل (عداد القبول، No-show...) في نفس المعاملة */
export async function scheduleJob(
  tx: Prisma.TransactionClient,
  job_type: string,
  payload: Record<string, unknown>,
  run_at: Date,
  dedupe_key?: string
): Promise<void> {
  await tx.backgroundJob.create({
    data: {
      job_type,
      payload: payload as never,
      run_at,
      ...(dedupe_key ? { dedupe_key } : {})
    }
  });
}
