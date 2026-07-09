import { createLogger } from "@pickly/observability";
import nodemailer from "nodemailer";

/**
 * SMS خلف Adapter Interface — قاعدة الاستقلالية (برومبت البناء §1).
 * mock يعمل الآن بالكامل؛ production يُفعَّل بلصق المفاتيح (HUMAN-ACTIONS B2).
 */
export interface SmsAdapter {
  readonly provider: string;
  sendOtp(phone: string, code: string): Promise<{ ok: boolean; provider_ref?: string }>;
}

const logger = createLogger("sms");

/** Mock: يطبع الرمز في اللوج ويرسله إلى Mailhog (localhost:8025) ليُرى كرسالة */
export class MockSmsAdapter implements SmsAdapter {
  readonly provider = "mock";
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false
  });

  async sendOtp(phone: string, code: string): Promise<{ ok: boolean; provider_ref?: string }> {
    logger.info({ phone, otp: code }, "[MOCK SMS] رمز التحقق");
    try {
      const info = await this.transporter.sendMail({
        from: "otp@pickly.local",
        to: `${phone.replace("+", "")}@sms.pickly.local`,
        subject: `رمز بيكلي: ${code}`,
        text: `رمز التحقق الخاص بك في بيكلي: ${code}\nصالح لخمس دقائق.`
      });
      return info.messageId ? { ok: true, provider_ref: info.messageId } : { ok: true };
    } catch {
      // Mailhog غير شغال؟ الرمز في اللوج يكفي للتطوير — لا نُفشل التدفق
      return { ok: true };
    }
  }
}

/** Unifonic — هيكل جاهز، يُفعَّل بـSMS_PROVIDER=unifonic + مفتاح (HUMAN-ACTIONS B2) */
export class UnifonicSmsAdapter implements SmsAdapter {
  readonly provider = "unifonic";
  constructor(
    private apiKey: string,
    private senderName: string
  ) {}

  async sendOtp(phone: string, code: string): Promise<{ ok: boolean; provider_ref?: string }> {
    const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        AppSid: this.apiKey,
        SenderID: this.senderName,
        Recipient: phone.replace("+", ""),
        Body: `رمز التحقق الخاص بك في بيكلي: ${code}`
      })
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "unifonic send failed");
      return { ok: false };
    }
    const body = (await res.json()) as { data?: { MessageID?: string } };
    const ref = body.data?.MessageID;
    return ref ? { ok: true, provider_ref: ref } : { ok: true };
  }
}

export function createSmsAdapter(): SmsAdapter {
  const provider = process.env.SMS_PROVIDER ?? "mock";
  switch (provider) {
    case "unifonic": {
      const key = process.env.SMS_API_KEY;
      if (!key) throw new Error("SMS_API_KEY مطلوب مع SMS_PROVIDER=unifonic");
      return new UnifonicSmsAdapter(key, process.env.SMS_SENDER_NAME ?? "Pickly");
    }
    case "mock":
    default:
      return new MockSmsAdapter();
  }
}
