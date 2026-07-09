import { createLogger } from "@pickly/observability";

/**
 * Push خلف Adapter — docs/15 (FCM/APNs).
 * mock: يسجل في اللوج ويعيد نجاحاً — التسليم يُتتبع في notification_deliveries.
 */

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushAdapter {
  readonly provider: string;
  send(msg: PushMessage): Promise<{ ok: boolean; provider_ref?: string; error?: string }>;
}

const logger = createLogger("push");

export class MockPushAdapter implements PushAdapter {
  readonly provider = "mock";
  /** سجل داخلي تقرؤه الاختبارات للتحقق من بث الإشعارات */
  readonly sent: PushMessage[] = [];

  async send(msg: PushMessage): Promise<{ ok: boolean; provider_ref?: string }> {
    this.sent.push(msg);
    logger.info({ token: msg.token.slice(0, 12), title: msg.title }, "[MOCK PUSH]");
    return { ok: true, provider_ref: `mock_push_${this.sent.length}` };
  }
}

export class FcmPushAdapter implements PushAdapter {
  readonly provider = "fcm";
  constructor(private serviceAccountJson: string) {
    void this.serviceAccountJson;
  }

  async send(_msg: PushMessage): Promise<{ ok: boolean; error?: string }> {
    // يُستكمل مع firebase-admin عند لصق FCM_SERVICE_ACCOUNT_JSON (HUMAN-ACTIONS B3)
    throw new Error("FCM يتطلب FCM_SERVICE_ACCOUNT_JSON — راجع HUMAN-ACTIONS.md B3");
  }
}

export function createPushAdapter(): PushAdapter {
  const provider = process.env.PUSH_PROVIDER ?? "mock";
  switch (provider) {
    case "fcm": {
      const sa = process.env.FCM_SERVICE_ACCOUNT_JSON;
      if (!sa) throw new Error("FCM_SERVICE_ACCOUNT_JSON مطلوب مع PUSH_PROVIDER=fcm");
      return new FcmPushAdapter(sa);
    }
    case "mock":
    default:
      return new MockPushAdapter();
  }
}
