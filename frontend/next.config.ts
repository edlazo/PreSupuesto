import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosts allowed to request dev-only assets, so the app can be opened from a
  // phone on the same network. `*` stands for one label, which here is the
  // last octet: the address may change when the router renews its lease.
  allowedDevOrigins: ["192.168.0.*"],
};

export default nextConfig;
