/**
 * SmartKiosk / Smart Shopping — Anderson (EcoTrack Standard API) Courier Driver
 * file: cloudflare-worker/src/utils/anderson.js
 *
 * Isolated, side-effect-free driver for Anderson Delivery operating on the EcoTrack platform.
 * Conforms strictly to the official EcoTrack API v1 contract.
 *
 * Architectural Constraints:
 * - Native fetch only (Cloudflare Worker edge compatible).
 * - Zero database / D1 access.
 * - Zero pricing or quantity recalculation (SmartKiosk order montant is sent as-is).
 * - Strict SSRF prevention and HTTPS enforcement for base URLs (*.ecotrack.dz).
 * - All secrets and tokens are redacted from error messages and logs.
 */

/**
 * Validates and normalizes the Anderson / EcoTrack base URL.
 * Enforces HTTPS, non-standard port rejection, credentials rejection,
 * and restricts the host strictly to official EcoTrack domains (*.ecotrack.dz).
 *
 * @param {string} baseUrl - The base URL configured for the courier.
 * @returns {{ ok: boolean, url?: string, error?: string, status: number }}
 */
export function validateAndersonBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return { ok: false, error: 'Courier base URL is required', status: 400 };
  }

  const trimmed = baseUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return { ok: false, error: 'Invalid Courier base URL format', status: 400 };
  }

  // 1. Enforce HTTPS only (reject http, ftp, file, etc.)
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Courier base URL must use HTTPS protocol', status: 400 };
  }

  // 2. Reject credentials in URL to prevent credential leakage
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Credentials in base URL are not allowed', status: 400 };
  }

  // 3. Reject non-standard ports to prevent SSRF / internal port scanning
  if (parsed.port && parsed.port !== '443') {
    return { ok: false, error: 'Non-standard ports are not allowed in base URL', status: 400 };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 4. Strict hostname whitelist: must be ecotrack.dz or a direct/nested subdomain of ecotrack.dz
  // RFC 1123 compliant label checking: letters, digits, hyphens (cannot start/end with hyphen)
  const isEcoTrackDomain = hostname === 'ecotrack.dz' ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ecotrack\.dz$/.test(hostname);

  if (!isEcoTrackDomain) {
    return {
      ok: false,
      error: 'Base URL host must be an official EcoTrack domain (*.ecotrack.dz)',
      status: 400,
    };
  }

  // Return clean origin without trailing slash, paths, queries, or hashes
  return {
    ok: true,
    url: `https://${hostname}`,
    status: 200,
  };
}

/**
 * Validates the courier API token using the official EcoTrack validation endpoint.
 * GET /api/v1/validate/token?api_token={{api_token}}
 *
 * @param {string} baseUrl - Courier base URL (e.g. https://anderson.ecotrack.dz)
 * @param {string} token - Courier merchant API token
 * @returns {Promise<{ ok: boolean, status: number, message?: string, error?: string }>}
 */
export async function validateAndersonToken(baseUrl, token) {
  const urlCheck = validateAndersonBaseUrl(baseUrl);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error, status: urlCheck.status };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: 'Courier token is required', status: 400 };
  }

  const cleanToken = token.trim();
  const endpoint = `${urlCheck.url}/api/v1/validate/token?api_token=${encodeURIComponent(cleanToken)}`;

  try {
    // Official contract specifies query param auth for this probe endpoint; no Bearer header needed.
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {}

    if (res.status === 200) {
      // Check if upstream returned a soft error within HTTP 200
      if (data && (data.status === 'error' || data.success === false || data.valid === false)) {
        return {
          ok: false,
          error: sanitizeErrorMessage(data.message || data.error || 'Token validation failed', cleanToken),
          status: 401,
        };
      }
      return {
        ok: true,
        status: 200,
        message: (data && typeof data.message === 'string' && data.message) || 'Token is valid',
      };
    }

    if (res.status === 401) {
      return {
        ok: false,
        error: 'Invalid or expired courier token',
        status: 401,
      };
    }

    if (res.status === 403) {
      let errMsg = 'Courier token is forbidden or inactive';
      if (data) {
        const strData = JSON.stringify(data);
        if (strData.includes('TOKEN_NOT_ALLOWED')) {
          errMsg = 'TOKEN_NOT_ALLOWED: Token lacks API permissions or is disabled by courier';
        } else if (typeof data.message === 'string') {
          errMsg = sanitizeErrorMessage(data.message, cleanToken);
        }
      }
      return {
        ok: false,
        error: errMsg,
        status: 403,
      };
    }

    let errMsg = `Courier token validation failed with status ${res.status}`;
    if (data && typeof data.message === 'string') {
      errMsg = sanitizeErrorMessage(data.message, cleanToken);
    }
    return {
      ok: false,
      error: errMsg,
      status: res.status,
    };
  } catch (_) {
    return {
      ok: false,
      error: 'Network error communicating with courier token validation service',
      status: 502,
    };
  }
}

/**
 * Creates a shipment order on Anderson / EcoTrack.
 * POST /api/v1/create/orders
 * Authorization: Bearer <token>
 *
 * Invariant: The payload is sent exactly as received.
 * This function NEVER modifies pricing, recalculates montant, or alters quantities.
 *
 * @param {string} baseUrl - Courier base URL
 * @param {string} token - Courier merchant API token
 * @param {object} payload - Validated EcoTrack shipment payload (20 fields)
 * @returns {Promise<{ ok: boolean, tracking?: string, status: number, data?: any, error?: string }>}
 */
export async function createAndersonOrder(baseUrl, token, payload) {
  const urlCheck = validateAndersonBaseUrl(baseUrl);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error, status: urlCheck.status };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: 'Courier token is required', status: 400 };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Order payload must be a non-empty object', status: 400 };
  }

  const cleanToken = token.trim();
  const endpoint = `${urlCheck.url}/api/v1/create/orders`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {}

    const isSuccessStatus = res.status === 200 || res.status === 201;

    if (isSuccessStatus) {
      // Primary documented field: data.tracking
      // Fallback documented shapes: data.data.tracking or data.tracking_id
      let tracking = null;
      if (data) {
        if (typeof data.tracking === 'string' && data.tracking.trim()) {
          tracking = data.tracking.trim();
        } else if (data.data && typeof data.data.tracking === 'string' && data.data.tracking.trim()) {
          tracking = data.data.tracking.trim();
        } else if (typeof data.tracking_id === 'string' && data.tracking_id.trim()) {
          tracking = data.tracking_id.trim();
        }
      }

      if (tracking) {
        return {
          ok: true,
          tracking,
          status: res.status,
          data: sanitizeUpstreamData(data, cleanToken),
        };
      }

      return {
        ok: false,
        error: 'Courier responded with success status but tracking number was missing from response',
        status: res.status,
      };
    }

    let errMsg = `Courier rejected order with status ${res.status}`;
    if (data) {
      if (typeof data.message === 'string' && data.message.trim()) {
        errMsg = sanitizeErrorMessage(data.message, cleanToken);
      } else if (typeof data.error === 'string' && data.error.trim()) {
        errMsg = sanitizeErrorMessage(data.error, cleanToken);
      }
    }

    return {
      ok: false,
      error: errMsg,
      status: res.status,
    };
  } catch (_) {
    return {
      ok: false,
      error: 'Network error connecting to courier order creation API',
      status: 502,
    };
  }
}

/**
 * Retrieves tracking information for a shipment from Anderson / EcoTrack.
 * GET /api/v1/get/tracking/info?tracking={{tracking}}
 * Authorization: Bearer <token>
 *
 * @param {string} baseUrl - Courier base URL
 * @param {string} token - Courier merchant API token
 * @param {string} trackingCode - Courier tracking identifier
 * @returns {Promise<{ ok: boolean, status: number, data?: any, error?: string }>}
 */
export async function getAndersonTracking(baseUrl, token, trackingCode) {
  const urlCheck = validateAndersonBaseUrl(baseUrl);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error, status: urlCheck.status };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: 'Courier token is required', status: 400 };
  }

  if (!trackingCode || typeof trackingCode !== 'string' || !trackingCode.trim()) {
    return { ok: false, error: 'Tracking code is required', status: 400 };
  }

  const cleanToken = token.trim();
  const cleanTracking = trackingCode.trim();
  const endpoint = `${urlCheck.url}/api/v1/get/tracking/info?tracking=${encodeURIComponent(cleanTracking)}`;

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Accept': 'application/json',
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {}

    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        data: sanitizeUpstreamData(data, cleanToken),
      };
    }

    let errMsg = `Courier tracking request failed with status ${res.status}`;
    if (data && typeof data.message === 'string' && data.message.trim()) {
      errMsg = sanitizeErrorMessage(data.message, cleanToken);
    }

    return {
      ok: false,
      error: errMsg,
      status: res.status,
    };
  } catch (_) {
    return {
      ok: false,
      error: 'Network error fetching tracking information from courier',
      status: 502,
    };
  }
}

/**
 * Returns canonical label endpoint information.
 * GET /api/v1/get/order/label?tracking={{tracking}}
 *
 * NOTE: The upstream EcoTrack label endpoint requires `Authorization: Bearer <token>`.
 * A standard browser window/tab navigation cannot securely carry Bearer headers without exposing
 * credentials. Therefore, this function returns canonical endpoint metadata only;
 * the Worker backend will proxy the binary PDF to the admin panel via an authenticated admin route.
 *
 * @param {string} baseUrl - Courier base URL
 * @param {string} token - Courier merchant API token (validated, not embedded in URL)
 * @param {string} trackingCode - Courier tracking identifier
 * @returns {{ ok: boolean, url?: string, requiresAuth?: boolean, authHeader?: string, note?: string, error?: string, status: number }}
 */
export function getAndersonLabelUrl(baseUrl, token, trackingCode) {
  const urlCheck = validateAndersonBaseUrl(baseUrl);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error, status: urlCheck.status };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: 'Courier token is required', status: 400 };
  }

  if (!trackingCode || typeof trackingCode !== 'string' || !trackingCode.trim()) {
    return { ok: false, error: 'Tracking code is required', status: 400 };
  }

  const cleanTracking = trackingCode.trim();
  const canonicalUrl = `${urlCheck.url}/api/v1/get/order/label?tracking=${encodeURIComponent(cleanTracking)}`;

  return {
    ok: true,
    url: canonicalUrl,
    requiresAuth: true,
    authHeader: 'Authorization: Bearer <token>',
    note: 'The upstream EcoTrack label endpoint requires Bearer authentication. Plain browser navigation cannot securely attach Bearer headers without exposing secrets. The Worker backend must proxy the binary PDF response to the authenticated admin panel.',
    status: 200,
  };
}

// ── Private Sanitization Helpers ──

/**
 * Redacts tokens and auth patterns from error messages.
 * @param {string} msg
 * @param {string} token
 * @returns {string}
 */
function sanitizeErrorMessage(msg, token) {
  if (typeof msg !== 'string') return 'Upstream courier error';
  let clean = msg;
  if (token && typeof token === 'string' && token.length > 4) {
    clean = clean.split(token).join('[REDACTED_TOKEN]');
  }
  clean = clean.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  return clean.slice(0, 500);
}

/**
 * Redacts any accidental token echoes from upstream responses.
 * @param {any} data
 * @param {string} token
 * @returns {any}
 */
function sanitizeUpstreamData(data, token) {
  if (!data || typeof data !== 'object') return data;
  try {
    let jsonStr = JSON.stringify(data);
    if (token && typeof token === 'string' && token.length > 4) {
      jsonStr = jsonStr.split(token).join('[REDACTED_TOKEN]');
    }
    jsonStr = jsonStr.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
    return JSON.parse(jsonStr);
  } catch (_) {
    return data;
  }
}
