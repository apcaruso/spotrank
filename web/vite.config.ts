import { defineConfig } from "vite";

// Relative asset paths, so dist/ works from a domain root or a subfolder
// (e.g. GitHub Pages at /spotrank/).
export default defineConfig({ base: "./" });
