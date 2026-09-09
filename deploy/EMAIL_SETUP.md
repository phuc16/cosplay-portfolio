# Setting up support@ and no-reply@ on Zoho Mail

Sets up transactional email for the shop (order confirmations, pickup
codes, etc. - sent via `backend/shop/email/sender.js`) using Zoho Mail's
free tier: one real mailbox (`support@kamidayhehe.com`) plus a free alias
(`no-reply@kamidayhehe.com`) on the same domain, no paid plan required.

Free-tier limits to know going in: 50 emails/day, webmail/mobile app only
(no IMAP/POP, so `support@` can't be checked from Outlook/Apple Mail/
Thunderbird - only zoho.com's own webmail and their mobile app). If either
limit becomes a problem later, Zoho's Mail Lite plan (~$1/user/month) lifts
both.

## 1. Confirm the domain

Make sure `kamidayhehe.com` is registered and you know where its DNS is
managed (your registrar's own DNS panel, or Cloudflare, etc. - you'll need
to add TXT/MX records there in step 3).

## 2. Sign up for Zoho Mail

- Go to [zoho.com/mail](https://www.zoho.com/mail/) → sign up → choose the
  **Free Plan** (labeled "Forever Free" in some flows) when prompted for a
  plan tier.
- Enter `kamidayhehe.com` as your domain.
- Create your first mailbox: `support@kamidayhehe.com`. This becomes your
  Zoho admin account for the domain.

## 3. Verify domain ownership + add mail DNS records

Zoho's setup wizard walks through this and gives you the exact values to
copy - generally:

- **Domain verification**: a TXT record (or an HTML file upload / CNAME,
  Zoho offers a few methods - TXT is simplest) proving you control the
  domain. Add it at your DNS provider, then click "Verify" in Zoho.
- **MX records**: point to Zoho's mail servers (`mx.zoho.com`,
  `mx2.zoho.com`, `mx3.zoho.com` with the priorities Zoho's wizard shows) -
  this is what makes Zoho actually receive mail for the domain.
- **SPF**: a TXT record (`v=spf1 include:zoho.com ~all`) - prevents your
  mail from being flagged as spam/spoofed.
- **DKIM** (strongly recommended, improves deliverability): Zoho admin
  console → Mail Administration → your domain → Email Authentication → DKIM
  → generate a key → add the TXT record it gives you.

DNS changes can take anywhere from a few minutes to a few hours to
propagate - don't panic if verification doesn't succeed instantly.

## 4. Create the no-reply@ alias

In the Zoho Mail Admin Console → **Users** → click on `support@`'s user →
**Email Aliases** tab → add `no-reply@kamidayhehe.com` as an alias. This
costs nothing extra (still one mailbox, one free-tier seat) - mail sent
*as* `no-reply@` lands in the same `support@` inbox, and mail sent *from*
`no-reply@` (as this backend will do) doesn't need its own separate login.

## 5. Turn on SMTP (app-specific password)

- Sign in to `support@kamidayhehe.com`'s Zoho account.
- Enable Two-Factor Authentication if not already on (Zoho requires it for
  app-specific passwords): Zoho Account → Security → Two-Factor
  Authentication.
- Go to Zoho Account → Security → **App Passwords** → generate a new one
  (name it e.g. "cosplay-shop-smtp") → copy the password shown once, you
  won't see it again.

## 6. Set the env vars

This project's SMTP config (`.env.example`) is:

```
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=support@kamidayhehe.com
SMTP_PASS=<the app-specific password from step 5>
SMTP_FROM=no-reply@kamidayhehe.com
```

`SMTP_USER` is the real mailbox that authenticates the connection;
`SMTP_FROM` is the alias every automated email appears to come *from* - this
already works today with a single `SMTP_FROM` value, no code change needed
for this part.

(If you're outside certain regions, Zoho may assign a region-specific SMTP
host instead of `smtp.zoho.com`, e.g. `smtp.zoho.eu` or `smtp.zoho.in` -
check your Zoho Mail region under Account → Organization Profile if
`smtp.zoho.com` doesn't authenticate.)

## 7. Deploy

Update these on the DigitalOcean droplet's `.env` (see `deploy/DEPLOY.md`)
and restart the backend container:

```bash
docker exec all-in-one supervisorctl restart backend
```

## 8. Verify it works

Place a test order (or trigger any transactional email) and confirm it
arrives, appears to come from `no-reply@kamidayhehe.com`, and doesn't land
in spam. If it lands in spam, double-check the SPF/DKIM records from step 3
- that's the most common cause.

## If you outgrow the free tier

If you hit the 50-email/day cap (likely only on a big drop day with many
orders in quick succession) or need `support@` in a real email client,
upgrade to Mail Lite (~$1/user/month) from the Zoho Mail Admin Console →
Billing - no DNS or code changes needed, it's a plan change on the same
account.
