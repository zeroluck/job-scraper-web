import "server-only";
import { PostgrestClient } from "@supabase/postgrest-js";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// Reuse pools across per-request SDK clients; never install a global dispatcher.
const dataAgents = new Map<string, Agent>();

function connectionFetch(endpoint: URL, connectIp: string): typeof fetch {
  const key = `${endpoint.origin}|${connectIp}`;
  let dispatcher = dataAgents.get(key);
  if (!dispatcher) {
    dispatcher = new Agent({
      connect: {
        rejectUnauthorized: true,
        lookup(hostname, options, callback) {
          if (hostname !== endpoint.hostname) {
            callback(new Error("Data connection hostname mismatch"), []);
            return;
          }
          const address = { address: connectIp, family: isIP(connectIp) };
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
    });
    dataAgents.set(key, dispatcher);
  }
  const agent = dispatcher;
  return (async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== endpoint.origin || !url.pathname.startsWith("/rest/v1/")) {
      throw new Error("Data connection request outside configured API");
    }
    // Keep the HTTPS URL intact: undici derives Host, SNI and identity checks from it.
    // Do not follow redirects into Storage or any other DNS/credential boundary.
    const response = await undiciFetch(url, { ...init, dispatcher: agent, redirect: "error" } as Parameters<typeof undiciFetch>[1]);
    return response as unknown as Response;
  }) as typeof fetch;
}

/** Database-only client for the native PostgREST root (not a Supabase project URL).
 * No Auth, cookies, persisted sessions, Storage or service-role fallback.
 */
export function createJobDataClient() {
  const url = process.env.JOB_DATA_API_URL;
  const token = process.env.JOB_DATA_API_TOKEN;
  if (!url || !token) {
    throw new Error("Missing JOB_DATA_API_URL or JOB_DATA_API_TOKEN");
  }
  const invalidUrl = () => new Error("Invalid JOB_DATA_API_URL: expected an HTTP(S) origin or /rest/v1 endpoint without credentials, query or fragment");
  // Validate the raw shape before URL parsing can erase empty ?/# or dot segments.
  if (!/^https?:\/\/[^/?#@\\\s]+(?:\/|\/rest\/v1\/?)?$/i.test(url)) {
    throw invalidUrl();
  }
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw invalidUrl();
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw invalidUrl();
  }
  const connectIp = process.env.JOB_DATA_API_CONNECT_IP;
  if (connectIp && (!isIP(connectIp) || connectIp.includes("%"))) {
    throw new Error("Invalid JOB_DATA_API_CONNECT_IP: expected a numeric IPv4 or IPv6 address");
  }
  if (connectIp && endpoint.protocol !== "https:") {
    throw new Error("JOB_DATA_API_CONNECT_IP requires an HTTPS JOB_DATA_API_URL");
  }
  if (connectIp && isIP(endpoint.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("JOB_DATA_API_CONNECT_IP requires a DNS hostname in JOB_DATA_API_URL");
  }
  return new PostgrestClient(`${endpoint.origin}/rest/v1`, {
    headers: { Authorization: `Bearer ${token}` },
    ...(connectIp ? { fetch: connectionFetch(endpoint, connectIp) } : {}),
  });
}
