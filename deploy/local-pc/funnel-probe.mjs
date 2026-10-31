import { Resolver } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { nextTick } from "node:process";

export const TARGET = Object.freeze({
  hostname: "kenshi2.tail4e104f.ts.net",
  port: 443,
  upstream: "http://127.0.0.1:4310",
});
export const RESOLVERS = Object.freeze([
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
]);
const TIMEOUT = 6000;

// Never mistake MagicDNS, loopback, or a private address for public ingress.
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Global-unicast only; excludes mapped IPv4, ULA and link-local addresses.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:db8:/i.test(address)
  );
}

export async function dnsJson(
  endpoint,
  name,
  type,
  fetcher = globalThis.fetch
) {
  const url = new URL(endpoint);
  url.searchParams.set("name", name);
  url.searchParams.set("type", String(type));
  const response = await fetcher(url, {
    headers: { accept: "application/dns-json", "cache-control": "no-cache" },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(`DNS HTTP ${response.status}`);
  const data = await response.json();
  if (!Number.isInteger(data.Status)) throw new Error("Invalid DNS response");
  return data;
}

export async function resolvePublic(endpoint, lookup = dnsJson) {
  try {
    const replies = await Promise.all(
      [1, 28].map((type) => lookup(endpoint, TARGET.hostname, type))
    );
    if (replies.every((reply) => reply.Status === 3))
      return { resolver: endpoint, status: "nxdomain", addresses: [] };
    if (replies.some((reply) => reply.Status !== 0))
      return { resolver: endpoint, status: "unknown", addresses: [] };
    const addresses = [
      ...new Set(
        replies.flatMap((reply) =>
          (reply.Answer ?? [])
            .filter((row) => [1, 28].includes(row.type))
            .map((row) => row.data)
        )
      ),
    ];
    if (
      !addresses.length ||
      addresses.some((address) => !isPublicAddress(address))
    )
      return { resolver: endpoint, status: "unknown", addresses: [] };
    return { resolver: endpoint, status: "ok", addresses };
  } catch (error) {
    return {
      resolver: endpoint,
      status: "unknown",
      addresses: [],
      error: error.code ?? error.name,
    };
  }
}

export function publicHealth(address, timeout = TIMEOUT) {
  if (!isPublicAddress(address))
    return Promise.resolve({ address, ok: false, error: "non-public-address" });
  return new Promise((resolve) => {
    let finished = false;
    let timer;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ address, ...result });
    };
    // Keep hostname/SNI/certificate validation; override only address lookup.
    const request = get(
      `https://${TARGET.hostname}/healthz`,
      {
        agent: false,
        lookup: (_hostname, options, callback) => {
          const result = { address, family: isIP(address) };
          // Let HTTPS finish TLS socket setup before an unreachable address
          // can fail, so its request error listener observes the failure.
          nextTick(() => {
            if (options.all) callback(null, [result]);
            else callback(null, address, result.family);
          });
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096)
            request.destroy(new Error("response-too-large"));
        });
        response.on("error", (error) =>
          finish({ ok: false, error: error.code ?? error.message })
        );
        response.on("end", () => {
          try {
            const health = JSON.parse(body);
            finish({
              ok: response.statusCode === 200 && health.ok === true,
              status: response.statusCode,
              revision: health.revision,
            });
          } catch {
            finish({
              ok: false,
              status: response.statusCode,
              error: "invalid-health-response",
            });
          }
        });
      }
    );
    timer = setTimeout(() => request.destroy(new Error("timeout")), timeout);
    request.on("error", (error) =>
      finish({ ok: false, error: error.code ?? error.message })
    );
  });
}

export async function probePublic({
  resolve = resolvePublic,
  health = publicHealth,
} = {}) {
  const dns = await Promise.all(RESOLVERS.map((endpoint) => resolve(endpoint)));
  const addresses = [...new Set(dns.flatMap((reply) => reply.addresses))];
  // Bound requests even if a DNS response is unexpectedly large.
  const ingress = await Promise.all(
    addresses.slice(0, 8).map((address) => health(address))
  );
  const ok = dns.every(
    (reply) =>
      reply.status === "ok" &&
      ingress.some(
        (result) => result.ok && reply.addresses.includes(result.address)
      )
  );
  return { ok, dns, ingress };
}

export async function localHealth(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(`${TARGET.upstream}/healthz`, {
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(TIMEOUT),
    });
    const health = await response.json();
    return {
      ok: response.status === 200 && health.ok === true,
      status: response.status,
      revision: health.revision,
    };
  } catch (error) {
    return { ok: false, error: error.code ?? error.name };
  }
}

export async function queryAuthority(address) {
  const resolver = new Resolver({ timeout: 2500, tries: 1 });
  resolver.setServers([address]);
  const replies = await Promise.all(
    ["resolve4", "resolve6"].map(async (method) => {
      try {
        return {
          status: "ok",
          addresses: await resolver[method](TARGET.hostname),
        };
      } catch (error) {
        return {
          status: error.code === "ENOTFOUND" ? "nxdomain" : "unknown",
          error: error.code,
        };
      }
    })
  );
  return {
    address,
    status: replies.every((reply) => reply.status === "nxdomain")
      ? "nxdomain"
      : replies.some((reply) => reply.status === "ok")
        ? "ok"
        : "unknown",
    replies,
  };
}

export async function probeAuthorities({
  lookup = dnsJson,
  query = queryAuthority,
} = {}) {
  try {
    const discovery = await lookup(RESOLVERS[0], "ts.net", 2);
    if (discovery.Status !== 0) throw new Error("NS lookup failed");
    const names = [
      ...new Set(
        (discovery.Answer ?? [])
          .filter((row) => row.type === 2)
          .map((row) => row.data.replace(/\.$/, ""))
      ),
    ];
    if (names.length < 2 || names.length > 8)
      throw new Error("Unexpected NS count");
    const servers = await Promise.all(
      names.map(async (name) => {
        const reply = await lookup(RESOLVERS[1], name, 1);
        const address = (reply.Answer ?? []).find(
          (row) => row.type === 1 && isPublicAddress(row.data)
        )?.data;
        if (reply.Status !== 0 || !address) return { name, status: "unknown" };
        return { name, ...(await query(address)) };
      })
    );
    return {
      status: servers.every((server) => server.status === "nxdomain")
        ? "nxdomain"
        : servers.some((server) => server.status === "ok")
          ? "present"
          : "unknown",
      servers,
    };
  } catch (error) {
    return { status: "unknown", error: error.code ?? error.name, servers: [] };
  }
}
