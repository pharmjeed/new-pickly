import type { FastifyInstance } from "fastify";
import {
  BranchLoginBodySchema,
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  RefreshBodySchema
} from "@pickly/contracts";
import { verifyAccessToken } from "@pickly/auth";
import { AppError } from "@pickly/observability";
import { AuthService } from "./service.js";

/** docs/11§1 — POST otp/request · otp/verify · refresh · logout */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const service = new AuthService();

  app.post("/otp/request", async (req) => {
    const body = OtpRequestBodySchema.parse(req.body);
    return service.requestOtp(body.phone, req.ip);
  });

  app.post("/otp/verify", async (req) => {
    const body = OtpVerifyBodySchema.parse(req.body);
    return service.verifyOtp(body.phone, body.code, {
      ip: req.ip,
      ...(req.headers["user-agent"] ? { user_agent: req.headers["user-agent"] } : {})
    });
  });

  app.post("/branch/login", async (req) => {
    const body = BranchLoginBodySchema.parse(req.body);
    return service.branchLogin(body);
  });

  app.post("/refresh", async (req) => {
    const body = RefreshBodySchema.parse(req.body);
    return service.refresh(body.refresh_token);
  });

  app.post("/logout", async (req, reply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("AUTH-1005");
    let claims;
    try {
      claims = verifyAccessToken(header.slice(7));
    } catch {
      throw new AppError("AUTH-1005");
    }
    await service.logout(claims.session_id);
    return reply.status(204).send();
  });
}
