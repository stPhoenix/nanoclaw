/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 *
 * OAuth tokens are read fresh from ~/.claude/.credentials.json on each
 * request so that auto-refreshed tokens are picked up without restart.
 * When the token is expired or about to expire, the proxy automatically
 * refreshes it using the refresh token.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

const CREDENTIALS_PATH = path.join(
  process.env.HOME || os.homedir(),
  '.claude',
  '.credentials.json',
);

// Refresh 10 minutes before expiry
const REFRESH_BUFFER_MS = 10 * 60 * 1000;

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let refreshInProgress: Promise<string | null> | null = null;

function readCredentials(): OAuthCredentials | null {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
      const oauth = data?.claudeAiOauth;
      if (oauth?.accessToken && oauth?.refreshToken) {
        return {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken,
          expiresAt: oauth.expiresAt || 0,
        };
      }
    }
  } catch {
    // Fall through
  }
  return null;
}

function saveCredentials(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): void {
  try {
    let data: Record<string, unknown> = {};
    if (fs.existsSync(CREDENTIALS_PATH)) {
      data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    }
    if (!data.claudeAiOauth || typeof data.claudeAiOauth !== 'object') {
      data.claudeAiOauth = {};
    }
    const oauth = data.claudeAiOauth as Record<string, unknown>;
    oauth.accessToken = accessToken;
    oauth.refreshToken = refreshToken;
    oauth.expiresAt = expiresAt;
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(data, null, 2));
    logger.info('OAuth token refreshed and saved');
  } catch (err) {
    logger.error({ err }, 'Failed to save refreshed OAuth credentials');
  }
}

function refreshOAuthToken(refreshToken: string): Promise<string | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const req = httpsRequest(
      {
        hostname: 'console.anthropic.com',
        port: 443,
        path: '/api/auth/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            if (data.access_token) {
              const expiresAt = Date.now() + (data.expires_in || 43200) * 1000;
              saveCredentials(
                data.access_token,
                data.refresh_token || refreshToken,
                expiresAt,
              );
              resolve(data.access_token);
            } else {
              logger.error(
                { status: res.statusCode, data },
                'OAuth refresh failed',
              );
              resolve(null);
            }
          } catch (err) {
            logger.error({ err }, 'Failed to parse OAuth refresh response');
            resolve(null);
          }
        });
      },
    );

    req.on('error', (err) => {
      logger.error({ err }, 'OAuth refresh request error');
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Get a valid OAuth token. Reads from credentials file, auto-refreshes
 * if expired or about to expire.
 */
async function getOauthToken(
  envFallback: string | undefined,
): Promise<string | undefined> {
  const creds = readCredentials();
  if (!creds) return envFallback;

  const now = Date.now();
  if (creds.expiresAt > now + REFRESH_BUFFER_MS) {
    // Token is still valid
    return creds.accessToken;
  }

  // Token expired or expiring soon — refresh
  logger.info('OAuth token expired or expiring soon, refreshing...');

  // Deduplicate concurrent refresh attempts
  if (!refreshInProgress) {
    refreshInProgress = refreshOAuthToken(creds.refreshToken).finally(() => {
      refreshInProgress = null;
    });
  }

  const newToken = await refreshInProgress;
  return newToken || envFallback;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const envOauthFallback =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        const forwardRequest = (oauthToken?: string) => {
          const headers: Record<
            string,
            string | number | string[] | undefined
          > = {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

          // Strip hop-by-hop headers that must not be forwarded by proxies
          delete headers['connection'];
          delete headers['keep-alive'];
          delete headers['transfer-encoding'];

          if (authMode === 'api-key') {
            // API key mode: inject x-api-key on every request
            delete headers['x-api-key'];
            headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
          } else {
            // OAuth mode: replace placeholder Bearer token with the real one
            // only when the container actually sends an Authorization header
            // (exchange request + auth probes). Post-exchange requests use
            // x-api-key only, so they pass through without token injection.
            if (headers['authorization']) {
              delete headers['authorization'];
              if (oauthToken) {
                headers['authorization'] = `Bearer ${oauthToken}`;
              }
            }
          }

          const upstream = makeRequest(
            {
              hostname: upstreamUrl.hostname,
              port: upstreamUrl.port || (isHttps ? 443 : 80),
              path: req.url,
              method: req.method,
              headers,
            } as RequestOptions,
            (upRes) => {
              res.writeHead(upRes.statusCode!, upRes.headers);
              upRes.pipe(res);
            },
          );

          upstream.on('error', (err) => {
            logger.error(
              { err, url: req.url },
              'Credential proxy upstream error',
            );
            if (!res.headersSent) {
              res.writeHead(502);
              res.end('Bad Gateway');
            }
          });

          upstream.write(body);
          upstream.end();
        };

        if (authMode === 'oauth' && req.headers['authorization']) {
          // Async: resolve token (with potential refresh) then forward
          getOauthToken(envOauthFallback).then(
            (token) => forwardRequest(token),
            () => forwardRequest(envOauthFallback),
          );
        } else {
          forwardRequest();
        }
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
