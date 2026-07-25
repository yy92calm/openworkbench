import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

/** Fetch a page's content via HTTP GET. Returns the full HTML body. */
export function fetchPageContent(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fetcher = url.startsWith("https") ? httpsGet : httpGet;
    fetcher(url, { timeout: 15_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    }).on("error", reject).on("timeout", function () {
      this.destroy();
      reject(new Error("请求超时"));
    });
  });
}
