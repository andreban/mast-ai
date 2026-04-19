// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

// build.ts
import dts from "bun-plugin-dts";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser", // Optimized for the browser/Vite users
  minify: true,
  naming: "[name].[ext]",
  plugins: [
    dts(), // Automatically generates src/index.d.ts in dist/
  ],
});

if (!result.success) {
  console.error("Build failed");
  for (const message of result.logs) {
    console.error(message);
  }
} else {
  console.log("MAST build successful! 🚀");
}
