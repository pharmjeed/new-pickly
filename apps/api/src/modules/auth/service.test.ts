import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtp } from "@pickly/auth";
import type { AuthRepository } from "./repository.js";
import { AuthService } from "./service.js";

process.env.JWT_SECRET = "test-secret";

function makeRepo(overrides: Partial<AuthRepository> = {}): AuthRepository {
  const base: AuthRepository = {
    countRecentOtpRequests: vi.fn().mockResolvedValue(0),
    createOtpRequest: vi.fn().mockResolvedValue({ id: "otp-1" }),
    findLatestActiveOtp: vi.fn().mockResolvedValue(null),
    incrementOtpAttempts: vi.fn().mockResolvedValue({}),
    consumeOtp: vi.fn().mockResolvedValue({}),
    findUserByPhone: vi.fn().mockResolvedValue(null),
    createCustomer: vi.fn().mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "active"
    }),
    getUserRoles: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222"
    }),
    findSessionByRefreshHash: vi.fn().mockResolvedValue(null),
    rotateSession: vi.fn().mockResolvedValue({}),
    revokeSession: vi.fn().mockResolvedValue({})
  } as unknown as AuthRepository;
  return Object.assign(base, overrides);
}

const mockSms = { provider: "mock", sendOtp: vi.fn().mockResolvedValue({ ok: true }) };

describe("AuthService — OTP (BR-13)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("يرسل OTP ويعيد request_id", async () => {
    const repo = makeRepo();
    const service = new AuthService(repo, mockSms);
    const res = await service.requestOtp("+966500000001");
    expect(res.request_id).toBe("otp-1");
    expect(mockSms.sendOtp).toHaveBeenCalledOnce();
  });

  it("يرفض بعد تجاوز حد الإرسال (Rate Limiting)", async () => {
    const repo = makeRepo({
      countRecentOtpRequests: vi.fn().mockResolvedValue(5)
    } as Partial<AuthRepository>);
    const service = new AuthService(repo, mockSms);
    await expect(service.requestOtp("+966500000001")).rejects.toMatchObject({
      code: "AUTH-1004"
    });
  });

  it("رمز صحيح ← مستخدم جديد + توكنات", async () => {
    const repo = makeRepo({
      findLatestActiveOtp: vi.fn().mockResolvedValue({
        id: "otp-1",
        attempts: 0,
        code_hash: hashOtp("1234")
      })
    } as Partial<AuthRepository>);
    const service = new AuthService(repo, mockSms);
    const res = await service.verifyOtp("+966500000001", "1234");
    expect(res.is_new_user).toBe(true);
    expect(res.access_token).toBeTruthy();
    expect(res.refresh_token).toBeTruthy();
  });

  it("رمز خاطئ ← AUTH-1002 وزيادة المحاولات", async () => {
    const increment = vi.fn().mockResolvedValue({});
    const repo = makeRepo({
      findLatestActiveOtp: vi.fn().mockResolvedValue({
        id: "otp-1",
        attempts: 0,
        code_hash: hashOtp("1234")
      }),
      incrementOtpAttempts: increment
    } as Partial<AuthRepository>);
    const service = new AuthService(repo, mockSms);
    await expect(service.verifyOtp("+966500000001", "9999")).rejects.toMatchObject({
      code: "AUTH-1002"
    });
    expect(increment).toHaveBeenCalledOnce();
  });

  it("تجاوز حد المحاولات ← AUTH-1004 حتى برمز صحيح", async () => {
    const repo = makeRepo({
      findLatestActiveOtp: vi.fn().mockResolvedValue({
        id: "otp-1",
        attempts: 5,
        code_hash: hashOtp("1234")
      })
    } as Partial<AuthRepository>);
    const service = new AuthService(repo, mockSms);
    await expect(service.verifyOtp("+966500000001", "1234")).rejects.toMatchObject({
      code: "AUTH-1004"
    });
  });

  it("لا OTP نشط ← AUTH-1003", async () => {
    const service = new AuthService(makeRepo(), mockSms);
    await expect(service.verifyOtp("+966500000001", "1234")).rejects.toMatchObject({
      code: "AUTH-1003"
    });
  });

  it("حساب محظور ← AUTH-1007", async () => {
    const repo = makeRepo({
      findLatestActiveOtp: vi.fn().mockResolvedValue({
        id: "otp-1",
        attempts: 0,
        code_hash: hashOtp("1234")
      }),
      findUserByPhone: vi.fn().mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        status: "blocked"
      })
    } as Partial<AuthRepository>);
    const service = new AuthService(repo, mockSms);
    await expect(service.verifyOtp("+966500000001", "1234")).rejects.toMatchObject({
      code: "AUTH-1007"
    });
  });

  it("refresh بجلسة ملغاة ← AUTH-1005", async () => {
    const repo = makeRepo({
      findSessionByRefreshHash: vi.fn().mockResolvedValue({
        id: "s1",
        revoked_at: new Date(),
        expires_at: new Date(Date.now() + 1000)
      })
    } as Partial<AuthRepository>);
    const service = new AuthService(repo, mockSms);
    await expect(service.refresh("token")).rejects.toMatchObject({ code: "AUTH-1005" });
  });
});
