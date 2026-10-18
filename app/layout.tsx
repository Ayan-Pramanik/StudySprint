import type { Metadata } from "next";
import "./globals.css";
import WorkspaceApp from "../components/WorkspaceApp";
import { THEME_SCRIPT } from "../lib/theme";
export const metadata: Metadata = {
    title: "StudySprint",
    description: "Connect your notes. Remember what matters.",
    icons: {
        icon: "/favicon.svg",
        shortcut: "/favicon.svg",
    },
};
export default function RootLayout({ children, }: Readonly<{
    children: React.ReactNode;
}>) {
    return (<html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}/></head>
      <body className="antialiased"><WorkspaceApp>{children}</WorkspaceApp></body>
    </html>);
}
