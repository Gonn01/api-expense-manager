import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));
const fromRoot = (relativePath) => path.resolve(root, relativePath);

export default defineConfig({
    root,
    resolve: {
        alias: [
            { find: /^postgres$/, replacement: fromRoot("./tests/integration/support/postgres-local.js") },
            { find: /^.*\/utils\/pusher\.js$/, replacement: fromRoot("./tests/integration/support/fake-pusher.js") },
        ],
    },
    test: {
        include: ["tests/integration/**/*.test.js"],
        globalSetup: ["tests/integration/support/global-setup.js"],
        fileParallelism: false,
        testTimeout: 20000,
        hookTimeout: 30000,
    },
});
