import crypto from 'crypto';

import { Channel, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';
import { detectInjectionPatterns } from './injection-detect.js';
import { validateOutput } from './output-validator.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateBoundary(): string {
  return `BOUNDARY_${crypto.randomBytes(8).toString('hex')}`;
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): { formatted: string; boundary: string } {
  const boundary = generateBoundary();

  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    const flags = detectInjectionPatterns(m.content);
    const flagAttr =
      flags.length > 0
        ? ` injection-flags="${escapeXml(flags.map((f) => f.description).join(', '))}"`
        : '';
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${flagAttr}>${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;
  const formatted = `${header}<user-messages boundary="${boundary}">\n${lines.join('\n')}\n</user-messages>`;

  return { formatted, boundary };
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  const { sanitized } = validateOutput(text);
  return sanitized;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
