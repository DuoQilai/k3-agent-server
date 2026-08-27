/**
 * DeepSeek Harness / Node 24 RISC-V HTTP compatibility shim.
 *
 * Only hosts known to return response headers rejected by Node's strict Fetch
 * parser are routed through Node's core HTTP client with lenient parsing:
 * the local llama-server and the official DeepSeek API. All other origins use
 * the native Fetch implementation.
 */
import http from "node:http";
import https from "node:https";

const COMPAT_HOSTS = new Set(["127.0.0.1:8080", "api.deepseek.com"]);
const NULL_BODY_STATUS = new Set([204, 205, 304]);
const nativeFetch = globalThis.fetch?.bind(globalThis);

function isRequest(input) {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveURL(input) {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  if (isRequest(input)) return new URL(input.url);
  throw new TypeError("fetch input must be a string, URL, or Request");
}

function isSupportedBody(body) {
  if (typeof body === "string") return true;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return true;
  return ArrayBuffer.isView(body) && !(body instanceof DataView);
}

function requestOverNode(input, init = {}, url) {
  const options = init ?? {};
  const requestInput = isRequest(input);
  const method = options.method ?? (requestInput ? input.method : "GET");
  const headers = new Headers(
    Object.prototype.hasOwnProperty.call(options, "headers")
      ? options.headers
      : requestInput
        ? input.headers
        : undefined,
  );
  const requestHeaders = Object.fromEntries(headers.entries());
  const body = Object.prototype.hasOwnProperty.call(options, "body")
    ? options.body
    : requestInput
      ? input.body
      : undefined;
  const signal = options.signal;

  if (body !== undefined && body !== null && !isSupportedBody(body)) {
    throw new TypeError(
      "The K3 HTTP(S) compatibility layer only supports string, Buffer, and typed-array request bodies",
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let streamFinished = false;
    let responseController;
    let abortHandler;
    const transport = url.protocol === "https:" ? https : http;

    const cleanupAbort = () => {
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    };

    const failStream = (error) => {
      if (!streamFinished && responseController) {
        streamFinished = true;
        responseController.error(error);
      }
      cleanupAbort();
    };

    const req = transport.request(
      url,
      { method, headers: requestHeaders, insecureHTTPParser: true },
      (res) => {
        const responseHeaders = new Headers();
        for (const [name, rawValue] of Object.entries(res.headers)) {
          if (name.toLowerCase() === "set-cookie" && Array.isArray(rawValue)) {
            for (const value of rawValue) {
              try {
                responseHeaders.append(name, value);
              } catch {
                // Ignore malformed advisory headers and preserve the response.
              }
            }
            continue;
          }

          const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
          if (value === undefined) continue;
          try {
            responseHeaders.set(name, value);
          } catch {
            // Ignore malformed advisory headers and preserve the response.
          }
        }

        const status = res.statusCode ?? 200;
        const hasNullBody = NULL_BODY_STATUS.has(status);
        const stream = hasNullBody
          ? null
          : new ReadableStream({
              start(controller) {
                responseController = controller;
                res.on("data", (chunk) => controller.enqueue(chunk));
                res.on("end", () => {
                  if (!streamFinished) {
                    streamFinished = true;
                    controller.close();
                  }
                  cleanupAbort();
                });
                res.on("error", failStream);
                res.on("close", () => {
                  if (!streamFinished) {
                    failStream(new Error("compatibility response closed before completion"));
                  }
                  else cleanupAbort();
                });
              },
              cancel(reason) {
                streamFinished = true;
                cleanupAbort();
                res.destroy(reason instanceof Error ? reason : undefined);
              },
            });

        if (hasNullBody) {
          res.resume();
          res.destroy();
          res.once("end", cleanupAbort);
          res.once("close", cleanupAbort);
        }

        try {
          const response = new Response(stream, {
            status,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
          });
          settled = true;
          resolve(response);
        } catch (error) {
          settled = true;
          cleanupAbort();
          res.destroy(error);
          reject(error);
        }
      },
    );

    req.on("error", (error) => {
      if (!settled) {
        cleanupAbort();
        reject(error);
      } else {
        failStream(error);
      }
    });

    if (signal) {
      abortHandler = () => {
        const reason = signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        req.destroy(reason instanceof Error ? reason : undefined);
        if (!settled) {
          settled = true;
          cleanupAbort();
          reject(reason);
        } else {
          failStream(reason);
        }
      };
      if (signal.aborted) return abortHandler();
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

globalThis.fetch = (input, init) => Promise.resolve().then(() => {
  const url = resolveURL(input);
  if (COMPAT_HOSTS.has(url.host)) return requestOverNode(input, init, url);
  if (!nativeFetch) throw new Error("Native fetch is unavailable");
  return nativeFetch(input, init);
});
