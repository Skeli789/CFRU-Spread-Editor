import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig as defineTestConfig } from "vitest/config";

const API_PROXY = { "/api": "http://127.0.0.1:3001" };

export default defineConfig(
    {
        root: ".",
        publicDir: "public",
        base: "/",
        plugins: [react()],
        server: 
        {
            proxy: API_PROXY,
            // Forwards browser console messages to the terminal to help debugging
            forwardConsole:
            {
                unhandledErrors: true,
                logLevels: ['warn', 'error'],
            },
        },
        preview:
        {
            proxy: API_PROXY,
        },
        test: defineTestConfig(
            {
                globals: true,
                setupFiles: "./src/tests/SetupTests.js",
                environment: "jsdom"
            }
        ),
    }
);
