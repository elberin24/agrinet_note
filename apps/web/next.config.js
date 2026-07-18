// Next 14.2.35는 핫픽스 릴리스라 SWC 바이너리를 14.2.33으로 선언하는데,
// lockfile 검사는 next 자체 버전(14.2.35)과 비교하므로 항상 실패하고,
// npm 워크스페이스에서는 자동 패치도 ENOWORKSPACES로 실패한다.
// SWC는 정상 설치되어 있으므로 검사만 건너뛴다.
process.env.NEXT_IGNORE_INCORRECT_LOCKFILE = "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@chwijae/core"],
};

module.exports = nextConfig;
