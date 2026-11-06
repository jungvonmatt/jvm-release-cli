import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: false,
    banner: "#!/usr/bin/env node",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    // Tests run in CI too. Each test that checks CI behaviour sets `CI` itself.
    env: {
      CI: "",
      CI_API_V4_URL: "",
      CI_SERVER_URL: "",
      GITHUB_TOKEN: "",
      GITHUB_API_URL: "",
      GITHUB_SERVER_URL: "",
    },
  },
});
