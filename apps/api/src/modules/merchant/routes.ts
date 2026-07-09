import type { FastifyInstance } from "fastify";
import {
  AcceptOrderBodySchema,
  BusyModeBodySchema,
  HandoffCompleteBodySchema,
  ItemIssueBodySchema,
  MerchantOrdersQuerySchema,
  RejectOrderBodySchema,
  UuidSchema
} from "@pickly/contracts";
import { z } from "zod";
import {
  assertBranchScope,
  idempotencyKeyOf,
  requireAuth,
  requireStaff
} from "../../lib/auth-plugin.js";
import { prisma } from "@pickly/database";
import { AppError } from "@pickly/observability";
import { MerchantOrderService } from "./service.js";

/**
 * docs/11§6 — أدوار docs/16§1:
 * قبول/رفض: مالك/مدراء/كاشير · KDS: + مطبخ · تسليم: + موظف تسليم
 */
const ACCEPT_ROLES = ["owner", "general_manager", "operations_manager", "branch_manager", "cashier"] as const;
const KDS_ROLES = [...ACCEPT_ROLES, "kitchen"] as const;
const HANDOFF_ROLES = ["owner", "general_manager", "operations_manager", "branch_manager", "cashier", "handoff"] as const;
const VIEW_ROLES = [...HANDOFF_ROLES, "kitchen"] as const;

export async function merchantRoutes(app: FastifyInstance): Promise<void> {
  const service = new MerchantOrderService();
  app.addHook("preHandler", requireAuth);

  const orderId = (req: { params: unknown }) =>
    UuidSchema.parse((req.params as { id: string }).id);

  /** نطاق فرع الطلب من التوكن — العزل طبقة ثانية داخل service */
  const branchIdsOf = (req: Parameters<typeof requireStaff>[0]): string[] => {
    const ids = req.claims?.branch_ids ?? [];
    if (ids.length === 0) throw new AppError("MERCHANT-7003");
    return ids;
  };

  app.get("/orders", async (req) => {
    const claims = requireStaff(req, VIEW_ROLES);
    const q = MerchantOrdersQuerySchema.parse(req.query);
    assertBranchScope(claims, q.branch_id);
    return service.list(q.branch_id, q.tab);
  });

  app.post("/orders/:id/accept", async (req) => {
    const claims = requireStaff(req, ACCEPT_ROLES);
    idempotencyKeyOf(req);
    const body = AcceptOrderBodySchema.parse(req.body ?? {});
    return service.accept(orderId(req), branchIdsOf(req), claims.sub, body.prep_time_override_minutes);
  });

  app.post("/orders/:id/reject", async (req) => {
    const claims = requireStaff(req, ACCEPT_ROLES);
    idempotencyKeyOf(req);
    const body = RejectOrderBodySchema.parse(req.body);
    return service.reject(orderId(req), branchIdsOf(req), claims.sub, body.reason);
  });

  app.post("/orders/:id/preparing", async (req) => {
    const claims = requireStaff(req, KDS_ROLES);
    return service.preparing(orderId(req), branchIdsOf(req), claims.sub);
  });

  app.post("/orders/:id/ready", async (req) => {
    const claims = requireStaff(req, KDS_ROLES);
    return service.ready(orderId(req), branchIdsOf(req), claims.sub);
  });

  app.post("/orders/:id/handoff/start", async (req) => {
    const claims = requireStaff(req, HANDOFF_ROLES);
    return service.handoffStart(orderId(req), branchIdsOf(req), claims.sub);
  });

  app.post("/orders/:id/handoff/complete", async (req) => {
    const claims = requireStaff(req, HANDOFF_ROLES);
    const body = HandoffCompleteBodySchema.parse(req.body);
    return service.handoffComplete(orderId(req), branchIdsOf(req), claims.sub, body.verification);
  });

  /** وضع الازدحام — مدير الفرع فما فوق (docs/16§1) */
  app.post("/branches/:id/busy-mode", async (req) => {
    const claims = requireStaff(req, ["owner", "general_manager", "operations_manager", "branch_manager"]);
    const branch_id = orderId(req); // نفس محلل الـUUID
    assertBranchScope(claims, branch_id);
    const body = BusyModeBodySchema.parse(req.body);
    return service.setBusyMode(branch_id, claims.sub, body);
  });

  /** نقص منتج — BR-4 */
  app.post("/orders/:id/item-issue", async (req) => {
    const claims = requireStaff(req, KDS_ROLES);
    const body = ItemIssueBodySchema.parse(req.body);
    return service.reportItemIssue(orderId(req), branchIdsOf(req), claims.sub, body);
  });

  app.get("/arrival-queue", async (req) => {
    const claims = requireStaff(req, VIEW_ROLES);
    const q = z.object({ branch_id: UuidSchema }).parse(req.query);
    assertBranchScope(claims, q.branch_id);
    return service.arrivalQueue(q.branch_id);
  });

  /** رمز التسليم لبطاقة الفرع — للتحقق البصري في KDS (يظهر للطلب النشط فقط) */
  app.get("/orders/:id/details", async (req) => {
    const claims = requireStaff(req, VIEW_ROLES);
    const id = orderId(req);
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: { include: { modifiers: true } } }
    });
    if (!order) throw new AppError("ORDER-4001");
    assertBranchScope(claims, order.branch_id);
    return {
      id: order.id,
      display_code: order.display_code,
      order_status: order.order_status,
      items: order.items.map((i) => ({
        id: i.id, // يتطلبه item-issue (BR-4) في KDS
        name_ar: i.name_ar_snapshot,
        quantity: i.quantity,
        modifiers: i.modifiers.map((m) => m.name_ar_snapshot),
        notes: i.notes
      })),
      customer_notes: order.customer_notes,
      parking_spot: order.parking_spot_label,
      vehicle_summary: order.vehicle_summary
    };
  });
}
