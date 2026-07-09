import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_SECONDS,
  createSmsAdapter,
  generateOtpCode,
  generateRefreshToken,
  hashOtp,
  hashRefreshToken,
  signAccessToken,
  verifyOtpHash,
  type SmsAdapter
} from "@pickly/auth";
import type { TokenPair } from "@pickly/contracts";
import { AppError } from "@pickly/observability";
import { authRepository, type AuthRepository } from "./repository.js";

/** حدود BR-13: OTP بحد محاولات وRate Limiting */
const OTP_RATE_WINDOW_SECONDS = 3600;
const OTP_RATE_MAX_PER_WINDOW = 5;

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

export class AuthService {
  constructor(
    private repo: AuthRepository = authRepository,
    private sms: SmsAdapter = createSmsAdapter()
  ) {}

  async requestOtp(phone: string, ip?: string): Promise<{ request_id: string; retry_after_seconds: number }> {
    const recent = await this.repo.countRecentOtpRequests(phone, OTP_RATE_WINDOW_SECONDS);
    if (recent >= OTP_RATE_MAX_PER_WINDOW) {
      throw new AppError("AUTH-1004");
    }

    const code = generateOtpCode();
    const req = await this.repo.createOtpRequest({
      phone,
      code_hash: hashOtp(code),
      expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      ...(ip ? { request_ip: ip } : {})
    });

    await this.sms.sendOtp(phone, code);
    return { request_id: req.id, retry_after_seconds: OTP_RESEND_SECONDS };
  }

  async verifyOtp(phone: string, code: string, meta?: { ip?: string; user_agent?: string }): Promise<TokenPair> {
    const otp = await this.repo.findLatestActiveOtp(phone);
    if (!otp) throw new AppError("AUTH-1003");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError("AUTH-1004");

    if (!verifyOtpHash(code, otp.code_hash)) {
      await this.repo.incrementOtpAttempts(otp.id);
      throw new AppError("AUTH-1002");
    }
    await this.repo.consumeOtp(otp.id);

    let user = await this.repo.findUserByPhone(phone);
    const is_new_user = !user;
    user ??= await this.repo.createCustomer(phone);
    if (user.status === "blocked") throw new AppError("AUTH-1007");

    return this.issueTokens(user.id, is_new_user, meta);
  }

  private async issueTokens(
    user_id: string,
    is_new_user: boolean,
    meta?: { ip?: string; user_agent?: string }
  ): Promise<TokenPair> {
    const roles = await this.repo.getUserRoles(user_id);
    const refresh_token = generateRefreshToken();
    const session = await this.repo.createSession({
      user_id,
      refresh_token_hash: hashRefreshToken(refresh_token),
      expires_at: new Date(Date.now() + REFRESH_TTL_MS),
      ...(meta?.ip ? { ip: meta.ip } : {}),
      ...(meta?.user_agent ? { user_agent: meta.user_agent } : {})
    });

    const merchantRole = roles.find((r) => r.role_key.startsWith("merchant:"));
    const isAdmin = roles.some((r) => r.role_key.startsWith("admin:"));

    const access_token = signAccessToken({
      sub: user_id,
      actor_type: isAdmin ? "admin" : merchantRole ? "merchant_staff" : "customer",
      session_id: session.id,
      ...(merchantRole?.merchant_id ? { merchant_id: merchantRole.merchant_id } : {}),
      roles: roles.map((r) => r.role_key)
    });

    return { access_token, refresh_token, is_new_user };
  }

  async refresh(refresh_token: string): Promise<TokenPair> {
    const session = await this.repo.findSessionByRefreshHash(hashRefreshToken(refresh_token));
    if (!session || session.revoked_at || session.expires_at < new Date()) {
      throw new AppError("AUTH-1005");
    }
    // تدوير التوكن — الجلسة نفسها تبقى (قابلة للإلغاء من مكان واحد)
    const newToken = generateRefreshToken();
    await this.repo.rotateSession(
      session.id,
      hashRefreshToken(newToken),
      new Date(Date.now() + REFRESH_TTL_MS)
    );
    const roles = await this.repo.getUserRoles(session.user_id);
    const merchantRole = roles.find((r) => r.role_key.startsWith("merchant:"));
    const isAdmin = roles.some((r) => r.role_key.startsWith("admin:"));
    const access_token = signAccessToken({
      sub: session.user_id,
      actor_type: isAdmin ? "admin" : merchantRole ? "merchant_staff" : "customer",
      session_id: session.id,
      ...(merchantRole?.merchant_id ? { merchant_id: merchantRole.merchant_id } : {}),
      roles: roles.map((r) => r.role_key)
    });
    return { access_token, refresh_token: newToken, is_new_user: false };
  }

  async logout(session_id: string): Promise<void> {
    await this.repo.revokeSession(session_id);
  }
}
