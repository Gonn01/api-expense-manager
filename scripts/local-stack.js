import setupLocalDatabase from "../tests/integration/support/global-setup.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_PORT = "3100";

const stopDatabase = await setupLocalDatabase();

if (!LOCAL_HOSTS.has(new URL(process.env.DATABASE_URL).hostname)) {
    stopDatabase();
    throw new Error("El entorno local solo puede usar una base local");
}

Object.assign(process.env, {
    PORT: process.env.PORT || DEFAULT_PORT,
    DATABASE_SSL: "disable",
    PUSHER_APP_ID: "",
    PUSHER_KEY: "",
    PUSHER_SECRET: "",
    PUSHER_CLUSTER: "",
    BEAMS_INSTANCE_ID: "",
    BEAMS_SECRET_KEY: "",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_WEB_API_KEY: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
});

let stopped = false;
const shutdown = () => {
    if (stopped) return;
    stopped = true;
    stopDatabase();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGBREAK", shutdown);
process.on("message", (message) => message === "shutdown" && shutdown());

await import("../index.js");
console.log(`DATABASE_READY ${process.env.DATABASE_URL}`);
