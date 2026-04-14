import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Solo con `npm run dev`: guarda cambios en `public/datos-canchas.json`. */
function adminCanchasGuardarJsonPlugin(): import("vite").Plugin {
  return {
    name: "admin-canchas-guardar-json",
    configureServer(server) {
      server.middlewares.use("/api/admin-canchas/save", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const parsed: unknown = JSON.parse(raw);
            if (
              !parsed ||
              typeof parsed !== "object" ||
              !Array.isArray((parsed as { jugadores?: unknown }).jugadores)
            ) {
              res.statusCode = 400;
              res.end("invalid");
              return;
            }
            const outPath = path.join(__dirname, "public", "datos-canchas.json");
            fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
          } catch {
            res.statusCode = 500;
            res.end("error");
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [adminCanchasGuardarJsonPlugin()],
});
