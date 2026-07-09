import { prisma, type OtpRequest, type User, type UserSession } from "@pickly/database";

/**
 * وحدة Authentication — طبقة Repository (بنية الوحدة الإلزامية docs/09§4).
 * لا استعلام خارج هذه الطبقة.
 */
export const authRepository = {
  countRecentOtpRequests(phone: string, windowSeconds: number): Promise<number> {
    return prisma.otpRequest.count({
      where: {
        phone,
        created_at: { gte: new Date(Date.now() - windowSeconds * 1000) }
      }
    });
  },

  createOtpRequest(data: {
    phone: string;
    code_hash: string;
    expires_at: Date;
    request_ip?: string;
  }): Promise<OtpRequest> {
    return prisma.otpRequest.create({ data });
  },

  findLatestActiveOtp(phone: string): Promise<OtpRequest | null> {
    return prisma.otpRequest.findFirst({
      where: { phone, consumed_at: null, expires_at: { gte: new Date() } },
      orderBy: { created_at: "desc" }
    });
  },

  incrementOtpAttempts(id: string): Promise<OtpRequest> {
    return prisma.otpRequest.update({
      where: { id },
      data: { attempts: { increment: 1 } }
    });
  },

  consumeOtp(id: string): Promise<OtpRequest> {
    return prisma.otpRequest.update({
      where: { id },
      data: { consumed_at: new Date() }
    });
  },

  findUserByPhone(phone: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { phone } });
  },

  createCustomer(phone: string): Promise<User> {
    return prisma.user.create({
      data: { phone, customer_profile: { create: {} } }
    });
  },

  getUserRoles(user_id: string): Promise<Array<{ role_key: string; merchant_id: string | null }>> {
    return prisma.userRole
      .findMany({ where: { user_id }, include: { role: true } })
      .then((rows) =>
        rows.map((r) => ({ role_key: r.role.key, merchant_id: r.merchant_id }))
      );
  },

  createSession(data: {
    user_id: string;
    refresh_token_hash: string;
    expires_at: Date;
    ip?: string;
    user_agent?: string;
  }): Promise<UserSession> {
    return prisma.userSession.create({ data });
  },

  findSessionByRefreshHash(hash: string): Promise<UserSession | null> {
    return prisma.userSession.findUnique({ where: { refresh_token_hash: hash } });
  },

  rotateSession(id: string, newHash: string, expires_at: Date): Promise<UserSession> {
    return prisma.userSession.update({
      where: { id },
      data: { refresh_token_hash: newHash, expires_at }
    });
  },

  revokeSession(id: string): Promise<UserSession> {
    return prisma.userSession.update({
      where: { id },
      data: { revoked_at: new Date() }
    });
  }
};

export type AuthRepository = typeof authRepository;
