// Provider metadata only — no `send` implementations, no node imports.
//
// The Settings UI imports this file (never `./index`, which pulls in nodemailer
// and node:crypto) and renders the credential form straight from `fields`.
// Adding a provider therefore means: a descriptor here, a module next to it,
// and one line in `index.ts` — no UI changes.

import type { ProviderDescriptor, ProviderId } from './types'

const SENDER_HELP = 'Must be a verified/authenticated domain at this provider.'

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    summary: 'Email Sending REST API. Bounces are collected by the analytics poller.',
    docsUrl: 'https://developers.cloudflare.com/email-routing/email-sending/',
    httpsOnly: true,
    fields: [
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        required: true,
        placeholder: '023e105f4ecef8ad9ca31a8372d0c353',
        help: 'Cloudflare dashboard → right-hand sidebar on any domain overview.',
      },
      {
        key: 'apiToken',
        label: 'API token',
        type: 'secret',
        required: true,
        help: 'Needs Email Sending: Send. Add Analytics: Read for bounce polling.',
      },
      {
        key: 'zoneId',
        label: 'Zone ID',
        type: 'text',
        placeholder: 'Optional — enables bounce polling',
        help: 'Required only for the GraphQL bounce poller.',
      },
    ],
  },
  {
    id: 'resend',
    label: 'Resend',
    summary: '3k/mo free, $20/mo for 50k. Simplest API of the set.',
    docsUrl: 'https://resend.com/docs/api-reference/emails/send-email',
    httpsOnly: true,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 're_...' },
    ],
  },
  {
    id: 'ses',
    label: 'Amazon SES',
    summary: 'Cheapest at volume (~$1 per 10k). Requires an AWS account out of sandbox.',
    docsUrl: 'https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html',
    httpsOnly: true,
    fields: [
      { key: 'region', label: 'Region', type: 'text', required: true, defaultValue: 'us-east-1', placeholder: 'us-east-1' },
      { key: 'accessKeyId', label: 'Access key ID', type: 'text', required: true, placeholder: 'AKIA...' },
      { key: 'secretAccessKey', label: 'Secret access key', type: 'secret', required: true },
      {
        key: 'configurationSet',
        label: 'Configuration set',
        type: 'text',
        placeholder: 'Optional',
        help: 'Needed if you want SES to publish bounce events to SNS.',
      },
    ],
  },
  {
    id: 'postmark',
    label: 'Postmark',
    summary: 'Best-in-class deliverability. $15 per 10k. Bulk mail must use a broadcast stream.',
    docsUrl: 'https://postmarkapp.com/developer/api/email-api',
    httpsOnly: true,
    fields: [
      { key: 'serverToken', label: 'Server API token', type: 'secret', required: true },
      {
        key: 'messageStream',
        label: 'Message stream',
        type: 'text',
        required: true,
        defaultValue: 'broadcast',
        help: 'Use "broadcast" for marketing. Postmark rejects bulk sent on "outbound".',
      },
    ],
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    summary: '$19.95/mo Essentials for 10k. No free tier any more.',
    docsUrl: 'https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send',
    httpsOnly: true,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 'SG....' },
    ],
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    summary: '$15/mo Basic for 10k. Pick the region matching where your domain was created.',
    docsUrl: 'https://documentation.mailgun.com/docs/mailgun/api-reference/openapi-final/tag/Messages/',
    httpsOnly: true,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true },
      {
        key: 'domain',
        label: 'Sending domain',
        type: 'text',
        required: true,
        placeholder: 'mg.yourdomain.com',
        help: SENDER_HELP,
      },
      {
        key: 'region',
        label: 'Region',
        type: 'select',
        required: true,
        defaultValue: 'us',
        options: [
          { value: 'us', label: 'US (api.mailgun.net)' },
          { value: 'eu', label: 'EU (api.eu.mailgun.net)' },
        ],
        help: 'Using the wrong region returns a confusing 401.',
      },
    ],
  },
  {
    id: 'brevo',
    label: 'Brevo',
    summary: 'Transactional API. Was this app’s original provider.',
    docsUrl: 'https://developers.brevo.com/reference/sendtransacemail',
    httpsOnly: true,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 'xkeysib-...' },
    ],
  },
  {
    id: 'mailchimp',
    label: 'Mailchimp Transactional',
    summary: 'Formerly Mandrill. Paid add-on, ~$20 per block of 25k.',
    docsUrl: 'https://mailchimp.com/developer/transactional/api/messages/send-new-message/',
    httpsOnly: true,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true },
    ],
  },
  {
    id: 'smtp',
    label: 'Generic SMTP',
    summary: 'Any SMTP server. Will not work on hosts that block outbound SMTP ports.',
    docsUrl: 'https://nodemailer.com/smtp/',
    httpsOnly: false,
    fields: [
      { key: 'host', label: 'SMTP host', type: 'text', required: true, placeholder: 'smtp.zoho.eu' },
      { key: 'port', label: 'SMTP port', type: 'number', required: true, defaultValue: '465', placeholder: '465' },
      { key: 'user', label: 'Username', type: 'text', required: true, placeholder: 'hello@yourdomain.com' },
      { key: 'pass', label: 'Password', type: 'secret', required: true },
    ],
  },
]

const PROVIDER_IDS: ProviderId[] = PROVIDER_DESCRIPTORS.map((p) => p.id)

export function getDescriptor(id: string): ProviderDescriptor | undefined {
  return PROVIDER_DESCRIPTORS.find((p) => p.id === id)
}

export function isProviderId(id: string): id is ProviderId {
  return PROVIDER_IDS.includes(id as ProviderId)
}
