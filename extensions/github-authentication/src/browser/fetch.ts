/*---------------------------------------------------------------------------------------------
 * Seven Code Android: the upstream GitHub OAuth device code flow cannot POST
 * from a Web Worker due to CORS. Only the APK's trusted origin may delegate
 * the TWO official GitHub device-flow POST endpoints to Android HTTPS.
 * Other fetches and ordinary browser builds preserve the original behavior.
 *--------------------------------------------------------------------------------------------*/

const ORIGIN = 'https://appassets.androidplatform.net';
const CHANNEL = 'seven-code-mobile-github-device-v1';

export const fetching = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const original = () => fetch(input, init);
    if (typeof globalThis.location === 'undefined' ||
        globalThis.location.origin !== ORIGIN ||
        typeof BroadcastChannel === 'undefined' ||
        (init?.method || 'GET').toUpperCase() !== 'POST') {
        return original();
    }
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
        url.port || url.username || url.password || url.hash ||
        !['/login/device/code', '/login/oauth/access_token'].includes(url.pathname)) {
        return original();
    }
    const op = url.pathname === '/login/device/code' ? 'begin' : 'poll';
    const clientId = url.searchParams.get('client_id') || '';
    const scope = url.searchParams.get('scope') || '';
    const deviceCode = url.searchParams.get('device_code') || '';
    const expected = op === 'begin'
        ? ['client_id', 'scope'] : ['client_id', 'device_code', 'grant_type'];
    if ([...url.searchParams.keys()].some(key => !expected.includes(key)) ||
        url.searchParams.get('grant_type') !== (op === 'poll' ?
            'urn:ietf:params:oauth:grant-type:device_code' : null) ||
        !/^[A-Za-z0-9]{16,64}$/.test(clientId)) {
        throw new Error('GitHub device OAuth request was rejected by Android policy');
    }
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const channel = new BroadcastChannel(CHANNEL);
    return new Promise<Response>((resolve, reject) => {
        const timeout = setTimeout(() => {
            channel.close();
            reject(new Error('Android GitHub authentication did not respond'));
        }, 20000);
        channel.onmessage = event => {
            const answer = event.data;
            if (answer?.type !== 'github-device-result' || answer.requestId !== requestId) return;
            clearTimeout(timeout);
            channel.close();
            // The standard provider handles authorization_pending, slow_down,
            // access_denied, token storage, session restore and logout.
            resolve(new Response(JSON.stringify(answer.body || { error: 'invalid_response' }), {
                status: answer.status === 200 ? 200 : 400,
                headers: { 'content-type': 'application/json' }
            }));
        };
        channel.postMessage({
            type: 'github-device-request', requestId, op,
            clientId, scope, deviceCode
        });
    });
};
