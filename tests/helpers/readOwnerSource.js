import { readFileSync } from "node:fs";

export function readOwnerSource(...paths) {
  return paths.map(path => readFileSync(new URL("../../" + path, import.meta.url), "utf8")).join("\n");
}
