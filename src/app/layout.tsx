import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import "./globals.css";

// 原本用 next/font/google 拉 Noto Sans SC,因 Google Fonts 在国内网络环境
// 拉不动会导致 next dev 每次请求都在 fonts.googleapis.com 卡 7+s,
// 表现为「localhost:3000 打不开 / 页面一直转」;改用系统 CJK 字体栈,
// 零网络依赖,macOS/Windows/Linux 都自带中文字体。
const systemFontStack =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', " +
  "'Microsoft YaHei', 'WenQuanYi Micro Hei', sans-serif";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
    >
      <body
        className={systemFontStack}
        style={{ fontFamily: systemFontStack }}
        suppressHydrationWarning
      >
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}