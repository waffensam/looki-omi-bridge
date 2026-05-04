import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: projectRoot,
  },
};

export default withWorkflow(nextConfig);
