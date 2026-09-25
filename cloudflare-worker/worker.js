import * as PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    console.log(`\n\n--- [WORKER INCOMING EMAIL] ---`);
    console.log(`Received email from: ${message.from}`);
    console.log(`Received email to: ${message.to}`);

    const parser = new PostalMime.default();
    const rawEmail = new Response(message.raw);
    const email = await parser.parse(await rawEmail.arrayBuffer());

    // Check if this is a bounce notification
    if (isBounceNotification(email)) {
      console.log(`[WORKER] Message identified as a bounce notification.`);
      const bounceInfo = await parseBounceInfo(email);
      console.log(`[WORKER] Bounce successfully parsed:`, JSON.stringify(bounceInfo));

      // Where the app's bounce webhook lives, e.g. https://your-app.example.com/api/webhooks/bounce.
      // Deliberately no fallback: a default would send bounce data to someone else's server.
      const webhookUrl = env.BOUNCE_WEBHOOK_URL;
      if (bounceInfo.originalRecipient && !webhookUrl) {
        console.error('[WORKER] BOUNCE_WEBHOOK_URL is not set; bounce not recorded.');
      } else if (bounceInfo.originalRecipient) {
        // Send the bounce event to the app's bounce webhook
        const webhookSecret = env.WEBHOOK_SECRET;
        console.log(`[WORKER] Dispatching to webhook URL: ${webhookUrl}`);

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(webhookSecret ? { 'Authorization': `Bearer ${webhookSecret}` } : {})
            },
            body: JSON.stringify({
              email: bounceInfo.originalRecipient,
              type: bounceInfo.type,
              reason: bounceInfo.reason,
              campaignId: bounceInfo.campaignId
            })
          });
          console.log(`[WORKER] Webhook response status: ${response.status} ${response.statusText}`);
          const responseText = await response.text();
          console.log(`[WORKER] Webhook response body: ${responseText}`);
        } catch (error) {
          console.error('[WORKER] Failed to send bounce to backend:', error);
        }
      } else {
        console.log(`[WORKER] Failed to parse bounce info from email content.`);
      }

      // Drop the bounce email so it doesn't clutter the admin inbox
      console.log(`[WORKER] Dropping bounce email to prevent inbox clutter.`);
      return;
    }

    // Forward non-bounce emails (like out-of-office replies) to the admin inbox
    console.log(`[WORKER] Message is NOT a bounce. Forwarding to: ${message.to}`);
    await message.forward(message.to);
  },
};

function isBounceNotification(email) {
  const subject = email.subject?.toLowerCase() || "";
  const fromAddress = email.from?.address?.toLowerCase() || "";

  const bounceSubjects = [
    "mail delivery failed",
    "undelivered mail returned to sender",
    "delivery status notification",
    "returned mail",
    "mail system error",
  ];

  const bounceFromPatterns = [
    "mailer-daemon",
    "mail-daemon",
    "postmaster",
    "noreply",
    "bounce",
  ];

  return (
    bounceSubjects.some((phrase) => subject.includes(phrase)) ||
    bounceFromPatterns.some((pattern) => fromAddress.includes(pattern))
  );
}

async function parseBounceInfo(email) {
  const text = email.text || "";
  const html = email.html || "";
  const content = text + " " + html;

  // Extract original recipient email
  const recipientMatch =
    content.match(/(?:to|for|recipient):\s*([^<>\s]+@[^<>\s]+)/i) ||
    content.match(/([^<>\s]+@[^<>\s]+)/);

  const originalRecipient = recipientMatch ? recipientMatch[1].trim() : null;

  // Extract Campaign ID if it was injected into the headers
  let campaignId = null;

  // Method 1: Look for X-Campaign-ID in attached original headers
  // Bounces typically include original headers in the text body or as an attachment
  const campaignIdMatch = content.match(/X-Campaign-ID:\s*(\d+)/i);
  if (campaignIdMatch) {
    campaignId = campaignIdMatch[1];
  } else {
    // Method 2: Look for Message-ID containing the campaign ID
    // e.g. Message-ID: <cf-...> if we had encoded it, but we used custom headers
  }

  // Determine bounce type based on content
  const hardBounceIndicators = [
    "user unknown",
    "no such user",
    "invalid recipient",
    "recipient address rejected",
    "mailbox unavailable",
    "domain not found",
    "5.1.1", // SMTP error code for bad destination mailbox
    "5.1.2", // SMTP error code for bad destination system
    "5.4.1", // SMTP error code for no answer from host
  ];

  const isHardBounce = hardBounceIndicators.some((indicator) =>
    content.toLowerCase().includes(indicator.toLowerCase()),
  );

  return {
    type: isHardBounce ? "hard" : "soft",
    originalRecipient,
    campaignId,
    reason: extractBounceReason(content),
    timestamp: new Date().toISOString(),
  };
}

function extractBounceReason(content) {
  const reasonPatterns = [
    /diagnostic[- ]code:\s*(.+)/i,
    /reason:\s*(.+)/i,
    /error:\s*(.+)/i,
    /(5\.\d+\.\d+[^.\n]*)/i,
  ];

  for (const pattern of reasonPatterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim().split('\n')[0];
    }
  }

  return "Unknown bounce reason";
}
