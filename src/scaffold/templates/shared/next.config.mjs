/** PostRail reads its config and state files from disk at request time, so the server loads it
 *  from node_modules instead of bundling it. */
const nextConfig = {
  serverExternalPackages: ['postrail'],
};

export default nextConfig;
