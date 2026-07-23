import "./globals.css";

export const metadata = {
  title: "图书视频采集工作台",
  description: "从抖音链接提取口播、识别图书并分析爆款结构",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
