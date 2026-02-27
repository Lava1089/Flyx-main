/**
 * Email service using Forward Email SMTP
 * https://forwardemail.net/en/guides/send-email-with-custom-domain-smtp
 * 
 * Forward Email SMTP Settings:
 * - Host: smtp.forwardemail.net
 * - Port: 465 (SSL) or 587 (TLS)
 * - Username: Your full email address (e.g., support@vynx.cc)
 * - Password: Your Forward Email generated password
 * 
 * Updated for Cloudflare Workers compatibility - uses btoa instead of Buffer
 */

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Email configuration from environment
// Forward Email API: https://forwardemail.net/en/email-api
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'support@vynx.cc';
const FROM_NAME = process.env.FROM_NAME || 'Vynx Support';

/**
 * Encode string to base64 (Cloudflare Workers compatible)
 */
function encodeBase64(str: string): string {
  // Use btoa which is available in both browsers and Cloudflare Workers
  // For non-ASCII characters, we need to encode to UTF-8 first
  try {
    return btoa(str);
  } catch {
    // Fallback for non-ASCII characters
    return btoa(unescape(encodeURIComponent(str)));
  }
}

/**
 * Send an email using Forward Email SMTP via fetch (Cloudflare Workers compatible)
 * Uses the Forward Email HTTP API as an alternative to SMTP
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const { to, subject, text, html, replyTo } = options;

  if (!SMTP_USER || !SMTP_PASS) {
    console.error('Email configuration missing: SMTP_USER or SMTP_PASS not set');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    // Forward Email supports sending via their HTTP API
    // https://forwardemail.net/en/email-api
    const response = await fetch('https://api.forwardemail.net/v1/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${encodeBase64(`${SMTP_USER}:${SMTP_PASS}`)}`,
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to,
        subject,
        text: text || '',
        html: html || '',
        ...(replyTo && { replyTo }),
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Forward Email API error:', response.status, errorData);
      return { success: false, error: `Email API error: ${response.status}` };
    }

    const result = await response.json();
    return { 
      success: true, 
      messageId: result.id || result.message_id 
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Send a feedback response email
 */
export async function sendFeedbackResponse(
  toEmail: string,
  originalMessage: string,
  responseMessage: string,
  feedbackType: string
): Promise<EmailResult> {
  const subject = `Re: Your ${feedbackType} feedback - Vynx`;
  
  const text = `Hi there,

Thank you for your feedback! Here's our response:

${responseMessage}

---
Your original message:
${originalMessage}

---
Best regards,
The Vynx Team

This email was sent from support@vynx.cc. Please don't reply directly to this email.`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Vynx Support</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin-top: 0;">Hi there,</p>
    <p>Thank you for your feedback! Here's our response:</p>
    
    <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; margin: 20px 0;">
      ${responseMessage.replace(/\n/g, '<br>')}
    </div>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    
    <p style="color: #6b7280; font-size: 14px;"><strong>Your original message:</strong></p>
    <div style="background: #f3f4f6; padding: 15px; border-radius: 6px; color: #6b7280; font-size: 14px;">
      ${originalMessage.replace(/\n/g, '<br>')}
    </div>
  </div>
  
  <div style="background: #1f2937; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #9ca3af; margin: 0; font-size: 12px;">
      Best regards,<br>
      <strong style="color: white;">The Vynx Team</strong>
    </p>
    <p style="color: #6b7280; margin: 10px 0 0; font-size: 11px;">
      This email was sent from support@vynx.cc
    </p>
  </div>
</body>
</html>`;

  return sendEmail({
    to: toEmail,
    subject,
    text,
    html,
  });
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!(SMTP_USER && SMTP_PASS);
}
