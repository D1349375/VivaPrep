export class EmailDelivery {
  constructor({ mode, webhookUrl, webhookKey, publicUrl }) {
    this.mode = mode;
    this.webhookUrl = webhookUrl;
    this.webhookKey = webhookKey;
    this.publicUrl = publicUrl.replace(/\/$/, "");
  }

  get developmentLinksEnabled() {
    return this.mode === "console";
  }

  async sendActionLink({ email, purpose, token }) {
    const action = purpose === "email_verify" ? "verify-email" : purpose === "deletion_cancel" ? "cancel-deletion" : "reset-password";
    const url = `${this.publicUrl}/${action}?token=${encodeURIComponent(token)}`;
    const subject = purpose === "email_verify" ? "驗證 VivaPrep 電子郵件" : purpose === "deletion_cancel" ? "取消 VivaPrep 帳號刪除" : "重設 VivaPrep 密碼";
    const text = `請開啟以下連結完成${purpose === "email_verify" ? "電子郵件驗證" : purpose === "deletion_cancel" ? "取消帳號刪除申請" : "密碼重設"}：\n${url}\n\n如果不是你提出的要求，請忽略這封信。`;

    if (this.mode === "console") {
      process.stdout.write(`[local email preview]\n${subject}\n${url}\n`);
      return { developmentUrl: url };
    }
    if (this.mode !== "webhook" || !this.webhookUrl || !this.webhookKey) {
      throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED", status: 503 });
    }

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.webhookKey}` },
      body: JSON.stringify({ to: email, subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: "EMAIL_DELIVERY_FAILED", status: 503 });
    return { developmentUrl: null };
  }
}
