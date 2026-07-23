/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // dev 模式下让 webpack 忽略 data/ 与 models/ 的文件变化，
  // 否则 render/tts 等步骤往 data/tasks 写中间文件会触发热重载、打断正在跑的步骤。
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.next/**", "**/data/**", "**/models/**"],
      };
    }
    return config;
  },
};
module.exports = nextConfig;
