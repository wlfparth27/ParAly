import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.PARALY_DRIVE_REDIRECT_URI || 'http://localhost:53682/oauth2callback';

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_DRIVE_OAUTH_CLIENT_ID and GOOGLE_DRIVE_OAUTH_CLIENT_SECRET before running this script.');
  process.exit(1);
}

const redirect = new URL(redirectUri);
if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)) {
  console.error('For this local helper, PARALY_DRIVE_REDIRECT_URI must be a localhost HTTP redirect.');
  process.exit(1);
}

const oauth = new OAuth2Client(clientId, clientSecret, redirectUri);
const state = randomBytes(24).toString('hex');
let finished = false;

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', redirect.origin);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid OAuth state. Close this page and run the helper again.');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Google did not return an authorisation code.');
    return;
  }

  try {
    const { tokens } = await oauth.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>ParAly Drive Authorised</title><p>ParAly Drive authorisation is complete. You can close this tab and return to your terminal.</p>');
    if (!tokens.refresh_token) {
      console.error('\nGoogle did not return a refresh token. Revoke ParAly from your Google Account security page, then run this helper again with consent.\n');
    } else {
      console.log('\nSave this refresh token privately in your deployment environment as GOOGLE_DRIVE_REFRESH_TOKEN. Do not paste it into chat or commit it.\n');
      console.log(tokens.refresh_token);
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Could not complete Google authorisation. Return to the terminal for details.');
    console.error('Drive OAuth token exchange failed:', error?.message || error);
  } finally {
    finished = true;
    server.close();
  }
});

server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  });
  console.log('Open this URL in your browser while signed into the Google account with the 5 TB Google One plan:');
  console.log(authUrl);
  console.log('\nWaiting for the OAuth callback on ' + redirectUri);
  console.log('Register this exact redirect URI on the Google OAuth Web client.');
});

setTimeout(() => {
  if (!finished) {
    console.error('\nOAuth helper timed out. Stop it with Ctrl+C and try again.');
    server.close();
    process.exitCode = 1;
  }
}, 5 * 60 * 1000).unref();
