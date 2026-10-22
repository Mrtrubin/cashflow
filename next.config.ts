import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // 账单导入已并入设置（/settings/import），保留旧地址的跳转
  async redirects() {
    return [
      { source: "/import", destination: "/settings/import", permanent: false },
    ];
  },
};

export default nextConfig;
