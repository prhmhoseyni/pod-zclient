import { defineConfig } from "vite";

const viteConfig = defineConfig({
    build: {
        lib: {
            entry: "src/main.ts",
            name: "POD_ZClient",
            fileName: format => `pod-zclient.${format}.js`,
            formats: ["es", "cjs"]
        }
    }
});

export default viteConfig;