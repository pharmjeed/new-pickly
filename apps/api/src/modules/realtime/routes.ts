import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { Redis } from "ioredis";
import { verifyAccessToken } from "@pickly/auth";
import { prisma } from "@pickly/database";
import { createLogger } from "@pickly/observability";

/**
 * Realtime Gateway — docs/11§9:
 * قنوات نشر فقط؛ مصدر الحقيقة REST/DB (إعادة الاتصال تعيد الجلب — docs/09§6-4).
 * | order:{id}            | العميل صاحب الطلب  |
 * | branch:{id}:board     | فريق الفرع المعني   |
 * | merchant:{id}:alerts  | بوابة التاجر        |
 * | admin:live-ops        | الأدمن              |
 * النقل: WS ← Redis pub/sub (rt:*) — الناشر هو الـworker.
 */
const logger = createLogger("realtime");

type ChannelAuth =
  | { kind: "order"; id: string }
  | { kind: "branch"; id: string }
  | { kind: "merchant"; id: string }
  | { kind: "admin" };

function parseChannel(raw: string): ChannelAuth | null {
  const order = /^order:([0-9a-f-]{36})$/.exec(raw);
  if (order) return { kind: "order", id: order[1]! };
  const branch = /^branch:([0-9a-f-]{36}):board$/.exec(raw);
  if (branch) return { kind: "branch", id: branch[1]! };
  const merchant = /^merchant:([0-9a-f-]{36}):alerts$/.exec(raw);
  if (merchant) return { kind: "merchant", id: merchant[1]! };
  if (raw === "admin:live-ops") return { kind: "admin" };
  return null;
}

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const sub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });

  /** channel ← مجموعة sockets */
  const rooms = new Map<string, Set<{ send: (d: string) => void }>>();

  sub.on("pmessage", (_pattern, redisChannel, message) => {
    const channel = redisChannel.replace(/^rt:/, "");
    const room = rooms.get(channel);
    if (!room) return;
    for (const socket of room) {
      try {
        socket.send(message);
      } catch {
        /* socket ميت — سيُنظف عند close */
      }
    }
  });

  let subscribed = false;
  async function ensureSubscribed(): Promise<void> {
    if (subscribed) return;
    await sub.connect().catch(() => undefined);
    await sub.psubscribe("rt:*");
    subscribed = true;
    logger.info("realtime: مشترك في rt:*");
  }

  app.get("/realtime", { websocket: true }, async (socket, req) => {
    const q = req.query as { channel?: string; token?: string };
    const close = (code: number, reason: string) => {
      try {
        socket.close(code, reason);
      } catch {
        /* أُغلق */
      }
    };

    if (!q.channel || !q.token) return close(4400, "channel & token مطلوبان");
    const channel = parseChannel(q.channel);
    if (!channel) return close(4400, "قناة غير معروفة");

    // مصادقة + تخويل القناة (docs/16§3 — طبقتان)
    let claims;
    try {
      claims = verifyAccessToken(q.token);
    } catch {
      return close(4401, "توكن غير صالح");
    }
    const session = await prisma.userSession.findUnique({ where: { id: claims.session_id } });
    if (!session || session.revoked_at || session.expires_at < new Date()) {
      return close(4401, "جلسة منتهية");
    }

    if (channel.kind === "order") {
      const order = await prisma.order.findUnique({ where: { id: channel.id } });
      if (!order || order.user_id !== claims.sub) return close(4403, "ليس طلبك");
    } else if (channel.kind === "branch") {
      if (claims.actor_type !== "merchant_staff" || !claims.branch_ids?.includes(channel.id)) {
        return close(4403, "خارج نطاق فرعك");
      }
    } else if (channel.kind === "merchant") {
      if (claims.actor_type !== "merchant_staff" || claims.merchant_id !== channel.id) {
        return close(4403, "خارج نطاق تاجرك");
      }
    } else if (claims.actor_type !== "admin") {
      return close(4403, "للأدمن فقط");
    }

    await ensureSubscribed();
    const key = q.channel;
    let room = rooms.get(key);
    if (!room) {
      room = new Set();
      rooms.set(key, room);
    }
    const member = { send: (d: string) => socket.send(d) };
    room.add(member);
    socket.send(JSON.stringify({ type: "subscribed", channel: key }));

    socket.on("close", () => {
      room.delete(member);
      if (room.size === 0) rooms.delete(key);
    });
    // قناة نشر فقط — أي رسالة واردة تُتجاهل
  });
}
