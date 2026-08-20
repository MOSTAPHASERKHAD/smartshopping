/**
 * Smart Shopping — Email Provider Abstraction
 * ملف: src/utils/email.js
 * 
 * واجهة تجريدية لإرسال رسائل التأكيد واستعادة كلمات المرور
 * تدعم بيئة التطوير والاختبار (Mock) ومزودات الإنتاج (Resend / SendGrid / SMTP)
 */

export class EmailProvider {
  /**
   * إرسال رسالة تأكيد البريد الإلكتروني للتاجر
   * @returns {Promise<{ delivered: boolean, status: string, provider: string }>}
   */
  static async sendVerificationEmail({ to, token, tenantName = 'Smart Shopping', baseUrl = 'https://smartshopping.click', env = {} }) {
    const verifyUrl = `${baseUrl}/admin.html?action=verify_email&token=${token}`;
    
    // في حالة وجود مفتاح Resend في secrets
    if (env && env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM || 'SmartKiosk <noreply@smartshopping.click>',
            to: [to],
            subject: `تأكيد بريدك الإلكتروني - ${tenantName}`,
            html: `
              <div dir="rtl" style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #333;">مرحباً بك في ${tenantName}</h2>
                <p>يرجى النقر على الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${verifyUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">تأكيد البريد الإلكتروني</a>
                </div>
                <p style="color: #666; font-size: 14px;">أو انسخ الرابط التالي إلى متصفحك:</p>
                <p style="word-break: break-all; color: #2563eb; font-size: 13px;">${verifyUrl}</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="color: #999; font-size: 12px;">هذا الرابط صالح لمدة 24 ساعة فقط.</p>
              </div>
            `,
          })
        });
        if (res.ok) {
          return { delivered: true, status: 'DELIVERED', provider: 'resend' };
        }
        console.error('[Email Error] Resend API returned error status:', res.status);
        return { delivered: false, status: 'PROVIDER_ERROR', provider: 'resend' };
      } catch (e) {
        console.error('[Email Error] Failed to send via Resend transport');
        return { delivered: false, status: 'DISPATCH_ERROR', provider: 'resend' };
      }
    }

    // Mock / Local Fallback عندما لا يكون مزود البريد مهيأ
    if (env && env.ENVIRONMENT !== 'production') {
      console.log(`[Email Mock] Verification email to: ${to} | URL: ${verifyUrl}`);
    } else {
      console.warn('[Email Warning] RESEND_API_KEY is not configured in Worker secrets. Email delivery skipped.');
    }
    return { delivered: false, status: 'EMAIL_PROVIDER_UNCONFIGURED', provider: 'mock' };
  }

  /**
   * إرسال رسالة استعادة كلمة المرور
   * @returns {Promise<{ delivered: boolean, status: string, provider: string }>}
   */
  static async sendPasswordResetEmail({ to, token, tenantName = 'Smart Shopping', baseUrl = 'https://smartshopping.click', env = {} }) {
    const resetUrl = `${baseUrl}/admin.html?action=reset_password&token=${token}`;

    if (env && env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM || 'SmartKiosk <noreply@smartshopping.click>',
            to: [to],
            subject: `استعادة كلمة المرور - ${tenantName}`,
            html: `
              <div dir="rtl" style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #333;">استعادة كلمة المرور لـ ${tenantName}</h2>
                <p>تلقينا طلباً لاستعادة كلمة المرور الخاصة بحسابك. انقر على الزر أدناه لتعيين كلمة مرور جديدة:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${resetUrl}" style="background-color: #e11d48; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">إعادة تعيين كلمة المرور</a>
                </div>
                <p style="color: #666; font-size: 14px;">أو انسخ الرابط التالي إلى متصفحك:</p>
                <p style="word-break: break-all; color: #e11d48; font-size: 13px;">${resetUrl}</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="color: #999; font-size: 12px;">هذا الرابط صالح لمدة 30 دقيقة فقط ويمكن استخدامه لمرة واحدة.</p>
              </div>
            `,
          })
        });
        if (res.ok) {
          return { delivered: true, status: 'DELIVERED', provider: 'resend' };
        }
        console.error('[Email Error] Resend API returned error status:', res.status);
        return { delivered: false, status: 'PROVIDER_ERROR', provider: 'resend' };
      } catch (e) {
        console.error('[Email Error] Failed to send via Resend transport');
        return { delivered: false, status: 'DISPATCH_ERROR', provider: 'resend' };
      }
    }

    // Mock / Local Fallback عندما لا يكون مزود البريد مهيأ
    if (env && env.ENVIRONMENT !== 'production') {
      console.log(`[Email Mock] Password reset email to: ${to} | URL: ${resetUrl}`);
    } else {
      console.warn('[Email Warning] RESEND_API_KEY is not configured in Worker secrets. Password reset email delivery skipped.');
    }
    return { delivered: false, status: 'EMAIL_PROVIDER_UNCONFIGURED', provider: 'mock' };
  }

  /**
   * إرسال رسالة تأكيد الطلب للعميل
   * @returns {Promise<{ delivered: boolean, status: string, provider: string }>}
   */
  static async sendOrderConfirmationEmail({ to, orderId, customerName, items, total, shippingNote, env = {} }) {
    if (env && env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM || 'SmartShopping <noreply@smartshopping.click>',
            to: [to],
            subject: `تأكيد طلبك من SmartShopping — ${orderId}`,
            html: `
              <div dir="rtl" style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #333;">مرحباً ${customerName}،</h2>
                <p>شكراً لطلبك من SmartShopping.</p>
                <p>تم استلام طلبك بنجاح.</p>
                <p><strong>رقم الطلب:</strong><br>${orderId}</p>
                <p><strong>المنتجات:</strong><br>${items}</p>
                <p><strong>المجموع:</strong><br>${total} دج</p>
                <p><strong>ملاحظة التوصيل:</strong><br>${shippingNote}</p>
                <p>سنقوم بالتواصل معك لتأكيد الطلب والتوصيل.</p>
                <p>شكراً لثقتك بنا.</p>
                <p><strong>SmartShopping</strong><br><a href="https://smartshopping.click" style="color: #2563eb;">smartshopping.click</a></p>
              </div>
            `,
          })
        });
        if (res.ok) {
          return { delivered: true, status: 'DELIVERED', provider: 'resend' };
        }
        console.error('[Email Error] Resend API returned error status for order confirmation:', res.status);
        return { delivered: false, status: 'PROVIDER_ERROR', provider: 'resend' };
      } catch (e) {
        console.error('[Email Error] Failed to send order confirmation via Resend transport');
        return { delivered: false, status: 'DISPATCH_ERROR', provider: 'resend' };
      }
    }

    // Mock / Local Fallback عندما لا يكون مزود البريد مهيأ
    if (env && env.ENVIRONMENT !== 'production') {
      console.log(`[Email Mock] Order confirmation email to: ${to} | Order ID: ${orderId}`);
    } else {
      console.warn('[Email Warning] RESEND_API_KEY is not configured. Order confirmation email skipped.');
    }
    return { delivered: false, status: 'EMAIL_PROVIDER_UNCONFIGURED', provider: 'mock' };
  }
}
